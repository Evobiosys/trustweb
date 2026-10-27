# IROH-RELAY.md — an Iroh rung beside the questhub relay

Status: design note + minimal adapter (`packages/transport/src/iroh_relay_channel.ts`).
No iroh dependency is added yet; the binding plugs in behind `IrohClient`.

## 1. Problem

Today the only relay is the questhub mediator (`RelayServer` / `RelayChannel`):
one operator, store-and-forward, trust-graph addressed by DID. That is a single
point of availability and of metadata. We want relays that are **interchangeable
and runnable by anyone**, without changing envelopes, crypto or dispatch.

## 2. Why Iroh

[Iroh](https://www.iroh.computer) dials by public key (NodeId), uses QUIC, tries
hole-punching first, and falls back to an **iroh relay server** that anyone can
run. Relay URLs are hints, not identity, so swapping a relay never changes who a
peer is.

## 3. Where it plugs in (I5)

The existing seam is `DeliveryChannel` (`delivery_channel.ts`):
`deliver(did, wire)` / `onInbound(cb)` / `isAvailable?` / `close?`. A channel
moves an already-packed, sealed DIDComm wire; `DidCommTransport` keeps the one
decrypt/verify/dedup/dispatch path. `IrohRelayChannel` implements exactly that
and nothing more:

```
DidCommTransport ── LadderChannel ── rung "relay"    : IrohRelayChannel  (live, any iroh relay)
                                  ── rung "relay"    : RelayChannel      (questhub, queued)
                                  ── rung "lan_http" : HttpPostChannel   (floor)
```

`LadderChannel` rung names are labels; two rungs may both be `"relay"`, so **no
ladder change is needed**. Order is chosen by the caller. `RelayChannel` stays
untouched.

Seam inside the adapter: `IrohClient { send(peer, bytes); onMessage(cb); isAvailable?; close? }`
plus `resolvePeer(did) → { nodeId, relayUrls } | undefined`. Tests use an
in-memory fake; production supplies an iroh binding (N-API or WASM).

## 4. Behaviour

| Case | Result |
|---|---|
| Peer has no iroh address | `deliver` rejects → ladder advances |
| Dial fails / exceeds `sendTimeoutMs` (5 s) | rejects → ladder advances |
| Wire > `maxWireBytes` (256 KiB), either direction | outbound rejects, inbound dropped |
| Inbound sink throws | swallowed; endpoint keeps running |
| Inbound wire | passed verbatim as a string; never decrypted here |

**Not store-and-forward.** An iroh relay only forwards to connected peers. An
offline recipient fails fast and the ladder falls to the queueing questhub
relay. Iroh is the live path; questhub remains the mailbox. Do not describe
the Iroh rung as offline-capable.

## 5. Privacy (I1, I3, I7)

- Payload stays sealed by DIDComm (sign-then-encrypt) before it reaches iroh;
  QUIC/TLS adds a second layer. A relay operator sees NodeIds, sizes, timing.
- I3 holds: `PASS` wires are byte-identical and scheduled by the daemon; the
  channel does not alter size or timing. Message-size padding is not added here.
- Adds a **new identifier** (NodeId) to the card. It must be derived separately
  from the DID signing key or be a dedicated key, so one compromise does not
  link both. Open question O1.
- Not zero-knowledge (I7); this rung changes who can observe metadata, not
  whether metadata exists.

## 6. Open questions

- **O1** NodeId: dedicated key vs derived from DID key; rotation story.
- **O2** Card shape: extend `CardPayload` with `iroh: { nodeId, relayUrls }`
  (additive, omitted when absent, like `relays`), or resolve via the DID service block.
- **O3** Default relay set and trust: public n0 relays vs community-run; per-tenant allowlist.
- **O4** Binding choice (native vs WASM for the browser agent) and its licence fit with AGPL.
- **O5** Whether a failed live send should also enqueue on questhub inside
  the ladder (today: yes, because the next rung is tried).

## 7. Next steps

1. Pick the binding (O4), implement `IrohClient`, add an integration test with two local endpoints and a local iroh relay.
2. Add the card field (O2) and wire `resolvePeer` in the daemon config.
3. Record the decision in DECISIONS.md once O1–O3 are settled.
