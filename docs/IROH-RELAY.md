# Iroh relay rung

Status: working. `IrohRelayChannel` drives a real iroh node through the
`trustweb-iroh-sidecar` process (`IrohSidecarEndpoint`, protocol in
[IROH-SIDECAR.md](IROH-SIDECAR.md)), with host-side relay selection and
failover. The binary is not yet built or run in CI (see "Not done / open").
No relay is operated by this project; the operator guide is below.

## Why

Today the store-and-forward rung is one trust-graph mediator (`RelayServer` /
`RelayChannel`, the "questhub relay"). One operator is a single point of
failure and of metadata concentration. [Iroh](https://www.iroh.computer)
addresses peers by node id (an Ed25519 public key) and uses relay servers only
to carry end-to-end-encrypted QUIC traffic when no direct path exists. Anyone
can run an iroh relay, and a node can name several, so relays become
replaceable instead of a single trusted host.

## Where it plugs in

The existing seam is `DeliveryChannel` (`packages/transport/src/delivery_channel.ts`).
`IrohRelayChannel` implements it, so nothing above it changes (I5):

```
DidCommTransport  (pack / unpack / dedup / dispatch — unchanged)
        │
   LadderChannel  rungs, in order:  relay │ iroh │ lan_http     (onRungResult hook)
        │
 IrohRelayChannel  + IrohRelaySelector   (failover, onAudit → local log, I6)
        │
 IrohSidecarEndpoint  implements IrohEndpointLike
        │  JSON lines on stdin/stdout  (docs/IROH-SIDECAR.md)
        ▼
 trustweb-iroh-sidecar  (Rust, separate process: the iroh node + its secret key)
        │  QUIC, direct or via one iroh relay
        ▼
 peer's sidecar
```

- `LadderRungName` has `"iroh"` and `LadderBudgets` has `irohMs`. Order is the
  caller's choice; a deployment may run `iroh` before, after or instead of
  `relay`. A failing or slow iroh rung falls through exactly like any other.
  `onRungResult` reports each rung's outcome to the caller's audit log.
- The channel moves the wire verbatim as UTF-8 bytes and hands inbound bytes
  verbatim to the sink. It never decrypts, verifies or dispatches; replay and
  duplicate suppression stay in `DedupStore` keyed on the signed message id.
- `packages/transport` still takes no native dependency. Binary absent →
  `isAvailable()` false, `send` rejects, the ladder moves on. Unit tests use
  an in-memory fake and a fake sidecar; the integration test spawns two real
  sidecars and skips when no binary is found.

## Addressing

`resolvePeer(did) → { nodeId, relayUrls?, directAddrs? }`. How a DID maps to an
iroh address is still left to the caller (publishing it is open, below).
Natural carriers are an extra service entry in the peer's `did:peer:2`
document or the contact card.

## Relay selection and failover

Per `deliver`:

1. Candidates = the peer's advertised relays, then the sender's configured
   `relayUrls`, de-duplicated, in that order.
2. `IrohRelaySelector.order()` keeps that order but moves relays that are
   cooling down to the back. Cooling-down relays are never dropped, so a fully
   degraded set is still tried.
3. Up to `maxRelayAttempts` attempts, **one relay per attempt**:
   `endpoint.send({ nodeId, relayUrls: [url], directAddrs }, payload)`, raced
   against `attemptMs`. Success → `reportSuccess(url)` (clears its history),
   return. Failure or timeout → `reportFailure(url)`, next candidate.
4. No relays known → exactly one direct-only attempt (`relayUrls: []`).
5. All attempts fail → one aggregated error naming each attempt, so the ladder
   falls through to its next rung.

Every step emits an `onAudit` event (`attempt`, `delivered`, `failed`,
`gave_up`) as human-readable text: recipient DID, relay URL, attempt number,
duration, error. Local log only; never wire bytes, never payload (I6). A
`selector` can be passed in to share relay health across channels.

| Default | Value | Where |
| --- | --- | --- |
| `attemptMs` | 10 s | `IrohRelayChannel` |
| `maxRelayAttempts` | 3 | `IrohRelayChannel` |
| Cooldown after 1st consecutive failure | 60 s | `IrohRelaySelector` (`cooldownMs`) |
| Cooldown growth | doubles per consecutive failure | 60 s, 2 min, 4 min, 8 min, 15 min … |
| Cooldown cap | 15 min | `IrohRelaySelector` (`maxCooldownMs`) |
| Success | forgets the relay's failures | `reportSuccess` |
| Sidecar per-request answer | ≤ 15 s | IROH-SIDECAR.md |

**Why one relay per attempt.** The sidecar could take a list and let iroh try
them internally, but then a failure is one opaque error and the audit log
cannot say which operator was down. One relay per `send` makes every attempt
a separate, logged, timed event on the host side (I6), and keeps the cooldown
state in TypeScript where it is testable without a network.

**What "interchangeable" now means, concretely.** Iroh relays do not forward to
each other: a relay can only hand a payload to a node that is connected to
*that* relay (its home relay). So:

- the peer's advertised relays are tried first because they are where the
  peer can actually be found;
- the sender's own relays help only when the peer happens to use the same
  operator (e.g. a shared community relay), or when hole-punching via
  `directAddrs` succeeds with the relay only assisting;
- a dead relay costs one attempt and then sits in cooldown; the next delivery
  goes to the next candidate first. Any operator can replace any other *if the
  peer also connects there*. That is the honest scope of "interchangeable".

⚠️ Detail to verify: iroh keeps one home relay at a time and moves to another
configured relay when the home relay fails. The sidecar's `ready.relayUrl`
reports the current one. Verify against the iroh docs (github.com/n0-computer/iroh)
before relying on fast home-relay switching.

**Ladder budget.** `LadderChannel` races the whole rung against `irohMs`. Set
`irohMs ≥ attemptMs × maxRelayAttempts` (30 s with the defaults), or the
ladder cuts the failover short and the later candidates are never tried.
Unset `irohMs` = no ladder-level cap; the channel's own 3 × 10 s bound applies.
An attempt abandoned at `attemptMs` can still complete inside the sidecar
(it answers within 15 s); the resulting duplicate is absorbed by `DedupStore`.

## Behaviour and limits

| Case | Result |
| --- | --- |
| No iroh address for recipient | `deliver` rejects → ladder moves on |
| Empty wire, or wire > `maxWireBytes` (1 MiB default) | rejects before touching the endpoint |
| Sidecar binary absent / not `ready` | `send` rejects → ladder moves on |
| One relay fails or times out | cooldown, next candidate (≤ 3 attempts) |
| All attempts fail | one aggregated error → ladder moves on |
| Inbound bytes not valid UTF-8 | dropped silently, sink not called |
| Duplicate delivery across rungs or attempts | absorbed by `DedupStore`, as today |

## Running your own relay

An iroh relay (`iroh-relay`, from n0-computer's iroh repository) is a small
server anyone can run. TrustWeb does not need one to work (direct connections
and the mediator rung remain), but a node behind NAT is only reachable via
iroh through a relay it connects to.

> ⚠️ This container has no web access. Every config key, port, flag, path and
> image name in this section is written from memory and is **unverified**.
> Verify against the iroh-relay README (github.com/n0-computer/iroh, crate
> `iroh-relay`) before first deploy, and pin the relay to the iroh version the
> sidecar is built with: relay and client protocol versions must match.

### What a relay sees and does not see (I7)

| Sees | Does not see |
| --- | --- |
| Node ids (Ed25519 public keys) of connected clients and of who sends to whom | Payload content (iroh QUIC/TLS end to end between node keys; DIDComm encryption inside that) |
| Client IP addresses and ports | The DIDs behind a node id, unless correlated elsewhere |
| Connection times, durations, packet timing | Whether a message is a REQUEST, PASS, CONSENT … (I3 schedule is above this layer) |
| Traffic volume and message sizes | |

A relay operator learns a contact graph of node ids with timing. We do not
claim that a relay is blind to metadata; we claim only that it cannot read
content.

### Hardware

A tiny VM is enough: 1 vCPU, 1 GB RAM, a few GB disk, a public IPv4 (IPv6 if
available). Load is bandwidth, not CPU. Prefer an EU provider and region;
examples: a Vienna-located VPS from an Austrian or German provider (⚠️ e.g.
netcup's Vienna location), or Hetzner (Nuremberg / Falkenstein, DE). These are
examples, not endorsements or checked offers.

### Install

⚠️ Either:

```
cargo install iroh-relay --version <same as sidecar's iroh>   # binary in ~/.cargo/bin
podman run ... docker.io/n0computer/iroh-relay:<version>       # image name unverified
```

`iroh-relay --dev` ⚠️ runs a plain-HTTP relay on localhost for testing only.

### Config (`/etc/iroh-relay/config.toml`)

⚠️ Key names from memory; check every one.

```toml
# relay.example.at — TrustWeb community relay
enable_relay = true
http_bind_addr = "[::]:80"          # ACME HTTP-01 challenge (+ plain HTTP)

# STUN: older iroh versions; newer ones replaced it by QUIC address discovery.
enable_stun = true
stun_bind_addr = "[::]:3478"

enable_quic_addr_discovery = true   # QAD on [tls].quic_bind_addr

enable_metrics = true
metrics_bind_addr = "127.0.0.1:9090"  # never expose publicly

[tls]
hostname = "relay.example.at"
https_bind_addr = "[::]:443"
quic_bind_addr = "[::]:7842"
# Option A: Let's Encrypt (needs 80/tcp reachable)
cert_mode = "LetsEncrypt"
contact = "ops@example.at"          # ACME account contact
prod_tls = true                     # false = LE staging while testing
cert_dir = "/var/lib/iroh-relay/certs"
# Option B: certificates you manage (certbot, Caddy, internal CA)
# cert_mode = "Manual"
# manual_cert_path = "/etc/iroh-relay/tls/relay.example.at.crt"
# manual_key_path  = "/etc/iroh-relay/tls/relay.example.at.key"

[limits]
accept_conn_limit = 100             # new connections / s
accept_conn_burst = 200
[limits.client.rx]
bytes_per_second = 262144           # per client
max_burst_bytes = 1048576
```

### Ports and firewall

| Port | Purpose |
| --- | --- |
| 443/tcp | relay over HTTPS/WebSocket (TLS) |
| 80/tcp | ACME HTTP-01 (only with Let's Encrypt mode) |
| 3478/udp | STUN ⚠️ (only if the version still has it) |
| 7842/udp | QUIC address discovery ⚠️ |
| 9090/tcp | metrics, **localhost only**, not opened |

Everything else closed. ⚠️ All port numbers unverified defaults.

### systemd unit sketch (`/etc/systemd/system/iroh-relay.service`)

```ini
[Unit]
Description=iroh relay (TrustWeb community relay)
After=network-online.target
Wants=network-online.target

[Service]
User=iroh-relay
Group=iroh-relay
ExecStart=/usr/local/bin/iroh-relay --config-path /etc/iroh-relay/config.toml
Environment=RUST_LOG=warn
StateDirectory=iroh-relay              # /var/lib/iroh-relay (LE certs)
ConfigurationDirectory=iroh-relay      # /etc/iroh-relay (root-owned, 0644 config, 0600 key)
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```
useradd --system --home /var/lib/iroh-relay --shell /usr/sbin/nologin iroh-relay
systemctl daemon-reload && systemctl enable --now iroh-relay
```

⚠️ `--config-path` flag name unverified. `RUST_LOG=warn` keeps per-connection
info lines (which may carry IPs and node ids) out of the journal; check what
the version logs at each level.

### Health check

```
curl -fsS https://relay.example.at/ping            # ⚠️ path unverified
curl -fsS http://127.0.0.1:9090/metrics | head      # on the host
systemctl status iroh-relay; journalctl -u iroh-relay --since -1h
```

End to end: two sidecars, both `--relay-url https://relay.example.at`, no
`directAddrs`, run the integration test with
`TRUSTWEB_IROH_TEST_RELAY_URL=https://relay.example.at`. A `sent` with
`"via":"relay"` proves the relay path.

### Pointing a TrustWeb node at it

| Where | How |
| --- | --- |
| Sidecar (home relay) | `trustweb-iroh-sidecar --relay-url https://relay.example.at [--relay-url https://relay2.example.de]` |
| Sender-side candidates | `new IrohRelayChannel({ ..., relayUrls: ["https://relay.example.at", ...] })` |
| Peer's advertisement | `resolvePeer(did)` returns the peer's `relayUrls`; publishing them in `did:peer:2` / contact card is open |

Without `--relay-url` the sidecar uses **no relay** (direct only). `--n0-relays`
opts in to n0's public relays (outside the EU); it is never implied (I9).

### Two relays for redundancy

Run two relays with different operators or at least different providers and
regions (e.g. `relay.example.at` in Vienna, `relay2.example.de` in Germany).
Give both to every sidecar (`--relay-url` twice) and advertise both. A node
uses one as home at a time ⚠️; when it fails, the node moves to the other and
senders fail over after one 10 s attempt plus cooldown. Two operators also
split, but do not remove, the metadata each one sees.

### Logs, retention, GDPR

IP addresses are personal data where the operator can link them to a person
(CJEU, Breyer C-582/14, 2016-10-19, tier A). A relay's connection logs and
metrics therefore fall under the GDPR: storage limitation (Art. 5(1)(e)) and
security of processing (Art. 32: confidentiality of these logs, access
control, regular review) (Regulation (EU) 2016/679, Official Journal of the
EU, 2016-05-04, tier A). Practical minimum:

- log at `warn`; no access logs at a reverse proxy in front, if any;
- journald retention short (e.g. `MaxRetentionSec=7day` for the unit's
  namespace or system-wide) and documented;
- metrics bound to localhost, aggregate counters only;
- name the operator, contact and retention period on a page next to the relay.

This is an operator note, not legal advice.

Sources: n0-computer, iroh repository and `iroh-relay` crate docs, not checked
from this container (no web access), tier B. CJEU, Judgment C-582/14
(Breyer), 2016-10-19, tier A. Official Journal of the EU, Regulation (EU)
2016/679 Art. 5, 32, 2016-05-04, tier A.

## Privacy honesty (I7)

This does not add privacy beyond today's relay. An iroh relay operator sees
node ids, IP addresses, connection timing and traffic volume, but not content
(iroh encrypts end to end between node keys, and the wire is already
DIDComm-encrypted inside that). Failover across several relays spreads that
metadata over more operators; it does not remove it, and a failed-then-retried
delivery may show the same send to two operators. The sidecar holds the node's
secret key in one small process and never logs payloads or keys. Its default
is no relay at all; n0's public relays are opt-in (`--n0-relays`) because they
are a third party outside the EU that TrustWeb users did not choose (I9). I3
is untouched: the uniform PASS schedule is above this layer, so relay choice
or failover cannot make a decline distinguishable. v0 remains not
zero-knowledge.

## Not done / open

- Real sidecar binary compiled and run end to end in CI; today the integration
  test skips when no binary is present.
- Publishing the iroh node id and relay URLs in the `did:peer:2` service entry
  or the contact card.
- Offline store-and-forward: iroh relays forward live traffic, they do not
  queue for an offline peer the way `RelayQueueStore` does. Offline delivery
  still goes through the mediator rung; the ladder keeps `relay` for that.
- Relay-side authentication / allowlists (who may use a community relay);
  today a relay we point at serves whoever it lets in.
- All ⚠️ items in "Running your own relay" verified against the iroh-relay
  README, and a relay actually deployed.
