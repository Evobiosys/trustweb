// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
//! trustweb-iroh-sidecar: the real iroh node behind `IrohSidecarEndpoint`.
//!
//! Implements docs/IROH-SIDECAR.md (protocol v1) and nothing else: JSON lines
//! on stdin/stdout to the host, one bidirectional QUIC stream per payload to
//! other sidecars. Pure logic lives in `protocol.rs`; this file is the I/O.
//!
//! Never logs payload bytes or the secret key, on stdout or stderr.

mod protocol;

use std::io::Write as _;
use std::net::SocketAddr;
use std::path::Path;
use std::process::ExitCode;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{anyhow, bail, Context as _, Result};
use iroh::endpoint::{Connection, ConnectionType, RecvStream, SendStream};
use iroh::{
    Endpoint, NodeAddr, NodeId, RelayMap, RelayMode, RelayNode, RelayUrl, SecretKey, Watcher as _,
};
use tokio::io::AsyncBufReadExt as _;
use tokio::sync::watch;
use tokio::task::JoinSet;
use tokio::time::{timeout, timeout_at, Instant};

use protocol::{
    decode_frame_len, encode_error, encode_frame_header, encode_log, encode_pong, encode_ready,
    encode_recv, encode_sent, failure_code, hex_decode_32, hex_encode, parse_args, parse_host_line,
    relay_choice, Config, ErrorCode, HostMessage, LogLevel, ParsedArgs, RelayChoice, SendRequest,
    Via, ACK, USAGE,
};

/// Overall budget for one `send` (connect + write + ack), per spec.
const ATTEMPT_TIMEOUT: Duration = Duration::from_secs(15);
/// Budget for an inbound stream to deliver its frame.
const INBOUND_STREAM_TIMEOUT: Duration = Duration::from_secs(15);
/// How long to wait for direct addresses before printing `ready`.
const DIRECT_ADDRS_WAIT: Duration = Duration::from_secs(3);
/// How long to wait for a home relay before printing `ready` (host waits <= 10 s).
const HOME_RELAY_WAIT: Duration = Duration::from_secs(5);
/// Grace for in-flight sends and the endpoint on shutdown (host SIGTERMs after 2 s).
const SHUTDOWN_GRACE: Duration = Duration::from_millis(1500);

/// The one stdout writer. Every protocol line goes through here, under one
/// lock, as a single write + flush, so lines never interleave.
#[derive(Clone)]
struct Out(Arc<Mutex<std::io::Stdout>>);

impl Out {
    fn new() -> Self {
        Out(Arc::new(Mutex::new(std::io::stdout())))
    }

    fn line(&self, line: &str) {
        let mut buf = String::with_capacity(line.len() + 1);
        buf.push_str(line);
        buf.push('\n');
        let mut guard = match self.0.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        // A broken stdout means the host is gone; stdin EOF will end us.
        let _ = guard.write_all(buf.as_bytes()).and_then(|_| guard.flush());
    }

    fn error(&self, id: Option<&str>, code: ErrorCode, message: &str) {
        self.line(&encode_error(id, code, message));
    }

    fn log(&self, level: LogLevel, message: &str) {
        self.line(&encode_log(level, message));
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    let cfg = match parse_args(std::env::args().skip(1)) {
        Ok(ParsedArgs::Run(cfg)) => cfg,
        Ok(ParsedArgs::Help) => {
            eprintln!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Err(e) => {
            eprintln!("trustweb-iroh-sidecar: {e}\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    match run(cfg).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("trustweb-iroh-sidecar: fatal: {e:#}");
            ExitCode::FAILURE
        }
    }
}

async fn run(cfg: Config) -> Result<()> {
    let out = Out::new();
    let alpn: Arc<Vec<u8>> = Arc::new(cfg.alpn.as_bytes().to_vec());
    let choice = relay_choice(&cfg);
    let relays_enabled = choice != RelayChoice::Disabled;

    let mut builder = Endpoint::builder()
        .alpns(vec![alpn.to_vec()])
        .relay_mode(build_relay_mode(&choice)?);
    // No discovery service is configured on purpose: nothing is published
    // to n0's DNS/pkarr servers. Addresses travel via the host only.
    if let Some(path) = &cfg.secret_key_file {
        builder = builder.secret_key(load_or_create_secret_key(path)?);
    }
    let endpoint = builder.bind().await.context("binding the iroh endpoint")?;

    // --- ready ---------------------------------------------------------------
    let (direct_addrs, home_relay) = tokio::join!(
        wait_direct_addrs(&endpoint),
        wait_home_relay(&endpoint, relays_enabled)
    );
    out.line(&encode_ready(
        &endpoint.node_id().to_string(),
        &direct_addrs,
        home_relay.as_ref().map(|u| u.to_string()).as_deref(),
    ));
    if matches!(
        choice,
        RelayChoice::N0Default | RelayChoice::Custom { plus_n0: true, .. }
    ) {
        out.log(
            LogLevel::Warn,
            "n0 public relays enabled (--n0-relays): operated by n0, outside the EU",
        );
    }
    if relays_enabled && home_relay.is_none() {
        out.log(LogLevel::Warn, "no home relay reachable yet; continuing");
    }

    // --- accept loop ---------------------------------------------------------
    let accept_task = tokio::spawn(accept_loop(endpoint.clone(), out.clone()));

    // --- stdin loop ----------------------------------------------------------
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let mut sends: JoinSet<()> = JoinSet::new();
    let mut stdin = tokio::io::BufReader::new(tokio::io::stdin());
    let mut buf: Vec<u8> = Vec::new();

    loop {
        buf.clear();
        // Not inside select!: read_until is not cancel-safe.
        match stdin.read_until(b'\n', &mut buf).await {
            Ok(0) => break, // EOF: same as `close`
            Ok(_) => {}
            Err(e) => {
                eprintln!("trustweb-iroh-sidecar: stdin error: {e}");
                break;
            }
        }
        // Reap finished send tasks so the set does not grow without bound.
        while sends.try_join_next().is_some() {}

        match parse_host_line(&buf) {
            Ok(None) => {}
            Ok(Some(HostMessage::Close)) => break,
            Ok(Some(HostMessage::Ping { id })) => out.line(&encode_pong(&id)),
            Ok(Some(HostMessage::Send(req))) => {
                let target = match node_addr_for(&req) {
                    Ok(t) => t,
                    Err(msg) => {
                        out.error(Some(&req.id), ErrorCode::BadRequest, &msg);
                        continue;
                    }
                };
                // Own task per send: one slow peer never blocks the others.
                let endpoint = endpoint.clone();
                let alpn = alpn.clone();
                let out = out.clone();
                let mut shutdown = shutdown_rx.clone();
                sends.spawn(async move {
                    let result = tokio::select! {
                        r = send_one(&endpoint, &alpn, target, &req.payload) => r,
                        _ = shutdown.changed() => {
                            Err((ErrorCode::Closed, "endpoint shutting down".to_string()))
                        }
                    };
                    match result {
                        Ok(via) => out.line(&encode_sent(&req.id, via)),
                        Err((code, msg)) => out.error(Some(&req.id), code, &msg),
                    }
                });
            }
            Err(e) => out.error(e.id.as_deref(), e.code, &e.message),
        }
    }

    // --- shutdown ------------------------------------------------------------
    let _ = shutdown_tx.send(true);
    let _ = timeout(SHUTDOWN_GRACE, async {
        while sends.join_next().await.is_some() {}
    })
    .await;
    sends.abort_all();
    let _ = timeout(SHUTDOWN_GRACE, endpoint.close()).await;
    accept_task.abort();
    Ok(())
}

// ---------------------------------------------------------------------------
// Endpoint setup
// ---------------------------------------------------------------------------

fn build_relay_mode(choice: &RelayChoice) -> Result<RelayMode> {
    Ok(match choice {
        RelayChoice::Disabled => RelayMode::Disabled,
        RelayChoice::N0Default => RelayMode::Default,
        RelayChoice::Custom { urls, plus_n0 } => {
            let mut parsed: Vec<RelayUrl> = Vec::with_capacity(urls.len());
            for u in urls {
                let url: RelayUrl = u.parse().map_err(|_| anyhow!("invalid --relay-url: {u}"))?;
                if !parsed.contains(&url) {
                    parsed.push(url);
                }
            }
            if *plus_n0 {
                for url in iroh::defaults::prod::default_relay_map().urls() {
                    if !parsed.contains(url) {
                        parsed.push(url.clone());
                    }
                }
            }
            RelayMode::Custom(relay_map_from_urls(parsed)?)
        }
    })
}

/// NOTE: iroh picks the home relay by measured latency, not by list order.
fn relay_map_from_urls(urls: Vec<RelayUrl>) -> Result<RelayMap> {
    let nodes = urls.into_iter().map(|url| RelayNode {
        url,
        stun_only: false,
        stun_port: iroh::defaults::DEFAULT_STUN_PORT,
        quic: Some(iroh::RelayQuicConfig::default()),
    });
    RelayMap::from_nodes(nodes).context("building the relay map")
}

/// Read a 32-byte hex secret key, or create one (mode 0600) if absent.
/// Neither the key nor the file's contents ever appear in an error message.
fn load_or_create_secret_key(path: &Path) -> Result<SecretKey> {
    match std::fs::read_to_string(path) {
        Ok(text) => {
            let bytes = hex_decode_32(&text)
                .map_err(|why| anyhow!("secret key file {}: {why}", path.display()))?;
            warn_if_loose_permissions(path);
            Ok(SecretKey::from_bytes(&bytes))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let bytes = random_32().context("generating a secret key")?;
            write_secret_file(path, &hex_encode(&bytes))
                .with_context(|| format!("writing secret key file {}", path.display()))?;
            eprintln!(
                "trustweb-iroh-sidecar: created secret key file {} (0600)",
                path.display()
            );
            Ok(SecretKey::from_bytes(&bytes))
        }
        Err(e) => Err(e).with_context(|| format!("reading secret key file {}", path.display())),
    }
}

#[cfg(unix)]
fn write_secret_file(path: &Path, hex: &str) -> std::io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt as _;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    f.write_all(hex.as_bytes())?;
    f.write_all(b"\n")?;
    f.sync_all()
}

#[cfg(not(unix))]
fn write_secret_file(_path: &Path, _hex: &str) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "--secret-key-file is only supported on unix (needs mode 0600)",
    ))
}

#[cfg(unix)]
fn warn_if_loose_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt as _;
    if let Ok(meta) = std::fs::metadata(path) {
        if meta.permissions().mode() & 0o077 != 0 {
            eprintln!(
                "trustweb-iroh-sidecar: warning: {} is readable by group/others; chmod 600 it",
                path.display()
            );
        }
    }
}

#[cfg(not(unix))]
fn warn_if_loose_permissions(_path: &Path) {}

#[cfg(unix)]
fn random_32() -> std::io::Result<[u8; 32]> {
    use std::io::Read as _;
    let mut bytes = [0u8; 32];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes)
}

#[cfg(not(unix))]
fn random_32() -> std::io::Result<[u8; 32]> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "no /dev/urandom on this platform",
    ))
}

async fn wait_direct_addrs(endpoint: &Endpoint) -> Vec<String> {
    let mut watcher = endpoint.direct_addresses();
    match timeout(DIRECT_ADDRS_WAIT, watcher.initialized()).await {
        Ok(Ok(set)) => set.into_iter().map(|d| d.addr.to_string()).collect(),
        _ => Vec::new(),
    }
}

async fn wait_home_relay(endpoint: &Endpoint, enabled: bool) -> Option<RelayUrl> {
    if !enabled {
        return None;
    }
    let mut watcher = endpoint.home_relay();
    match timeout(HOME_RELAY_WAIT, watcher.initialized()).await {
        Ok(Ok(url)) => Some(url),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

fn node_addr_for(req: &SendRequest) -> std::result::Result<NodeAddr, String> {
    let node_id: NodeId = req
        .node_id
        .parse()
        .map_err(|_| "\"nodeId\" is not a valid iroh node id".to_string())?;
    let relay_url: Option<RelayUrl> = match &req.relay_url {
        None => None,
        Some(u) => Some(
            u.parse()
                .map_err(|_| "\"relayUrl\" is not a valid relay URL".to_string())?,
        ),
    };
    let direct: Vec<SocketAddr> = req.direct_addrs.clone();
    Ok(NodeAddr::from_parts(node_id, relay_url, direct))
}

/// One attempt: connect, one bi stream, frame, FIN, wait for the ack byte.
/// Everything inside one 15 s deadline.
async fn send_one(
    endpoint: &Endpoint,
    alpn: &[u8],
    target: NodeAddr,
    payload: &[u8],
) -> std::result::Result<Via, (ErrorCode, String)> {
    let deadline = Instant::now() + ATTEMPT_TIMEOUT;
    let node_id = target.node_id;

    let conn = match timeout_at(deadline, endpoint.connect(target, alpn)).await {
        Err(_) => {
            return Err((
                failure_code(false),
                "no connection within the attempt timeout".to_string(),
            ))
        }
        Ok(Err(e)) => return Err((failure_code(false), format!("connect failed: {e}"))),
        Ok(Ok(conn)) => conn,
    };

    let exchanged = timeout_at(deadline, exchange(&conn, payload)).await;
    let via = via_for(endpoint, node_id);
    conn.close(0u32.into(), b"done");
    match exchanged {
        Ok(Ok(())) => Ok(via),
        Ok(Err(e)) => Err((failure_code(true), format!("connected, no ack: {e}"))),
        Err(_) => Err((
            failure_code(true),
            "connected, no ack within the attempt timeout".to_string(),
        )),
    }
}

async fn exchange(conn: &Connection, payload: &[u8]) -> Result<()> {
    let header = encode_frame_header(payload.len()).map_err(|_| anyhow!("payload too large"))?;
    let (mut send, mut recv) = conn.open_bi().await.context("open_bi")?;
    send.write_all(&header).await.context("write length")?;
    send.write_all(payload).await.context("write payload")?;
    send.finish().context("finish")?;
    let mut ack = [0u8; 1];
    recv.read_exact(&mut ack).await.context("read ack")?;
    if ack[0] != ACK {
        bail!("unexpected ack byte");
    }
    Ok(())
}

fn via_for(endpoint: &Endpoint, node_id: NodeId) -> Via {
    let Ok(mut watcher) = endpoint.conn_type(node_id) else {
        return Via::Unknown;
    };
    match watcher.get() {
        Ok(ConnectionType::Direct(_)) => Via::Direct,
        // Mixed = relay path still carrying traffic; report the
        // metadata-visible path conservatively.
        Ok(ConnectionType::Relay(_)) | Ok(ConnectionType::Mixed(..)) => Via::Relay,
        _ => Via::Unknown,
    }
}

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

async fn accept_loop(endpoint: Endpoint, out: Out) {
    while let Some(incoming) = endpoint.accept().await {
        let out = out.clone();
        tokio::spawn(async move {
            let connecting = match incoming.accept() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("trustweb-iroh-sidecar: inbound refused: {e}");
                    return;
                }
            };
            let conn = match connecting.await {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("trustweb-iroh-sidecar: inbound handshake failed: {e}");
                    return;
                }
            };
            let from = match iroh::endpoint::get_remote_node_id(&conn) {
                Ok(id) => id.to_string(),
                Err(_) => {
                    conn.close(1u32.into(), b"no node id");
                    return;
                }
            };
            // One payload per bi stream; the sender closes the connection.
            while let Ok((send, recv)) = conn.accept_bi().await {
                let out = out.clone();
                let from = from.clone();
                tokio::spawn(async move {
                    match timeout(
                        INBOUND_STREAM_TIMEOUT,
                        handle_stream(send, recv, &from, &out),
                    )
                    .await
                    {
                        Ok(Ok(())) => {}
                        Ok(Err(e)) => {
                            eprintln!("trustweb-iroh-sidecar: inbound stream dropped: {e:#}")
                        }
                        Err(_) => eprintln!("trustweb-iroh-sidecar: inbound stream timed out"),
                    }
                });
            }
        });
    }
}

async fn handle_stream(
    mut send: SendStream,
    mut recv: RecvStream,
    from: &str,
    out: &Out,
) -> Result<()> {
    let mut header = [0u8; 4];
    recv.read_exact(&mut header).await.context("read length")?;
    let len = match decode_frame_len(header) {
        Ok(len) => len,
        Err(_) => {
            // Over 1 MiB: close the stream without an ack.
            let _ = recv.stop(0u32.into());
            let _ = send.reset(0u32.into());
            bail!("oversized frame refused");
        }
    };
    let mut payload = vec![0u8; len];
    recv.read_exact(&mut payload)
        .await
        .context("read payload")?;
    // Hand to the host first, then ack (spec: ack after `recv` is printed).
    out.line(&encode_recv(from, &payload));
    send.write_all(&[ACK]).await.context("write ack")?;
    send.finish().context("finish")?;
    Ok(())
}
