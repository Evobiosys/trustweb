# @resource-web/device-sync

End-to-end-encrypted sync of the owner's record between the owner's own devices (phone + laptop), through the existing
store-and-forward relay, which carries only ciphertext. Prototype behind the design in
[`docs/design/device-sync-e2ee.md`](../../docs/design/device-sync-e2ee.md); decisions `D-device-sync-e2ee` and
`D-device-sync-e2ee-2` in `DECISIONS.md`.

What it is:

- an append-only record log (`log.ts`): per-device sequence, hash chain, vector clock, verified merge, deterministic materialisation
  with conflicts listed instead of lost;
- forward-secret, replay-proof seals (`ratchet.ts`, `seal.ts`): a symmetric ratchet per pairing and direction gives every message its
  own AES-GCM key and deletes it after use; the outer from/to and the counter are bound as AAD; plaintexts are padded to 1/4/16/64 KiB;
- pairing of own devices by QR code only (`keys.ts`, `sync.ts`): a one-time secret that never crosses the relay, X25519 ECDH, HKDF into
  two directional ratchet roots, a 6-digit short authentication string both people compare, one Confirm per request;
- the device's private key in a key store (`keystore.ts`): IndexedDB, a non-extractable CryptoKey, migrated out of a v1 record blob;
- a sync module (`sync.ts`) behind the relay's raw path (`RelayLike` = `sendRaw` / `onRawWire` of `apps/demo/src/relay.ts`) that asks
  the person "Receive from <device>?" before anything is merged.

What it is not (honest labeling, I7): no post-compromise security (no DH ratchet step yet: a stolen current chain key opens what
follows until the devices pair again), no post-quantum, no metadata protection beyond size buckets (the relay sees addresses, timing,
piece counts, size buckets and per-direction counters); IndexedDB is per origin and not encrypted at rest by the browser. A restore from
an older backup needs pairing again (the price of forward secrecy; nothing is lost). Not yet wired into `apps/trustweb` (sync v3 in
`sync_link.ts` stays in force). `archive/` holds the retired replay window of round 1.

Zero runtime dependencies: WebCrypto only. Tests run on Node's own runner:

```sh
pnpm --filter @resource-web/device-sync typecheck
pnpm --filter @resource-web/device-sync test     # node --test, Node >= 22.18
```
