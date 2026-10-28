# Iroh relay rung

Status: adapter + design note. No iroh runtime is bundled or deployed yet.

## Why

Today the store-and-forward rung is one trust-graph mediator (`RelayServer` /
`RelayChannel`, the "questhub relay"). One operator is a single point of
failure and of metadata concentration. [Iroh](https://www.iroh.computer)
addresses peers by node id (an Ed25519 public key) and uses relay servers only
to carry end-to-end-encrypted QUIC traffic when no direct path exists. Anyone
can run an iroh relay, and a node can name several, so relays become
interchangeable instead of a single trusted host.

## Where it plugs in

The existing seam is `DeliveryChannel` (`packages/transport/src/delivery_channel.ts`).
`IrohRelayChannel` implements it, so nothing above it changes (I5):

```
DidCommTransport  (pack / unpack / dedup / dispatch — unchanged)
        │
   LadderChannel  rungs, in order:  relay │ iroh │ lan_http
        │
 IrohRelayChannel ──► IrohEndpointLike (injected; real iroh binding later)
```

- `LadderRungName` gains `"iroh"` and `LadderBudgets` gains `irohMs`. Order is
  the caller's choice; a deployment may run `iroh` before, after or instead of
  `relay`. A failing or slow iroh rung falls through exactly like any other.
- The channel moves the wire verbatim as UTF-8 bytes and hands inbound bytes
  verbatim to the sink. It never decrypts, verifies or dispatches; replay and
  duplicate suppression stay in `DedupStore` keyed on the signed message id.
- The iroh runtime sits behind `IrohEndpointLike` (`send`, `onReceive`,
  optional `isAvailable` / `close`). This package takes no native dependency,
  and tests run on an in-memory fake.

## Addressing

`resolvePeer(did) → { nodeId, relayUrls? }`. How a DID maps to an iroh address
is deliberately left to the caller. Natural carriers are an extra service entry
in the peer's `did:peer:2` document or the contact card. Relay order sent to
the endpoint is: the peer's own advertised relays first, then the sender's
configured `relayUrls`, de-duplicated. "Interchangeable" means a sender can
reach a peer through any relay in that union.

## Behaviour and limits

| Case | Result |
| --- | --- |
| No iroh address for recipient | `deliver` rejects → ladder moves on |
| Empty wire, or wire > `maxWireBytes` (1 MiB default) | rejects before touching the endpoint |
| Endpoint send fails | error propagates → ladder moves on |
| Inbound bytes not valid UTF-8 | dropped silently, sink not called |
| Duplicate delivery across rungs | absorbed by `DedupStore`, as today |

## Privacy honesty (I7)

This does not add privacy beyond today's relay. An iroh relay operator sees
node ids, connection timing and traffic volume, but not content (iroh
encrypts end to end, and the wire is already DIDComm-encrypted inside that).
Moving from one relay to many spreads that metadata over more operators; it
does not remove it. I3 is untouched: the uniform PASS schedule is above this
layer, so relay choice cannot make a decline distinguishable. v0 remains not
zero-knowledge.

## Not done / open

- A real `IrohEndpointLike` binding (iroh has Rust and FFI bindings; the daemon
  is TypeScript, so this means a sidecar or a node binding). Owner decision.
- Offline store-and-forward: iroh relays forward live traffic, they do not
  queue for an offline peer the way `RelayQueueStore` does. Offline delivery
  still needs the existing mediator rung or an iroh-side inbox. The ladder
  keeps `relay` for that reason.
- Publishing the iroh address in `did:peer:2` / the contact card.
- A relay-operator guide (running `iroh-relay`).
