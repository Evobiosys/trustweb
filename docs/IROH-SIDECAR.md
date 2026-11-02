# Iroh sidecar protocol (v1)

Status: contract for `services/iroh-sidecar` (Rust, the real iroh node) and
`IrohSidecarEndpoint` (`packages/transport/src/iroh_sidecar_endpoint.ts`, the
TypeScript side of `IrohEndpointLike`). Both implement exactly this; nothing
else crosses the process boundary. See `docs/IROH-RELAY.md` for why a sidecar.

## Why a separate process

The daemon is TypeScript; iroh is Rust. A sidecar keeps `packages/transport`
free of native modules (I5: the runtime stays injected behind
`IrohEndpointLike`), keeps the node's secret key in one small process, and lets
the integration test spawn a real node and skip cleanly when the binary is
absent.

## Finding the binary

1. `TRUSTWEB_IROH_SIDECAR` (absolute path), if set. A set-but-missing path is
   "not found"; it never falls back to `PATH`, so a bad override cannot quietly
   run a different binary.
2. Otherwise `trustweb-iroh-sidecar` on `PATH` (`.exe` too on Windows).

Neither found: `IrohSidecarEndpoint.isAvailable()` is `false`, `send` rejects
with `unavailable: …` (a host-side code, not one of the sidecar's), and the
ladder falls through to its next rung. Nothing is downloaded. A sidecar that
exits, never reports `ready`, or was closed is not restarted by the endpoint;
the ladder falls through until the daemon creates a new endpoint.

## Command line

```
trustweb-iroh-sidecar [--relay-url <url>]... [--alpn <string>] [--secret-key-file <path>] [--n0-relays]
```

| Flag | Meaning | Default |
| --- | --- | --- |
| `--relay-url <url>` | A relay this node may use as its home relay; repeatable, order = preference. | none: **no relay**, direct connections only (I9) |
| `--n0-relays` | Opt in to iroh's public default relays (run by n0, outside the EU). Never implied. | off |
| `--alpn <string>` | ALPN for TrustWeb connections. | `trustweb/didcomm/0.1` |
| `--secret-key-file <path>` | Persist the node's Ed25519 secret key here (0600, created if absent) so the node id survives restarts. | ephemeral key, new node id per start |

The sidecar never logs payload bytes, never prints its secret key, and binds
QUIC to an OS-chosen UDP port (IPv4 and IPv6 when available).

## Wire: JSON lines on stdin/stdout

UTF-8, one JSON object per line, `\n` terminated. Unknown fields are ignored;
unknown `type` values are answered with an `error` (`code: "bad_request"`).
stderr is free-form diagnostics for humans only.

### Sidecar → host

| Line | When |
| --- | --- |
| `{"type":"ready","v":1,"nodeId":"<id>","directAddrs":["<ip:port>",...],"relayUrl":"<url>"\|null}` | First line, once the endpoint is bound (host waits ≤ 10 s). `nodeId` is the iroh node id in iroh's canonical string form. `relayUrl` is the chosen home relay or `null`. |
| `{"type":"recv","from":"<nodeId>","payload":"<base64>"}` | One inbound payload, after the sidecar has acknowledged it to the sender. `from` is the authenticated remote node id. |
| `{"type":"sent","id":"<id>","via":"relay"\|"direct"\|"unknown"}` | The peer acknowledged the payload for request `id`. |
| `{"type":"pong","id":"<id>"}` | Answer to `ping`. |
| `{"type":"error","id":"<id>"\|null,"code":"<code>","message":"<text>"}` | Request `id` failed (`id` null for a line that could not be parsed). |
| `{"type":"log","level":"info"\|"warn","message":"<text>"}` | Optional diagnostics. Never contains payload bytes or keys. |

Error codes: `bad_request` (malformed line or field), `too_large` (payload >
1 MiB), `unreachable` (no connection within the attempt timeout, including
"relay refused"), `timeout` (connected, but no ack within the attempt timeout),
`closed` (endpoint shutting down), `internal`.

### Host → sidecar

| Line | Meaning |
| --- | --- |
| `{"type":"send","id":"<id>","nodeId":"<id>","relayUrl":"<url>"\|null,"directAddrs":["<ip:port>",...],"payload":"<base64>"}` | Deliver one payload to the peer. **At most one relay per request**: relay choice and failover live on the host side (`IrohRelayChannel` + `IrohRelaySelector`), so every attempt is observable and auditable there. `directAddrs` optional. Answered by exactly one `sent` or `error` with the same `id` within 15 s. |
| `{"type":"ping","id":"<id>"}` | Liveness; answered by `pong`. |
| `{"type":"close"}` | Close the endpoint and exit 0. Closing stdin has the same effect. |

Request ids are opaque strings chosen by the host, unique per process lifetime.

## Over the wire between two sidecars

One bidirectional QUIC stream per payload, on the configured ALPN:

```
sender → receiver:  u32 big-endian length, then that many payload bytes, then FIN
receiver → sender:  one byte 0x01 after the payload was handed to its host (printed as `recv`), then FIN
```

A length above 1 MiB closes the stream without an ack. The payload is the
DIDComm wire verbatim (already encrypted and signed above this layer); the
sidecar never inspects it. iroh adds its own end-to-end QUIC/TLS between the two
node keys, so a relay operator sees node ids, addresses, timing and sizes, not
content (I7: this is still not zero-knowledge; metadata stays visible).

## Mapping to `IrohEndpointLike`

| `IrohEndpointLike` | Sidecar line |
| --- | --- |
| `send(addr, payload)` | `send` with `relayUrl = addr.relayUrls?.[0] ?? null` and `directAddrs = addr.directAddrs` → resolves on `sent`, rejects on `error` (message carries the code) |
| `onReceive(cb)` | every `recv` line → `cb(bytes)` |
| `isAvailable()` | binary found, process alive and `ready` seen (a `ping` is used when the process has been idle) |
| `close()` | `close` line, then wait for exit (SIGTERM after 2 s, SIGKILL after 5 s) |

## Test strategy

- `iroh_sidecar_endpoint.test.ts`: the TypeScript side against a **fake sidecar**
  (`test_support/fake_iroh_sidecar.mjs`, Node, UDP on loopback) that speaks this
  protocol byte for byte. Runs everywhere, no network beyond loopback.
- `iroh_sidecar.integration.test.ts`: two **real** sidecars spawned in the test,
  direct addresses only (no relay needed), one wire each way through
  `IrohRelayChannel`; `describe.skipIf` when no binary is found. With
  `TRUSTWEB_IROH_TEST_RELAY_URL` set, a second case routes through that relay.
- No personal data anywhere: synthetic DIDs (`did:peer:test-…`), random payloads.
