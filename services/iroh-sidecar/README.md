<!-- SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later -->
# trustweb-iroh-sidecar

The real [iroh](https://www.iroh.computer) node behind `IrohSidecarEndpoint`
(`packages/transport/src/iroh_sidecar_endpoint.ts`). The daemon spawns it as a
child process and talks to it in JSON lines on stdin/stdout; sidecars talk to
each other over iroh QUIC, one bidirectional stream per payload.

**Protocol:** [`docs/IROH-SIDECAR.md`](../../docs/IROH-SIDECAR.md) is the
contract (v1). This crate implements it and nothing else; it is not repeated
here. Background: [`docs/IROH-RELAY.md`](../../docs/IROH-RELAY.md).

## Build

```sh
cd services/iroh-sidecar
cargo build --release          # -> target/release/trustweb-iroh-sidecar
```

Requires network access to crates.io on first build. Unix only
(`/dev/urandom`, 0600 key file).

## Flags

```
trustweb-iroh-sidecar [--relay-url <url>]... [--alpn <string>] [--secret-key-file <path>] [--n0-relays]
```

| Flag | Effect |
| --- | --- |
| *(none)* | **No relay.** Direct connections only, ephemeral key, ALPN `trustweb/didcomm/0.1`. |
| `--relay-url <url>` | Repeatable. Relays this node may use as home relay. iroh picks among them by latency, not list order. |
| `--n0-relays` | Explicit opt-in to n0's public relays (operated by n0, **outside the EU**). Never implied. Combined with `--relay-url`, the n0 relays are added after yours. |
| `--alpn <string>` | ALPN for TrustWeb connections. |
| `--secret-key-file <path>` | 32-byte key as 64 hex chars. Read if present, else generated and written with mode 0600. Keeps the node id stable across restarts. |

Both forms `--flag value` and `--flag=value` work. `--help` prints usage to stderr.

## Security notes

- Secret key file is created with mode 0600 (`create_new`, never overwritten);
  a warning goes to stderr if an existing file is group/world readable.
- Payload bytes and the secret key are never printed, on stdout or stderr.
  stderr carries short human diagnostics only (no tracing subscriber is
  installed, so iroh's own logs are not emitted).
- Default is **no relay** (I9). `--n0-relays` must be passed explicitly.
- No discovery service is configured: nothing is published to n0's DNS/pkarr
  servers. Peer addresses arrive from the host in each `send`.
- Inbound frames over 1 MiB are refused (stream reset, no ack). Each inbound
  stream has a 15 s budget.
- I7: iroh encrypts end to end between node keys, but a relay operator still
  sees node ids, addresses, timing and sizes. This is not zero-knowledge.

## Behaviour choices beyond the spec text

- `via` in `sent` comes from `Endpoint::conn_type` after the ack: `Direct` ->
  `direct`, `Relay` or `Mixed` -> `relay` (conservative), otherwise `unknown`.
- A connect error before the 15 s deadline is answered at once with
  `unreachable`; after a connection exists, any failure to get the ack
  (stream reset, wrong ack byte, deadline) is `timeout`.
- A line that is valid JSON but has a bad field echoes its string `id` in the
  `error`; only unparseable lines get `id: null`. Blank lines are ignored.
- On `close` / stdin EOF, in-flight sends are answered with `closed`, the
  endpoint is closed (bounded to 1.5 s) and the process exits 0.
- The receiver prints `recv` first and then writes the ack byte.

## Verify

```sh
# 1. build and run the unit tests (pure protocol logic: src/protocol.rs)
cd services/iroh-sidecar
cargo build --release
cargo test
cargo clippy --all-targets -- -D warnings   # optional

# 2. TypeScript integration test against two real sidecars (from repo root)
cd ../..
TRUSTWEB_IROH_SIDECAR=$PWD/services/iroh-sidecar/target/release/trustweb-iroh-sidecar \
  pnpm --filter @resource-web/transport test -- iroh_sidecar.integration
```

Commit the generated `Cargo.lock` after the first successful build.

## Not yet compiled in this session; API assumptions

This crate was written **without compiling it**: the authoring container had
no access to crates.io. It targets **iroh 0.35.0** (pinned with `=`), the
last release before the 0.9x API changes (`Connection` wrapper, watcher
changes, `NodeAddr` -> `EndpointAddr`). A reviewer with network should check
these calls first; they are all in `src/main.rs`:

1. `iroh::Endpoint::builder().alpns(Vec<Vec<u8>>).relay_mode(RelayMode).secret_key(SecretKey).bind().await -> Result<Endpoint>`; no discovery by default.
2. `iroh::RelayMode::{Disabled, Default, Custom(RelayMap)}`.
3. `iroh::RelayMap::from_nodes(impl IntoIterator<Item = RelayNode>) -> Result<RelayMap>` and `RelayMap::urls() -> impl Iterator<Item = &RelayUrl>`.
4. `iroh::RelayNode { url, stun_only, stun_port, quic: Option<RelayQuicConfig> }` struct literal, `iroh::RelayQuicConfig::default()`, `iroh::defaults::DEFAULT_STUN_PORT`, `iroh::defaults::prod::default_relay_map()` (**most fragile**).
5. `RelayUrl: FromStr` and `Display`; `NodeId: FromStr` (accepts the canonical string) and `Display` (emits it).
6. `iroh::SecretKey::from_bytes(&[u8; 32])`.
7. `iroh::Watcher` trait re-export; `endpoint.direct_addresses()` watcher whose `.initialized().await` yields `Result<BTreeSet<DirectAddr>, _>` with `DirectAddr.addr: SocketAddr`; `endpoint.home_relay()` watcher whose `.initialized().await` yields `Result<RelayUrl, _>`.
8. `endpoint.node_id() -> NodeId`.
9. `NodeAddr::from_parts(NodeId, Option<RelayUrl>, impl IntoIterator<Item = SocketAddr>)` and public field `NodeAddr.node_id`.
10. `endpoint.connect(NodeAddr, &[u8]).await -> Result<Connection>`.
11. `endpoint.conn_type(NodeId) -> Result<impl Watcher<Value = ConnectionType>>`, `.get() -> Result<ConnectionType, _>`, `iroh::endpoint::ConnectionType::{Direct, Relay, Mixed, None}`.
12. `endpoint.accept().await -> Option<Incoming>`, `Incoming::accept() -> Result<Connecting, _>`, `Connecting: Future<Output = Result<Connection, _>>`.
13. `iroh::endpoint::get_remote_node_id(&Connection) -> Result<NodeId, _>` (in 0.9x this became `conn.remote_node_id()`).
14. quinn 0.11 stream API via `iroh::endpoint::{Connection, SendStream, RecvStream}`: `open_bi`, `accept_bi`, `write_all`, sync `finish() -> Result<(), ClosedStream>`, `read_exact`, `stop(VarInt)`, `reset(VarInt)`, `Connection::close(VarInt, &[u8])`, `VarInt: From<u32>`.
15. `endpoint.close().await` (return value ignored, so `()` or `Result` both compile).
16. With `RelayMode::Disabled`, `connect` to a `NodeAddr` that carries a relay URL still tries that relay (otherwise relayed sends need `--relay-url` on the sender too).
17. `tokio::task::JoinSet::try_join_next` (tokio >= 1.37).
