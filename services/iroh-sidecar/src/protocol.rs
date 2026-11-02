// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
//! Pure, I/O-free parts of the sidecar protocol (docs/IROH-SIDECAR.md):
//! command-line parsing, host -> sidecar line parsing, sidecar -> host line
//! encoding, the stream framing between two sidecars, and hex for the key file.
//!
//! Nothing here touches iroh, the network, the filesystem or stdout, so all of
//! it is covered by the unit tests at the bottom of this file.

use std::net::SocketAddr;
use std::path::PathBuf;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde_json::{json, Value};

/// Largest payload accepted in either direction: 1 MiB.
pub const MAX_PAYLOAD_BYTES: usize = 1024 * 1024;
/// The single acknowledgement byte the receiver writes after `recv`.
pub const ACK: u8 = 0x01;
/// Default ALPN for TrustWeb connections.
pub const DEFAULT_ALPN: &str = "trustweb/didcomm/0.1";
/// Protocol version announced in `ready`.
pub const PROTOCOL_VERSION: u32 = 1;

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// `--relay-url`, in the order given, duplicates removed.
    pub relay_urls: Vec<String>,
    /// `--n0-relays`: explicit opt-in to n0's public relays.
    pub n0_relays: bool,
    pub alpn: String,
    pub secret_key_file: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParsedArgs {
    Run(Config),
    Help,
}

/// What relay mode the endpoint should run in, derived from [`Config`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RelayChoice {
    /// Default (I9): no relay at all, direct connections only.
    Disabled,
    /// Only `--n0-relays`.
    N0Default,
    /// `--relay-url` given; `plus_n0` when `--n0-relays` was also given.
    Custom { urls: Vec<String>, plus_n0: bool },
}

pub const USAGE: &str = "usage: trustweb-iroh-sidecar [--relay-url <url>]... [--alpn <string>] \
[--secret-key-file <path>] [--n0-relays]\n\
Speaks JSON lines on stdin/stdout; see docs/IROH-SIDECAR.md.\n\
Default: no relay (direct connections only), ephemeral key.";

/// Parse arguments (without the program name). Accepts `--flag value` and
/// `--flag=value`.
pub fn parse_args<I, S>(args: I) -> Result<ParsedArgs, String>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut relay_urls: Vec<String> = Vec::new();
    let mut n0_relays = false;
    let mut alpn: Option<String> = None;
    let mut secret_key_file: Option<PathBuf> = None;

    let mut it = args.into_iter().map(Into::into);
    while let Some(arg) = it.next() {
        let (flag, inline) = match arg.split_once('=') {
            Some((f, v)) if f.starts_with("--") => (f.to_string(), Some(v.to_string())),
            _ => (arg.clone(), None),
        };
        let mut value = |name: &str| -> Result<String, String> {
            match inline.clone() {
                Some(v) => Ok(v),
                None => it.next().ok_or_else(|| format!("{name} needs a value")),
            }
        };
        match flag.as_str() {
            "-h" | "--help" => return Ok(ParsedArgs::Help),
            "--relay-url" => {
                let v = value("--relay-url")?;
                if v.is_empty() {
                    return Err("--relay-url must not be empty".into());
                }
                if !relay_urls.contains(&v) {
                    relay_urls.push(v);
                }
            }
            "--n0-relays" => {
                if inline.is_some() {
                    return Err("--n0-relays takes no value".into());
                }
                n0_relays = true;
            }
            "--alpn" => {
                let v = value("--alpn")?;
                if v.is_empty() {
                    return Err("--alpn must not be empty".into());
                }
                alpn = Some(v);
            }
            "--secret-key-file" => {
                let v = value("--secret-key-file")?;
                if v.is_empty() {
                    return Err("--secret-key-file must not be empty".into());
                }
                secret_key_file = Some(PathBuf::from(v));
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    Ok(ParsedArgs::Run(Config {
        relay_urls,
        n0_relays,
        alpn: alpn.unwrap_or_else(|| DEFAULT_ALPN.to_string()),
        secret_key_file,
    }))
}

pub fn relay_choice(cfg: &Config) -> RelayChoice {
    match (cfg.relay_urls.is_empty(), cfg.n0_relays) {
        (true, false) => RelayChoice::Disabled,
        (true, true) => RelayChoice::N0Default,
        (false, plus_n0) => RelayChoice::Custom {
            urls: cfg.relay_urls.clone(),
            plus_n0,
        },
    }
}

// ---------------------------------------------------------------------------
// Host -> sidecar
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    BadRequest,
    TooLarge,
    Unreachable,
    Timeout,
    Closed,
    Internal,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::BadRequest => "bad_request",
            ErrorCode::TooLarge => "too_large",
            ErrorCode::Unreachable => "unreachable",
            ErrorCode::Timeout => "timeout",
            ErrorCode::Closed => "closed",
            ErrorCode::Internal => "internal",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SendRequest {
    pub id: String,
    /// Unparsed; the iroh layer validates it (bad_request on failure).
    pub node_id: String,
    /// At most one relay per request (spec). Unparsed, as above.
    pub relay_url: Option<String>,
    pub direct_addrs: Vec<SocketAddr>,
    pub payload: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostMessage {
    Send(SendRequest),
    Ping { id: String },
    Close,
}

/// A line that must be answered with an `error`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LineError {
    /// The request id when the line was valid JSON carrying a string `id`;
    /// `None` when the line could not be parsed at all.
    pub id: Option<String>,
    pub code: ErrorCode,
    pub message: String,
}

impl LineError {
    fn new(id: Option<String>, code: ErrorCode, message: impl Into<String>) -> Self {
        LineError {
            id,
            code,
            message: message.into(),
        }
    }
}

/// Largest base64 string that can still decode to <= MAX_PAYLOAD_BYTES.
fn max_b64_len() -> usize {
    MAX_PAYLOAD_BYTES.div_ceil(3) * 4
}

/// Parse one host line (without its trailing newline; a trailing `\r` is
/// tolerated). Returns `Ok(None)` for a blank line, which is ignored.
pub fn parse_host_line(line: &[u8]) -> Result<Option<HostMessage>, LineError> {
    let line = strip_eol(line);
    if line.iter().all(|b| b.is_ascii_whitespace()) {
        return Ok(None);
    }
    let v: Value = serde_json::from_slice(line)
        .map_err(|_| LineError::new(None, ErrorCode::BadRequest, "line is not valid JSON"))?;
    let obj = v
        .as_object()
        .ok_or_else(|| LineError::new(None, ErrorCode::BadRequest, "line is not a JSON object"))?;
    let id: Option<String> = obj.get("id").and_then(Value::as_str).map(str::to_string);
    let bad = |msg: &str| LineError::new(id.clone(), ErrorCode::BadRequest, msg);

    let ty = obj
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| bad("missing or non-string \"type\""))?;

    match ty {
        "close" => Ok(Some(HostMessage::Close)),
        "ping" => {
            let id = id
                .clone()
                .ok_or_else(|| bad("ping needs a string \"id\""))?;
            Ok(Some(HostMessage::Ping { id }))
        }
        "send" => {
            let id = id
                .clone()
                .ok_or_else(|| bad("send needs a string \"id\""))?;
            let node_id = match obj.get("nodeId").and_then(Value::as_str) {
                Some(s) if !s.is_empty() => s.to_string(),
                _ => return Err(bad("send needs a non-empty string \"nodeId\"")),
            };
            let relay_url = match obj.get("relayUrl") {
                None | Some(Value::Null) => None,
                Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
                _ => return Err(bad("\"relayUrl\" must be a non-empty string or null")),
            };
            let direct_addrs = match obj.get("directAddrs") {
                None | Some(Value::Null) => Vec::new(),
                Some(Value::Array(items)) => {
                    let mut out = Vec::with_capacity(items.len());
                    for item in items {
                        let s = item
                            .as_str()
                            .ok_or_else(|| bad("\"directAddrs\" must be strings"))?;
                        let addr: SocketAddr = s
                            .parse()
                            .map_err(|_| bad("\"directAddrs\" entry is not ip:port"))?;
                        if !out.contains(&addr) {
                            out.push(addr);
                        }
                    }
                    out
                }
                _ => return Err(bad("\"directAddrs\" must be an array or null")),
            };
            let b64 = obj
                .get("payload")
                .and_then(Value::as_str)
                .ok_or_else(|| bad("send needs a base64 string \"payload\""))?;
            if b64.len() > max_b64_len() {
                return Err(LineError::new(
                    Some(id),
                    ErrorCode::TooLarge,
                    "payload exceeds 1 MiB",
                ));
            }
            let payload = B64
                .decode(b64)
                .map_err(|_| bad("\"payload\" is not valid base64"))?;
            if payload.len() > MAX_PAYLOAD_BYTES {
                return Err(LineError::new(
                    Some(id),
                    ErrorCode::TooLarge,
                    "payload exceeds 1 MiB",
                ));
            }
            Ok(Some(HostMessage::Send(SendRequest {
                id,
                node_id,
                relay_url,
                direct_addrs,
                payload,
            })))
        }
        _ => Err(bad("unknown \"type\"")),
    }
}

fn strip_eol(mut line: &[u8]) -> &[u8] {
    if let [rest @ .., b'\n'] = line {
        line = rest;
    }
    if let [rest @ .., b'\r'] = line {
        line = rest;
    }
    line
}

// ---------------------------------------------------------------------------
// Sidecar -> host (each returns one line WITHOUT the trailing newline)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Via {
    Relay,
    Direct,
    Unknown,
}

impl Via {
    pub fn as_str(self) -> &'static str {
        match self {
            Via::Relay => "relay",
            Via::Direct => "direct",
            Via::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    Info,
    Warn,
}

pub fn encode_ready(node_id: &str, direct_addrs: &[String], relay_url: Option<&str>) -> String {
    json!({
        "type": "ready",
        "v": PROTOCOL_VERSION,
        "nodeId": node_id,
        "directAddrs": direct_addrs,
        "relayUrl": relay_url,
    })
    .to_string()
}

pub fn encode_recv(from: &str, payload: &[u8]) -> String {
    json!({ "type": "recv", "from": from, "payload": B64.encode(payload) }).to_string()
}

pub fn encode_sent(id: &str, via: Via) -> String {
    json!({ "type": "sent", "id": id, "via": via.as_str() }).to_string()
}

pub fn encode_pong(id: &str) -> String {
    json!({ "type": "pong", "id": id }).to_string()
}

pub fn encode_error(id: Option<&str>, code: ErrorCode, message: &str) -> String {
    json!({ "type": "error", "id": id, "code": code.as_str(), "message": message }).to_string()
}

pub fn encode_log(level: LogLevel, message: &str) -> String {
    let level = match level {
        LogLevel::Info => "info",
        LogLevel::Warn => "warn",
    };
    json!({ "type": "log", "level": level, "message": message }).to_string()
}

/// Error code for a failed send attempt: before a connection exists it is
/// `unreachable`; once connected, a missing ack is `timeout`.
pub fn failure_code(connected: bool) -> ErrorCode {
    if connected {
        ErrorCode::Timeout
    } else {
        ErrorCode::Unreachable
    }
}

// ---------------------------------------------------------------------------
// Framing between two sidecars: u32 BE length, payload, FIN; ack 0x01, FIN.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameTooLarge;

pub fn encode_frame_header(len: usize) -> Result<[u8; 4], FrameTooLarge> {
    if len > MAX_PAYLOAD_BYTES {
        return Err(FrameTooLarge);
    }
    Ok((len as u32).to_be_bytes())
}

pub fn decode_frame_len(header: [u8; 4]) -> Result<usize, FrameTooLarge> {
    let len = u32::from_be_bytes(header) as usize;
    if len > MAX_PAYLOAD_BYTES {
        return Err(FrameTooLarge);
    }
    Ok(len)
}

// ---------------------------------------------------------------------------
// Hex for the secret key file (32 bytes, lowercase hex, optional newline).
// Error messages never echo the input.
// ---------------------------------------------------------------------------

pub fn hex_encode(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(DIGITS[(b >> 4) as usize] as char);
        s.push(DIGITS[(b & 0x0f) as usize] as char);
    }
    s
}

pub fn hex_decode_32(s: &str) -> Result<[u8; 32], &'static str> {
    let s = s.trim();
    if s.len() != 64 {
        return Err("expected 64 hex characters");
    }
    let raw = s.as_bytes();
    let mut out = [0u8; 32];
    for (i, slot) in out.iter_mut().enumerate() {
        let hi = hex_val(raw[2 * i]).ok_or("non-hex character")?;
        let lo = hex_val(raw[2 * i + 1]).ok_or("non-hex character")?;
        *slot = (hi << 4) | lo;
    }
    Ok(out)
}

fn hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Tests (written first; run with `cargo test`)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn run(args: &[&str]) -> Config {
        match parse_args(args.iter().copied()).expect("args parse") {
            ParsedArgs::Run(c) => c,
            ParsedArgs::Help => panic!("unexpected help"),
        }
    }

    fn line(v: Value) -> Vec<u8> {
        v.to_string().into_bytes()
    }

    fn parsed(v: Value) -> HostMessage {
        parse_host_line(&line(v)).expect("ok").expect("not blank")
    }

    fn err(v: Value) -> LineError {
        parse_host_line(&line(v)).expect_err("should fail")
    }

    // --- args ---

    #[test]
    fn args_default_is_no_relay_default_alpn_ephemeral_key() {
        let c = run(&[]);
        assert_eq!(c.relay_urls, Vec::<String>::new());
        assert!(!c.n0_relays);
        assert_eq!(c.alpn, "trustweb/didcomm/0.1");
        assert_eq!(c.secret_key_file, None);
        assert_eq!(relay_choice(&c), RelayChoice::Disabled);
    }

    #[test]
    fn args_relay_url_repeatable_ordered_and_deduped() {
        let c = run(&[
            "--relay-url",
            "https://a.example",
            "--relay-url=https://b.example",
            "--relay-url",
            "https://a.example",
        ]);
        assert_eq!(c.relay_urls, vec!["https://a.example", "https://b.example"]);
        assert_eq!(
            relay_choice(&c),
            RelayChoice::Custom {
                urls: vec!["https://a.example".into(), "https://b.example".into()],
                plus_n0: false
            }
        );
    }

    #[test]
    fn args_n0_relays_is_explicit_opt_in() {
        let c = run(&["--n0-relays"]);
        assert!(c.n0_relays);
        assert_eq!(relay_choice(&c), RelayChoice::N0Default);
        let both = run(&["--relay-url", "https://a.example", "--n0-relays"]);
        assert_eq!(
            relay_choice(&both),
            RelayChoice::Custom {
                urls: vec!["https://a.example".into()],
                plus_n0: true
            }
        );
    }

    #[test]
    fn args_alpn_and_secret_key_file() {
        let c = run(&["--alpn", "x/1", "--secret-key-file", "/tmp/k"]);
        assert_eq!(c.alpn, "x/1");
        assert_eq!(c.secret_key_file, Some(PathBuf::from("/tmp/k")));
        let c = run(&["--alpn=y/2", "--secret-key-file=/tmp/j"]);
        assert_eq!(c.alpn, "y/2");
        assert_eq!(c.secret_key_file, Some(PathBuf::from("/tmp/j")));
    }

    #[test]
    fn args_errors() {
        assert!(parse_args(["--relay-url"]).is_err());
        assert!(parse_args(["--alpn", ""]).is_err());
        assert!(parse_args(["--bogus"]).is_err());
        assert!(parse_args(["positional"]).is_err());
        assert!(parse_args(["--n0-relays=yes"]).is_err());
        assert_eq!(parse_args(["--help"]), Ok(ParsedArgs::Help));
        assert_eq!(parse_args(["-h"]), Ok(ParsedArgs::Help));
    }

    // --- host -> sidecar ---

    #[test]
    fn parses_send_with_all_fields() {
        let m = parsed(json!({
            "type": "send", "id": "r1", "nodeId": "abc",
            "relayUrl": "https://relay.example",
            "directAddrs": ["127.0.0.1:4000", "[::1]:4001"],
            "payload": B64.encode(b"hello"),
            "extra": "ignored"
        }));
        assert_eq!(
            m,
            HostMessage::Send(SendRequest {
                id: "r1".into(),
                node_id: "abc".into(),
                relay_url: Some("https://relay.example".into()),
                direct_addrs: vec![
                    "127.0.0.1:4000".parse().unwrap(),
                    "[::1]:4001".parse().unwrap()
                ],
                payload: b"hello".to_vec(),
            })
        );
    }

    #[test]
    fn parses_send_with_null_relay_and_missing_direct_addrs() {
        let m = parsed(json!({
            "type": "send", "id": "r2", "nodeId": "abc", "relayUrl": null,
            "payload": B64.encode([0u8, 1, 2])
        }));
        match m {
            HostMessage::Send(s) => {
                assert_eq!(s.relay_url, None);
                assert!(s.direct_addrs.is_empty());
                assert_eq!(s.payload, vec![0, 1, 2]);
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn parses_ping_and_close_and_tolerates_crlf_and_blank() {
        assert_eq!(
            parsed(json!({"type":"ping","id":"p"})),
            HostMessage::Ping { id: "p".into() }
        );
        assert_eq!(parsed(json!({"type":"close"})), HostMessage::Close);
        assert_eq!(
            parse_host_line(b"{\"type\":\"close\"}\r\n"),
            Ok(Some(HostMessage::Close))
        );
        assert_eq!(parse_host_line(b""), Ok(None));
        assert_eq!(parse_host_line(b"   \n"), Ok(None));
    }

    #[test]
    fn malformed_line_is_bad_request_with_null_id() {
        let malformed: [&[u8]; 5] = [
            b"not json",
            b"[1,2]",
            b"\"str\"",
            b"{\"type\":",
            b"\xff\xfe",
        ];
        for raw in malformed {
            let e = parse_host_line(raw).expect_err("malformed");
            assert_eq!(e.id, None);
            assert_eq!(e.code, ErrorCode::BadRequest);
        }
    }

    #[test]
    fn unknown_type_is_bad_request_echoing_id() {
        let e = err(json!({"type":"dance","id":"x"}));
        assert_eq!(e.code, ErrorCode::BadRequest);
        assert_eq!(e.id.as_deref(), Some("x"));
        let e = err(json!({"id":"y"}));
        assert_eq!(
            (e.code, e.id.as_deref()),
            (ErrorCode::BadRequest, Some("y"))
        );
    }

    #[test]
    fn send_field_errors_are_bad_request() {
        let base = |patch: Value| {
            let mut v = json!({"type":"send","id":"s","nodeId":"n","payload":""});
            for (k, val) in patch.as_object().unwrap() {
                v[k.as_str()] = val.clone();
            }
            v
        };
        for bad in [
            base(json!({"nodeId": 5})),
            base(json!({"nodeId": ""})),
            base(json!({"relayUrl": 7})),
            base(json!({"relayUrl": ""})),
            base(json!({"directAddrs": "1.2.3.4:5"})),
            base(json!({"directAddrs": ["nope"]})),
            base(json!({"directAddrs": [1]})),
            base(json!({"payload": "@@not base64@@"})),
            base(json!({"payload": 3})),
        ] {
            let e = err(bad.clone());
            assert_eq!(e.code, ErrorCode::BadRequest, "for {bad}");
            assert_eq!(e.id.as_deref(), Some("s"), "for {bad}");
        }
        let e = err(json!({"type":"send","nodeId":"n","payload":""}));
        assert_eq!((e.code, e.id), (ErrorCode::BadRequest, None));
        let e = err(json!({"type":"ping"}));
        assert_eq!((e.code, e.id), (ErrorCode::BadRequest, None));
    }

    #[test]
    fn payload_limit_is_exactly_one_mib() {
        let ok = vec![7u8; MAX_PAYLOAD_BYTES];
        match parsed(json!({"type":"send","id":"a","nodeId":"n","payload":B64.encode(&ok)})) {
            HostMessage::Send(s) => assert_eq!(s.payload.len(), MAX_PAYLOAD_BYTES),
            other => panic!("unexpected {other:?}"),
        }
        let big = vec![7u8; MAX_PAYLOAD_BYTES + 1];
        let e = err(json!({"type":"send","id":"b","nodeId":"n","payload":B64.encode(&big)}));
        assert_eq!((e.code, e.id.as_deref()), (ErrorCode::TooLarge, Some("b")));
    }

    #[test]
    fn empty_payload_is_allowed_on_the_wire() {
        match parsed(json!({"type":"send","id":"e","nodeId":"n","payload":""})) {
            HostMessage::Send(s) => assert!(s.payload.is_empty()),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn duplicate_direct_addrs_are_collapsed() {
        match parsed(json!({"type":"send","id":"d","nodeId":"n","payload":"",
                            "directAddrs":["1.2.3.4:5","1.2.3.4:5"]}))
        {
            HostMessage::Send(s) => assert_eq!(s.direct_addrs.len(), 1),
            other => panic!("unexpected {other:?}"),
        }
    }

    // --- sidecar -> host ---

    fn decode(s: &str) -> Value {
        assert!(!s.contains('\n'), "a line must not contain a newline");
        serde_json::from_str(s).expect("valid json")
    }

    #[test]
    fn encodes_ready() {
        let v = decode(&encode_ready(
            "nid",
            &["1.2.3.4:5".into()],
            Some("https://r.example/"),
        ));
        assert_eq!(
            v,
            json!({"type":"ready","v":1,"nodeId":"nid","directAddrs":["1.2.3.4:5"],
                   "relayUrl":"https://r.example/"})
        );
        let v = decode(&encode_ready("nid", &[], None));
        assert_eq!(v["relayUrl"], Value::Null);
        assert_eq!(v["directAddrs"], json!([]));
    }

    #[test]
    fn encodes_recv_sent_pong_error_log() {
        assert_eq!(
            decode(&encode_recv("peer", b"\x00\xffhi")),
            json!({"type":"recv","from":"peer","payload":B64.encode(b"\x00\xffhi")})
        );
        assert_eq!(
            decode(&encode_sent("r1", Via::Direct)),
            json!({"type":"sent","id":"r1","via":"direct"})
        );
        assert_eq!(decode(&encode_sent("r", Via::Relay))["via"], "relay");
        assert_eq!(decode(&encode_sent("r", Via::Unknown))["via"], "unknown");
        assert_eq!(decode(&encode_pong("p")), json!({"type":"pong","id":"p"}));
        assert_eq!(
            decode(&encode_error(Some("r"), ErrorCode::Unreachable, "no route")),
            json!({"type":"error","id":"r","code":"unreachable","message":"no route"})
        );
        assert_eq!(
            decode(&encode_error(None, ErrorCode::BadRequest, "x"))["id"],
            Value::Null
        );
        assert_eq!(
            decode(&encode_log(LogLevel::Warn, "w\nx")),
            json!({"type":"log","level":"warn","message":"w\nx"})
        );
    }

    #[test]
    fn error_code_strings_match_spec() {
        let all = [
            (ErrorCode::BadRequest, "bad_request"),
            (ErrorCode::TooLarge, "too_large"),
            (ErrorCode::Unreachable, "unreachable"),
            (ErrorCode::Timeout, "timeout"),
            (ErrorCode::Closed, "closed"),
            (ErrorCode::Internal, "internal"),
        ];
        for (c, s) in all {
            assert_eq!(c.as_str(), s);
        }
        assert_eq!(failure_code(false), ErrorCode::Unreachable);
        assert_eq!(failure_code(true), ErrorCode::Timeout);
    }

    #[test]
    fn ids_with_quotes_are_escaped() {
        let v = decode(&encode_pong("a\"b\\c"));
        assert_eq!(v["id"], "a\"b\\c");
    }

    // --- framing ---

    #[test]
    fn frame_header_is_u32_big_endian() {
        assert_eq!(encode_frame_header(0), Ok([0, 0, 0, 0]));
        assert_eq!(encode_frame_header(0x0102), Ok([0, 0, 1, 2]));
        assert_eq!(encode_frame_header(MAX_PAYLOAD_BYTES), Ok([0, 0x10, 0, 0]));
        assert_eq!(
            encode_frame_header(MAX_PAYLOAD_BYTES + 1),
            Err(FrameTooLarge)
        );
    }

    #[test]
    fn frame_len_decoding_enforces_limit() {
        assert_eq!(decode_frame_len([0, 0, 1, 2]), Ok(0x0102));
        assert_eq!(decode_frame_len([0, 0x10, 0, 0]), Ok(MAX_PAYLOAD_BYTES));
        assert_eq!(decode_frame_len([0, 0x10, 0, 1]), Err(FrameTooLarge));
        assert_eq!(
            decode_frame_len([0xff, 0xff, 0xff, 0xff]),
            Err(FrameTooLarge)
        );
        for n in [0usize, 1, 255, 65_536, MAX_PAYLOAD_BYTES] {
            assert_eq!(decode_frame_len(encode_frame_header(n).unwrap()), Ok(n));
        }
        assert_eq!(ACK, 0x01);
    }

    // --- hex ---

    #[test]
    fn hex_roundtrip_and_errors() {
        let bytes: [u8; 32] = core::array::from_fn(|i| (i * 9) as u8);
        let s = hex_encode(&bytes);
        assert_eq!(s.len(), 64);
        assert_eq!(&s[..4], "0009");
        assert_eq!(hex_decode_32(&s), Ok(bytes));
        assert_eq!(hex_decode_32(&format!("{}\n", s.to_uppercase())), Ok(bytes));
        assert!(hex_decode_32("abc").is_err());
        assert!(hex_decode_32(&"zz".repeat(32)).is_err());
    }

    #[test]
    fn hex_errors_do_not_echo_input() {
        let secret = "g".repeat(64);
        let e = hex_decode_32(&secret).unwrap_err();
        assert!(!e.contains('g'));
    }
}
