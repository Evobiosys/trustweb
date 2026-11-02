# @resource-web/device-sync

End-to-end-encrypted sync of the owner's record between the owner's own devices (phone + laptop), through the existing
store-and-forward relay, which carries only ciphertext. Prototype behind the design in
[`docs/design/device-sync-e2ee.md`](../../docs/design/device-sync-e2ee.md); decision `D-device-sync-e2ee` in `DECISIONS.md`.

What it is:

- an append-only record log (`log.ts`): per-device sequence, hash chain, vector clock, verified merge, deterministic materialisation
  with conflicts listed instead of lost;
- replay-protected seals (`seal.ts`, `replay.ts`): AES-GCM with the outer from/to bound as AAD, a per-direction counter and a 1024-wide
  anti-replay window persisted before a wire is acknowledged;
- pairing of own devices by QR or link (`keys.ts`, `sync.ts`): a one-time secret that never crosses the relay, X25519 ECDH, HKDF into
  two directional keys, a 6-digit short authentication string both people compare;
- a sync module (`sync.ts`) behind the relay's raw path (`RelayLike` = `sendRaw` / `onRawWire` of `apps/demo/src/relay.ts`).

What it is not (honest labeling, I7): no forward secrecy, no post-quantum, no metadata protection; the relay sees addresses, sizes and
timing. Not yet wired into `apps/trustweb` (sync v3 in `sync_link.ts` stays in force).

Zero runtime dependencies: WebCrypto only. Tests run on Node's own runner:

```sh
pnpm --filter @resource-web/device-sync typecheck
pnpm --filter @resource-web/device-sync test     # node --test, Node >= 22.18
```
