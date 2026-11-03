# Device sync v2: end-to-end-encrypted log sync between the owner's own devices

Design document for `packages/device-sync` (`@resource-web/device-sync`).
Audience: the engineer who wires it into `apps/trustweb`.
Written 2026-11-02. Revised 2026-11-03 (round 2: the owner's four decisions, implemented).

## 📦 Status

> **Prototype.** Branch `cloud/device-sync-e2ee-f`. 140 tests green (`node --test`).
>
> **Owner decisions (PR #71 / PR #68 §10), all decided and implemented in `packages/device-sync`:**
>
> | # | Decision | Where in code |
> |---|---|---|
> | 1 | KEEP the per-sync "Receive from <device>?" prompt: nothing merges before the person accepts | `sync.ts` `onIncoming`, `Incoming` |
> | 2 | Pairing by QR only. No link form exists | `sync.ts` (the link helpers are removed) |
> | 3 | Keys move from localStorage to IndexedDB now, with migration | `keystore.ts`, `SyncData` v2 |
> | 4 | A ratchet for forward secrecy before rollout | `ratchet.ts`, `seal.ts` counter prefix |
>
> **Implemented:** `bytes.ts` (base64url, canonical JSON, SHA-256), `keys.ts` (X25519 device keys as `CryptoKey`, pair roots, 6-digit SAS,
> did:peer:2 `E` key reader), `keystore.ts` (IndexedDB key store, migration), `ratchet.ts` (symmetric KDF chain per direction),
> `seal.ts` (AES-GCM, counter prefix, from/to/ctr in the AAD, padding buckets), `log.ts` (append-only record log, verified merge,
> deterministic materialize), `sync.ts` (QR pairing code, `have` / `entries` over the relay's raw path, the Receive prompt).
> The round-1 anti-replay window (`replay.ts`) is retired to `archive/` (kept, not exported, not run). Zero runtime dependencies.
>
> **Not wired yet:** `apps/trustweb` still runs the v3 sync (`sync_core.ts`, `sync_link.ts`, `sync_view.ts`). Section "Migration path" is a plan.
>
> **Honest label (I7):**
>
> | Property | v2 round 2 | Detail |
> |---|---|---|
> | Forward secrecy | **Yes**, against a later capture of the whole device state (record blob and key store) | Symmetric ratchet: one key per message, deleted after use. The pairing epoch is not stored and the roots are zeroed once the chains are seeded |
> | Post-compromise security | **No** | No DH ratchet step: a stolen current chain key opens everything that follows on that chain until the devices pair again |
> | Post-quantum | **No** | X25519 |
> | Metadata | **Not hidden** | The relay sees addresses, timing, the size BUCKET (1 / 4 / 16 / 64 KiB padding), the piece count and the per-direction counter |
> | Keys at rest | IndexedDB, non-extractable `CryptoKey` | Per origin; not encrypted at rest by the browser; usable (not exportable) by code on the unlocked device |
> | Restore from an older backup | Catches up by itself, no re-pairing | Its first sync is dropped on the peer (used counters) and reports `offline`; the sending chain then jumps 32 steps ahead per unanswered `have` until it passes the peer. Nothing is lost. The backup's own old keys can open the wires of its time |
>
> Why the epoch is not stored: with the epoch in the blob, the key in the key store and the peer's public key, every past chain
> could be re-derived. Forward secrecy would then have held against the relay only. Now a `Pairing` keeps a `pairId` (a hash of the
> epoch, for the unlink guard) and the two chains. A captured device state opens only the skipped keys it holds (at most 1024 per
> direction) and everything that follows under the current chains until the devices pair again.
> Entries are hash-chained but not signed per device, so a compromised paired device can write in another device's name.

## 🧭 Context

### How the record syncs today (v3)

Naming: PR #68 calls today's app sync "v1". This document calls it v3, after `SYNC_VERSION = 3` in `sync_core.ts`. Same code.
"Round 1" and "round 2" are the two versions of this package; `SyncData` v1 is the round-1 storage blob.

- Pairing: device A shows `TWD1~<sync did:peer:2>~<secret>` as a QR or text.
- Device B sends its own DID sealed under a key derived from the secret.
- Both derive one ECDH pair key (HKDF info `trustweb-device-sync/v1`) and show a 4-hex fingerprint (16 bits).
- Each side taps Confirm.
- A sync sends the whole record as one `SyncBundle` (v3), cut into pieces of at most 45 000 bytes, at most 200 pieces.
- Merge is per entity by id: the newer **stamp** wins.
- A stamp is set at sync time: an entity whose content hash changed since the last look gets `now` and this device's name.
- When both sides changed an entity since the last sync, the loser is kept in "Review merge" (at most 50).
- Replay defence is `exp` only: a message older than 10 minutes is ignored, measured on the receiver's clock.
- `sync_core.ts` says it plainly: "newer" is a wall-clock comparison between two devices, and a device with a wrong clock can win edits it should lose.

### Why replace it

| Gap in v3 | PR #68 | Effect | v2 answer |
|---|---|---|---|
| Whole record per sync | 6, 4 | Cost grows with the record; the exact record size leaks per sync | Only the entries the other side lacks travel; every message is padded to a bucket |
| Entity-level last-writer-wins | | Two edits to different fields of one person still conflict | Field-level ops |
| Wall-clock "newer" | 5 | A fast clock wins even over an edit that saw its value | Causal order first (vector clocks), clock only to break true ties |
| `exp` is the only replay defence | 2 | A captured wire replays for 10 minutes; a relay can hold and re-deliver | One-time message keys from a ratchet: a replay finds no key; merge is idempotent |
| One symmetric key for both directions | 1 | A wire can be reflected back to its sender | Two directional ratchet chains |
| AAD absent | 1 | The relay could re-address a wire to another pairing that shares a key | `from`, `to` and the counter bound in the AAD |
| 4-hex fingerprint | 3 | 16 bits, compared by humans | 6-digit SAS, about 20 bits, secret to an attacker |
| Same pair key for ever per pair of identities | | Unlink and pair again gives the old key back | Per-pairing epoch in the HKDF salt: every pairing gets new roots and a new SAS |
| Static key, no forward secrecy | | A key captured later opens every kept wire | Symmetric ratchet; used keys are deleted |
| Raw secret in the localStorage blob | | Anything that reads localStorage can copy the device key | Non-extractable `CryptoKey` in IndexedDB |

### Relation to the invariants

- **I1 Local sovereignty:** the log lives on the owner's devices only. It travels only between devices the owner paired, sealed. The relay carries ciphertext.
- **I6 Auditability:** merge reports every rejected entry with id and reason. Every drop, decline and migration step is an `onLog` line. The log itself is the audit trail: every change names its device, sequence and time.
- **I7 Honest labeling:** the status box above and the threat model below state what is not protected.
- **I9 Conservative defaults:** pairing codes expire after 10 minutes and are one-use. Nothing syncs before both humans Confirm. Nothing merges before the person taps Receive. A conflict is never resolved silently: the loser is listed.

## 🔎 Findings in v1 (PR #68) and how v2 answers them

PR #68 (the twin prototype in `apps/trustweb/src/sync_e2ee*.ts`) listed six findings in today's sync. Each is answered here, with the test that proves it.
Test names are exact; files are in `packages/device-sync/src/`.

| # | Finding | What v2 does | Proven by |
|---|---|---|---|
| 1 | One key for both directions: the relay can bounce a wire back to its sender (reflection) | Two ratchet chains per pairing, one per direction, from two roots (`root/lo>hi`, `root/hi>lo`). The AAD binds `from`, `to` and the counter, so a reflected wire fails twice: wrong key and wrong AAD | `keys.test.ts` "derivePairRoots: both sides agree crosswise, send != recv, 32 bytes, sas equals derivePairKeys' sas"; `seal.test.ts` "wrong key → null (other direction, other pair)", "re-addressed or re-attributed wire → null"; `sync.test.ts` "a wire re-attributed to another linked address, or to an unlinked one, is ignored" |
| 2 | Replay within the 10-minute `exp` | One-time message keys from the ratchet. A used key is deleted, so a replayed wire finds no key; it is consumed (acked) and not processed | `ratchet.test.ts` "second use of a skipped key → null"; `sync.test.ts` "replay: re-delivering a captured entries wire changes nothing; it is consumed (acked) so the relay stops redelivering" |
| 3 | The pairing check has only 16 bits | 6-digit SAS from 32 HKDF bits over the ECDH secret, salted with both public keys and the pairing epoch; `mod 1 000 000`, about 20 bits to compare | `keys.test.ts` "derivePairKeys: same SAS on both sides; A.send opens with B.recv and NOT with B.send", "derivePairKeys: a context (pairing epoch) changes the keys and the SAS; both sides with the same context agree"; `sync.test.ts` "pair via code: same 6-digit SAS on both sides, confirm stores the pairing on both" |
| 4 | The relay learns the exact record size | Every plaintext is padded to the smallest of four buckets (1 / 4 / 16 / 64 KiB). **Still visible:** the bucket and the piece count | `seal.test.ts` "PAD_BUCKETS", "a 10-byte and a 900-byte message produce the same wire length (bucket 1024 + 12 IV + 16 tag, + 8 counter)", "bucket edges: 4 + JSON = 1024 stays in 1024, one byte more goes to 4096; 1 200 bytes → 4096; 20 000 → 65536", "too large: JSON longer than 65 536 - 4 → throws; exactly 65 532 seals", "padding bytes altered (under a valid AEAD) → null; bad length prefix → null; off-bucket size → null" |
| 5 | Merges go by wall clock | Causal merge: vector clocks decide; the clock only breaks a true tie, and the loser is listed | `log.test.ts` "a causally later put wins without a conflict, even with an EARLIER wall clock", "a winner is never an entry that something else causally replaced (clock skew)" |
| 6 | Every sync sends the whole record | Only the entries since the other side's heads travel | `log.test.ts` "since(heads) returns exactly the missing entries, by device then seq"; `sync.test.ts` "syncNow converges both logs and the materialized state; the relay sees no plaintext and no entity id", "a round larger than the budget is sent in parts; the next round continues where it stopped" |

What the findings did not cover and v2 adds: forward secrecy (decision 4), keys at rest (decision 3), the kept Receive prompt (decision 1), QR-only pairing (decision 2).

## 🎯 Scope

### Goals

- Content confidentiality and integrity against the relay and the network.
- Replay, reflection and re-addressing of wires have no effect.
- Forward secrecy against a later capture of the stored device state.
- Pairing that a relay cannot man-in-the-middle, with a human check (SAS) against a leaked QR.
- The person decides on every incoming record ("Receive from <device>?").
- Convergence: two devices with the same entry set show the same record, byte for byte.
- No edit is lost silently. Every overwritten concurrent value stays readable.
- Incremental sync: after the first round only new entries travel.
- Fits the existing relay without a server change (`sendRaw` / `onRawWire`).
- Zero runtime dependencies.

### Non-goals (this version)

- Post-compromise security (break-in recovery: healing after a key theft without pairing again).
- Post-quantum key exchange.
- Hiding metadata (who syncs with whom, when, the size bucket, the counter).
- Defending against a compromised paired device.
- Log compaction or snapshots.
- Rich text merge (character-level CRDT). A field is one value.
- Key backup or recovery. A lost key means pairing again.

## 🛡️ Threat model

### Assets

- The record content (people, notes, resources, settings) in the log.
- The device private key (X25519): a non-extractable `CryptoKey` in IndexedDB.
- The ratchet state per pairing and direction: chain key, next counter, skipped message keys. It lives in the record blob.
- The pairing epoch, during pairing only. With the device key and the peer's public key it would re-derive the chain roots, so it is never stored: the `Pairing` keeps `pairId` = base64url(SHA-256(`trustweb-device-sync/v2/pair-id` || epoch)), from which the epoch cannot be recovered.
- The integrity of the log: which device wrote what, in which order.
- The pairing secret, during the 10 minutes it is valid.

### Adversaries

Test file names are relative to `packages/device-sync/src/`. Quoted cases are exact test names.

| Adversary | What the design stops | What it does not stop | Proven by |
|---|---|---|---|
| **Honest-but-curious relay** | Reading content: every payload is AES-GCM ciphertext, padded to a bucket | Seeing `from` / `to`, timing, the size bucket, piece counts and the per-direction counter; learning that two addresses belong to one owner; under D-relay-send-auth also an authenticated sender DID | `sync.test.ts` "syncNow converges both logs and the materialized state; the relay sees no plaintext and no entity id"; `seal.test.ts` "wire layout: ctr (8 bytes BE, visible) \|\| iv \|\| ct; the plaintext is padded canonical JSON of {kind, body}" |
| **Malicious relay: replay** | No key is left for a used counter: the wire is acked and not processed; a replayed `have` gets no answer, a replayed `entries` changes nothing; a wire from an earlier pairing does not open | Nothing further | `ratchet.test.ts` "second use of a skipped key → null"; `sync.test.ts` "replay: re-delivering a captured entries wire changes nothing; it is consumed (acked) so the relay stops redelivering", "re-pairing the same two devices derives new keys: a wire captured under the earlier pairing does not open" |
| **Malicious relay: reorder** | Up to 1024 counters ahead, the gap keys are kept as skipped keys, so a round in any order completes (a round is at most 201 wires) | A wire more than 1024 ahead, or whose skipped key was evicted, is not processed (liveness loss, not safety loss) | `ratchet.test.ts` "out of order within MAX_SKIP: receive 5 first, then 1..4, each exactly once", "a ctr more than MAX_SKIP ahead → null, state unchanged; exactly MAX_SKIP ahead is accepted", "skipped keys are bounded by MAX_SKIP: the smallest ctrs are evicted" |
| **Malicious relay: drop** | Detection only: `syncNow` rejects with `offline`, an incomplete piece set merges nothing | Availability; the relay can stop all sync | `sync.test.ts` "syncNow rejects offline when the peer never answers" |
| **Malicious relay: re-address / re-attribute / re-number** | AAD binds `from`, `to` and the counter; any change fails AEAD | Nothing further | `seal.test.ts` "re-addressed or re-attributed wire → null", "ctr tampered in the prefix → null (AAD mismatch), even to a valid counter"; `sync.test.ts` "a wire re-attributed to another linked address, or to an unlinked one, is ignored" |
| **Malicious relay: forge / tamper** | AEAD (authenticated encryption) rejects any changed byte; a forged counter does not advance the chain, because the state is committed only after the wire opened | Making the receiver spend up to 2 × 1024 HKDF steps on a garbage wire (bounded) | `seal.test.ts` "tampering any single byte → null (prefix, iv, ciphertext, tag)"; `ratchet.test.ts` "with the seal key resolver: the receiver commits the new state only after the wire opened" |
| **Malicious relay: holds wires beyond any TTL** | A held wire opens at most once, and only while its skipped key is still held; its content is authentic and idempotent and still waits for Receive; offers expire after 10 minutes and are one-use | Delay: late content is late, not wrong. A held wire keeps its skipped key alive on the receiver until it arrives or is evicted | `ratchet.test.ts` "skipped keys are bounded by MAX_SKIP: the smallest ctrs are evicted"; `sync.test.ts` "an expired code is refused by join; an expired offer ignores a pair wire" |
| **Network observer** | Content (AEAD inside, TLS to the relay in deployment) | IP addresses, timing and sizes towards the relay | None (out of scope) |
| **Stolen device state, later** (a copied blob, a backup, a profile copy) | Earlier wires stay closed: used chain and message keys are not in the state (forward secrecy) | Opens later wires on the current chains until the devices pair again (no post-compromise security), and wires whose skipped keys are held. With USE of the device key (see next row) and the epoch it re-derives the roots | `sync.test.ts` "forward secrecy: no key left in a device state captured after a round opens the wires of that round"; `ratchet.test.ts` "chain keys differ per step; a later state cannot re-derive or open an earlier message" |
| **Lost or stolen device** | Remaining devices unlink it; its wires no longer open; a later pairing uses a new epoch. The private key cannot be exported from IndexedDB by JavaScript | On the unlocked device the key can be USED (with the epoch: every wire of its current pairings that a relay kept); the record on the device; what the browser writes to disk for the key | `sync.test.ts` "after unlink a wire from that device is ignored, and syncNow says not linked"; `keystore.test.ts` "indexedDbKeyStore (fake IDB): what is stored is a CryptoKey object and the public key, never secret bytes" |
| **QR shoulder-surfer** | Cannot pose as the offerer (lacks its private key); a raced `pair` message produces a different SAS on the offerer's screen; one use only | If the owner taps Confirm without comparing, the interloper is linked and can send records (each still needs Receive) and receives ours | `keys.test.ts` "derivePairKeys: same SAS on both sides; A.send opens with B.recv and NOT with B.send"; `sync.test.ts` "pair via code: same 6-digit SAS on both sides, confirm stores the pairing on both", "a code is one use; a code whose address is my own is refused; cancel stores nothing" |
| **Link interceptor** | No link exists: the code is shown only as a QR | Someone who photographs the QR is the shoulder-surfer above | `sync.test.ts` "pairing code: format, parse, garbage refused (QR only: there is no link form)" |
| **Compromised paired device** | It cannot extend our own chain (`own`); a forgery under a third device's id is reported as a `fork` at the first device that holds both histories | It reads everything; entries are not signed per device, so it can write under a THIRD device's id; the forged entry stays (the real one is the one reported) | `log.test.ts` "a forged \"next\" entry under another device id is caught as a fork when the real one arrives, and reported, not silently kept", "entries carrying MY OWN device id are refused (own) unless recovery is asked for" |
| **Restore from an older backup / cloned device** | The restored device cannot open or send anything the peer accepts (its keys are gone there); it pairs again and the log merges, nothing lost; a second writer under one id is a detected fork | Sync until it pairs again; automatic fork repair | `sync.test.ts` "a device restored from an older backup cannot sync (its keys are gone on the peer: forward secrecy) until it pairs again"; `log.test.ts` "same id with different content → fork, the known entry stays" |
| **Wrong clocks** | Causal order ignores the clock; a delete beats a concurrent edit whatever the clocks say; the loser of a true tie is listed | Among truly concurrent edits the later clock wins; a skewed joiner may misjudge a code's `exp` | `log.test.ts` "a causally later put wins without a conflict, even with an EARLIER wall clock", "a winner is never an entry that something else causally replaced (clock skew)" |

Notes on four rows:

- **Shoulder-surfer.** The attacker knows the pairing secret, so it can send a valid `pair` message first. The offerer then shows SAS(offerer, attacker). The real joiner shows SAS(offerer, joiner). The attacker cannot steer its SAS to match, because the target depends on the offerer-joiner ECDH secret it cannot compute. One guess, about 1 in 1 000 000.
- **Compromised paired device.** The hash chain proves that a device's entries are consistent with each other, not who wrote them. Per-device signatures are future work (open points).
- **Stolen state.** "Deleted" means not kept by the module or in the state it returns. JavaScript cannot wipe memory, and old copies of a saved state may survive in the storage layer (browser files, OS swap, backups).
- **Restore from backup.** The backup holds chain states from before later rounds. Its `have` goes out under a counter the peer already used: the peer acks it, logs "already used", and does not answer, so `syncNow` rejects `offline`. Unlink and pair again on both devices; the next round brings everything back. With `recoverOwn` (merge option `acceptOwn`) the restored device also takes its own later entries back from a peer.

## 🔑 Key exchange between own devices (QR only)

### Device identity

- Each device holds one static X25519 key pair (RFC 7748).
- The private key is a WebCrypto `CryptoKey`, generated non-extractable (`generateDeviceKeys`), so its bytes never exist in JavaScript.
- `deviceId` = first 22 base64url characters of `SHA-256("trustweb-device-sync/v2/id" || publicKey)`. An id cannot be claimed without the key.
- In the log a device id must match `^[A-Za-z0-9_-]{1,64}$`. A name like `__proto__` is plain data everywhere.
- `address` is the opaque relay routing string. In TrustWeb it is the device's sync DID (did:peer:2).

### The code

```
TWS2~<address>~<publicKey b64u>~<secret b64u>~<exp ms>
```

| Part | Meaning |
|---|---|
| `TWS2` | Prefix (`PAIR_PREFIX`); v3 used `TWD1` |
| `address` | Where the joiner sends the `pair` message |
| `publicKey` | The offerer's X25519 public key, 32 bytes |
| `secret` | Fresh random one-time secret, 32 bytes (`secretKeyFromPairingSecret` refuses fewer than 16), only ever in the QR |
| `exp` | Offer expiry, `now + OFFER_TTL_MS` (10 minutes), in ms since epoch |

`~` cannot occur in base64url or in a did:peer:2, so splitting is unambiguous.
An address may not contain `~`, `|` or whitespace: `pairingCode` and `createDeviceSync` refuse one (`~` would break the code, `|` the AAD).

### Why not a link

A link can be forwarded, logged in browser and chat histories, and previewed by messengers that fetch it.
Each copy is a working pairing secret until it expires or is used.
A link also proves nothing about co-presence: the two devices may be anywhere.
A QR is read by the camera of the device in the same room.
The owner decided: QR only (PR #71). The package has no link helpers any more.

### The ceremony, step by step

1. **Offer.** Phone calls `offer()`. It draws a 32-byte secret, keeps only the derived `pair` key, the epoch and the expiry (`now + 10 min`) in memory, and shows the code as a QR.
2. **Scan.** Laptop scans the QR and calls `join(code)`. `parsePairingCode` rejects garbage; `join` refuses an expired code and a code whose address is its own.
3. **Sealed `pair` message.** Laptop derives `K_pair = HKDF-SHA256(secret, salt empty, info "trustweb-device-sync/v2/pair")` (RFC 5869). It sends one wire to the Phone's address: `pair` with body `{ deviceId, publicKey, name }`, sealed under `K_pair` with counter 1 and the AAD of the message layer.
4. **ECDH on both sides.** Laptop computes X25519(laptop private key, Phone public key from the QR). Phone, after opening the `pair` message, computes X25519(phone private key, Laptop public key from the message). The offer is consumed by the first valid `pair`.
5. **HKDF into roots and SAS** (`derivePairRoots`). Both sides compute the pairing **epoch** = base64url(SHA-256(secret)); it is known from the code and never sent. Salt = `SHA-256(lo || hi || epoch)`, where `lo` and `hi` are the two public keys sorted bytewise. From the shared secret:
   - root for direction lo→hi: 32 bytes, HKDF bits, info `trustweb-device-sync/v2/root/lo>hi`,
   - root for direction hi→lo: info `.../root/hi>lo`,
   - SAS: 32 bits (info `.../sas`), `mod 1 000 000`, zero-padded to 6 digits.
   My send root is the other side's receive root (crosswise).
6. **Compare.** Both screens show the 6-digit SAS (short authentication string: a code two humans compare to detect a swapped key). The owner checks that they match.
7. **Confirm on both.** Each side's `PairRequest.confirm()` stores a `Pairing` `{ address, deviceId, publicKey, name, sas, epoch, linkedAt, lastSyncAt, send, recv }`. `send` and `recv` are the two ratchet chains, seeded from the roots (`initChain`: chain = root, `next` = 1, no skipped keys). Counters start at 1. Cancel stores nothing. Before Confirm nothing syncs.
   `confirm` is one decision: a second call throws `already decided`, and a request whose pairing epoch was unlinked in the meantime cannot revive it (`unlinked`).

`derivePairRoots` refuses to pair a device with its own key and rejects an all-zero ECDH result (a low-order public key).
`derivePairKeys` (round 1: static directional AES keys, same salt and SAS) is still exported; the seal tests use it. `sync.ts` does not.

### Why each side is authenticated

| Direction | Authenticated by | Why the relay cannot fake it |
|---|---|---|
| Joiner → offerer | The secret: only someone who read the QR can build a `pair` message that opens under `K_pair` | The secret never travels through the relay |
| Offerer → joiner | The public key in the QR: the joiner uses it directly | The relay never carries the offerer's key to the joiner |

A man-in-the-middle at the relay would have to replace the joiner's key inside the sealed `pair` message (needs the secret) and the offerer's key inside the QR (out of band).
It can do neither.
It can only drop the `pair` message, which makes pairing fail visibly.

### A third device

- Pairing is pairwise. A Tablet pairs with the Phone and, separately, with the Laptop.
- With n devices there are n(n-1)/2 pairings: 3 for three devices, 10 for five. Each has its own two chains.
- Entries also flow transitively: the Laptop's entries reach the Tablet through the Phone, because merge is by entry id, not by sender.
- Pairing with every device anyway means sync does not depend on one device being online.

### Unlink, lost device, rotation

- `unlink(address)` deletes the pairing (epoch and both chains). Later wires from that address are ignored, and `syncNow` to it rejects with `not linked`.
- Pairing the same two devices again uses a fresh secret, so a new epoch: new roots, new chains, a new SAS. A wire captured under the earlier pairing does not open.
- Unlink does not take back what the other device already has. Its entries stay in the log.
- **Lost device:** unlink it on every remaining device. It only ever held chains involving itself, so other pairs stay sound. Until the unlink, whoever can use its key and read its blob can open that pairing's wires.
- **Rotation:** if a device's key may be misused, that device clears its key store, starts fresh (new key pair, new `deviceId`) and pairs again with the others. No `rotate()` call exists.
- A replacement device is a new device. It starts with an empty log and receives everything in its first sync.

### Why a 6-digit SAS instead of the 4-hex fingerprint

| | v3 fingerprint | v2 SAS |
|---|---|---|
| Size | 4 hex = 16 bits | 6 digits, about 20 bits |
| Attacker success per pairing | about 1 in 65 536 | about 1 in 1 000 000 |
| Derived from | SHA-256 of the shared secret | 32 HKDF bits of the shared secret with its own label, salted by both public keys and the pairing epoch |
| New per pairing | No: same two identities, same fingerprint | Yes: new epoch, new SAS |
| Readability | Mixed letters and digits | Digits only, easy to read aloud |
| Bias | none | `uint32 mod 1e6`, under 0.03 %, accepted |

The SAS is only as good as the human check. If nobody compares, an active attacker at pairing time is not detected.

## ✉️ Message layer (ratchet, seal, delivery)

### The ratchet

A ratchet here is a one-way key chain: each step derives the next key and the old one cannot be computed back.
`ratchet.ts` keeps one chain per pairing and direction, in the style of the symmetric-key ratchet of Signal's Double Ratchet.

```
message key(ctr) = HKDF-SHA256(chain(ctr), salt empty, info "trustweb-device-sync/v2/ratchet/msg")    → AES-GCM-256, non-extractable
chain(ctr + 1)   = HKDF-SHA256(chain(ctr), salt empty, info "trustweb-device-sync/v2/ratchet/chain")  → 32 bytes
```

- `ChainState` = `{ chain, next, skipped }`: the current chain key (base64url), the counter it yields, and skipped message keys.
- **Send** (`sendKey`): the key for `ctr = next`; the new state holds `chain(next + 1)` only.
- **Receive** (`receiveKey`), by the wire's counter:
  - `ctr = next`: one step.
  - `next < ctr ≤ next + 1024`: the keys of the gap are derived and kept in `skipped` (out-of-order delivery), then one step.
  - `ctr < next`: the skipped key for `ctr`, if still held; it is removed from the state.
  - anything else: no key.
- `MAX_SKIP` = 1024 bounds both how far ahead a counter may be and how many skipped keys are held per direction (the smallest are evicted).
- A used key is not in the returned state. Every function is pure: it returns a fresh state and never changes its input.
- A stored state the module could not have produced (`parseChainState`) is refused. That pairing is dropped and the devices pair again.

### Wire format

```
wire      = base64url( ctr (8 bytes, big-endian) || iv (12 bytes) || AES-GCM ciphertext and 16-byte tag )
AAD       = utf8("trustweb-device-sync/v2|<from>|<to>|<ctr>")
plaintext = len (4 bytes, big-endian) || J || zero bytes up to the smallest of 1024 / 4096 / 16384 / 65536 bytes
J         = canonical JSON of { kind, body } (keys sorted)
```

- AES-GCM-256 is an AEAD (authenticated encryption with associated data: it encrypts and detects any change), per NIST SP 800-38D.
- The IV (initialisation vector) is fresh and random per message.
- The counter sits in clear in front, because the receiver needs it to pick the message key before it can decrypt. It is in the AAD, so it cannot be changed.
- A `J` longer than 65 532 bytes is refused (`too large to seal`).
- `openMessage` accepts exactly this frame: the size must be the bucket the length implies, and every padding byte must be zero.
- `seal.ts` refuses an address containing `|` (`sync.ts` also refuses `~` and whitespace). Otherwise the AAD would be ambiguous.
- `openMessage` never throws. Every failure is the same `null`: bad base64url, short input, bad counter, no key, AEAD failure, bad frame or padding, bad UTF-8, bad JSON, missing `kind`.

### What the relay sees now

| Visible | Hidden |
|---|---|
| `from` and `to` addresses, timing | Content, entity ids, values, device names |
| The size bucket of each message (1, 4, 16 or 64 KiB) | The exact size within the bucket |
| How many pieces a round has | Which entries, how many entries |
| The per-direction counter: how many messages so far, gaps, reordering | The kind (`have`, `entries`, `pair`) except as guessed from bucket and timing |

### Counters and the ratchet

- Each direction counts from 1. The counter is the ratchet position, not a clock. Round 1's wall-clock counter floor is gone.
- **A used counter has no key.** A wire that repeats it (a replay, or an honest redelivery whose ack was lost) cannot open. It is consumed and acked, so the relay stops redelivering, and nothing is processed. The device logs "already used".
- **A counter more than 1024 ahead** is rejected: no key is derived, nothing is processed. In the current code it takes the same path as a used counter (acked, logged as "already used").
- **A forged counter does not advance the chain.** The prefix is unauthenticated until the wire opens. The new state is committed only after `openMessage` returned a message.
- Each message key is used once, so a GCM key and IV pair can never repeat, even apart from the random IVs.

### Persistence before acknowledgement

- The relay delivers at-least-once. A wire stays queued until the receiver acks it.
- **Send:** the advanced send chain is saved BEFORE the wire leaves. If the save throws, nothing is sent. A crash between save and send skips one counter; the receiver keeps that skipped key until it is evicted.
- **Receive:** `handle(from, payload)` opens, then commits the new receive chain and saves it BEFORE the wire counts. If storage throws, the in-memory chain is rolled back and the wire stays un-acked, so the relay delivers it again.
- Then the message is processed and `handle` returns `true` (ack).
- A crash after the save but before processing loses that wire's content, not its safety: the next round resends what is missing.
- A crash after the save but before the ack means a redelivery, which finds no key and is acked.
- Only a wire that does not open (wrong key, tampered, re-attributed, unlinked sender) stays un-acked.
- Every drop is logged through `onLog` (I6): used counters, dropped piece assemblies, pieces that do not fit, save failures, declines.

### Chunking

- `entries` carries `canonicalJson({ entries, heads })`, cut into pieces of at most `CHUNK_BYTES` = 45 000 bytes.
- Each piece is its own sealed message `{ sid, i, n, data, reply, name }`, with `data` the base64url of the piece.
- At most `MAX_PIECES` = 200 pieces. A round carries at most `CHUNK_BYTES * MAX_PIECES - 4096` bytes of entries (about 9 MB).
- A longer backlog is sent as a prefix of `since()` (device, seq order, so each device's run stays contiguous); the rest goes with the next sync. Only a single entry larger than the budget rejects with `Error('too large')`.
- Size per full piece: 45 000 raw bytes → 60 000 base64url characters plus a small body → the 65 536 bucket → 8 + 12 + 65 536 + 16 = 65 572 bytes → about 87.4 KB of base64url. With two DIDs around it, that stays under the relay's 128 KiB cap (`MAX_WIRE_BYTES`).
- A piece set is merged only when all `n` pieces of one `sid` arrived, and then only after Receive. A partial set merges nothing.
- Up to 4 partial piece streams per peer are kept, keyed by `sid`. The oldest beyond that is dropped and logged.

## 📜 The append-only record log

### Entry shape

```ts
type Op = { t: 'put'; kind: string; id: string; field: string; value: unknown }
        | { t: 'del'; kind: string; id: string }

interface LogEntry {
  id: string                    // `${device}:${seq}`
  device: string                // deviceId of the writer
  seq: number                   // 1..n per device
  vc: Record<string, number>    // vector clock at append time, includes own seq
  at: number                    // wall clock, ms; informational and tiebreak only
  prev: string                  // hash of this device's previous entry, '' for seq 1
  hash: string                  // b64u SHA-256 over canonical JSON of the entry without `hash`
  op: Op
}
```

- **Per-device sequence and hash chain.** Entry n names the hash of entry n-1. Inserting, removing or changing one breaks the chain.
- **Vector clock** (a map from device to the highest sequence of that device the writer had seen). Entry X happened before entry Y when Y's clock covers X. If neither covers the other they are **concurrent**.
- `heads()` is the vector of the highest contiguous `seq` known per device. `append` uses it as the new entry's `vc`, with the own seq set.
- `at` never decides order between causally related entries.

### Merge

`merge(incoming)` is a set union by `id`, with verification. Each incoming entry ends in exactly one bucket:

| Result | Condition |
|---|---|
| added | Valid shape, correct hash, chains to a known or earlier-in-batch predecessor, id new |
| duplicate | Id known with the same hash (counted, not re-added) |
| `malformed` | Not the shape of a `LogEntry` |
| `bad-hash` | Stored hash does not match the recomputed one |
| `chain-gap` | The predecessor (`seq - 1` of that device) is missing: neither held nor earlier in the batch |
| `fork` | Id known with a different hash (the known entry stays), or the held predecessor's hash differs from `prev` |
| `own` | Carries this device's own id, unless `merge(entries, { acceptOwn: true })` |

- The batch is sorted first, so an out-of-order batch still chains.
- A rejected entry makes the following entries of that device in the batch chain-gaps too. They are all reported.
- **Nothing is silently dropped.** Every rejected entry is reported in `MergeReport.rejected` with its id and reason (I6).
- **Nothing is ever deleted from the log.** A delete is an op (`del`), a tombstone (a marker that says "this entity was deleted", kept so the deletion itself syncs).
- Foreign entries enter only through `merge` (verified, after Receive). New own entries are created only by `append`.
- `merge(…, { acceptOwn: true })` (sync option `recoverOwn`) accepts own-id entries, verified, for a device that lost its storage.

### Storage size

- Overhead per entry is roughly 250 to 350 bytes plus the value.
- Example: 2 000 people × 8 fields = 16 000 entries ≈ 5 MB before any edit. Every edit adds one entry.
- The log never shrinks. A large first sync travels over several rounds. Compaction is future work.

## ⚖️ Conflict handling

### The materialize rule

`materialize()` turns the entry set into `entities[kind][id][field]` plus a list of `FieldConflict { kind, id, field, kept, dropped }`.
The rule is set-based, not a fold over a sorted list.

Per entity, deletions first:

1. The **surviving** entries are those no causally later entry replaced (a later put on the same field, or a later `del` of the entity).
2. If any `del` survives, the entity is gone. Each surviving edit that `del` never saw is listed as a `FieldConflict` with `field: ''`, whatever the clocks say.
3. Otherwise the entity is rebuilt from the puts no `del` covers. A put causally after a `del` revives the entity; fields the `del` erased stay erased.

Per field of a live entity:

4. One surviving put: it wins, no conflict.
5. Several surviving puts (written concurrently): the largest `(at, device, seq)` wins. Every other survivor is a `FieldConflict`.

Why not a fold: folding entries in `(at, device, seq)` order revives an already-replaced value under clock skew (example D).

### Determinism

- The winner of each field is a function of the entry set only.
- Output is canonical: the same set gives byte-identical JSON on every device, in any arrival order.
- Proven by `log.test.ts` "the same entry set in any insertion order → identical JSON and identical conflicts" and "is commutative: A∪B and B∪A give byte-identical materialized JSON".

### The wall-clock caveat, and why the loser is never lost

v2 narrows the wall-clock problem to one case: two edits that truly did not see each other.
An edit that saw the other one always wins, even with an earlier clock.
In the remaining case the later clock wins, which may be the wrong one.
That is acceptable because the loser is a `FieldConflict` with its full entry, shown in "Review merge", and it stays in the log for ever.

### Worked examples (Phone, Laptop, Tablet)

**A. Concurrent edit of one field.** `Phone:1` name = "alpha" at 100; `Laptop:1` name = "beta" at 200; neither saw the other.
Result on both: name = "beta"; conflict kept `Laptop:1`, dropped `Phone:1`.

**B. Wrong clock, causal edit.**

| Step | Phone | Laptop (clock far behind) |
|---|---|---|
| 1 | `Phone:1` name = "alpha", at 1000 | |
| 2 | | merges `Phone:1` |
| 3 | | `Laptop:1` name = "beta", at 5, vc {Phone:1, Laptop:1} |
| Result | name = "beta", no conflict | identical |

v3 would have kept "alpha" here (1000 > 5). v2 sees that the Laptop's edit replaced it.

**C. Delete against edit, then revival.**

| Step | Phone | Laptop |
|---|---|---|
| 1 | `Phone:1` p1.name = "alpha" | |
| 2 | | merges `Phone:1` |
| 3 | `Phone:2` p1.city = "beta", at 5 | `Laptop:1` del p1, at 6 |
| 4 | sync: p1 absent, conflict (field '') kept `Laptop:1`, dropped `Phone:2` | identical |
| 5 | `Phone:3` p1.note = "gamma" (after seeing the del) | |
| Result | p1 = { city: "beta", note: "gamma" }, no conflict | identical |

**D. Three devices, clock skew.** a: name = "alpha" (Phone, at 5, saw nothing); b: "beta" (Tablet, at 10, saw nothing); c: "gamma" (Laptop, at 3, saw b).
b is out: c causally replaced it. Survivors a and c are concurrent; a wins (5 > 3), one conflict.
A fold in clock order would end on b, a value the Laptop had already replaced.

## 🔄 Sync protocol

Kinds under the ratchet keys (the `pair` kind uses `K_pair`, see the key exchange):

| Kind | Body | Sent when |
|---|---|---|
| `have` | `{ heads, name }`, no `sid` | `syncNow(address)` starts |
| `entries` | `{ sid, i, n, data, reply, name }`; `data` holds a piece of `{ entries, heads }` | In answer to `have` (`reply: false`), or after Receive as the closing half (`reply: true`) |

### The Receive prompt (owner decision 1)

A complete `entries` message is never merged by itself. It is handed to `onIncoming` as an `Incoming`:

| Field | Meaning |
|---|---|
| `from` | `{ address, deviceId, name, sas }` of the sender. No key material |
| `counts` | `{ entries, devices }`: entries in the message and the distinct devices they name, counted before merge verification |
| `reply` | `false`: the other side's answer to our `have`. `true`: the closing half of a round the other side started |
| `accept()` | Merges (with the usual checks), saves, logs the merge report, returns the `MergeReport`. For `reply: false` it then sends our `entries` back with `reply: true` |
| `decline()` | Applies nothing, logs the decline. For `reply: false` it fails the waiting `syncNow` with `Error('declined')` and nothing is sent back |

- Nothing merges before `accept`.
- One decision per message: a second `accept` throws `already decided`; `decline` after a decision does nothing; a declined message cannot be accepted later.
- The closing half (`reply: true`) is asked about too, on the other device. Each person decides about what arrives on their own device.
- Answering a `have` is not a Receive: a device sends what the peer lacks without asking its person. The person is asked on the receiving side.
- The `syncNow` timeout keeps running while the prompt is open. A person who answers later than `handshakeMs` after the last piece sees `syncNow` reject with `offline`; a later `accept` still merges and sends ours back. The wiring should pick `handshakeMs` with that in mind.

### One round

| # | Phone (calls `syncNow`) | Laptop |
|---|---|---|
| 1 | sends `have { heads_P }` | |
| 2 | | sends `entries` = `since(heads_P)` plus `heads_L`, `reply: false` (may be one piece with zero entries) |
| 3 | "Receive from Laptop?" (`onIncoming`, `reply: false`) | |
| 4 | accept: merges, saves; sends `entries` = `since(heads_L)`, `reply: true`; `syncNow` resolves with `{ sent, received, merge }` | |
| 5 | | "Receive from Phone?" (`reply: true`); accept merges and saves; nothing is sent back |

- `have` carries no `sid`. The waiter in `syncNow` resolves when the person accepted and our half was sent.
- A second `syncNow` to the same peer while one is running returns the same in-flight promise.
- No answer within `handshakeMs` (default 30 s): `syncNow` rejects with `Error('offline')`. The timeout restarts whenever a piece arrives.
- `syncNow` on an address without a pairing rejects with `Error('not linked')`. A `have` from an unlinked address is ignored.

### Convergence

- Once both people accepted, both logs hold the union of both entry sets, unless entries were rejected or appended during the round.
- Same entry set, so same materialized record.
- Entries appended during the round, a declined half and the rest of a large backlog travel in the next round.
- With three devices, entries reach a device through any paired path, so repeated pairwise rounds converge.

### Partial delivery and idempotence

- A missing piece leaves its `sid` incomplete. Nothing of it is shown or merged. The next `syncNow` sends a fresh `sid`.
- Rejected entries do not advance `heads`, so the next round asks for them again.
- Replaying a whole round changes nothing: every replayed wire finds no key, so a replayed `have` gets no answer and a replayed `entries` never reaches the prompt.
- Merge order does not matter (commutative), and materialize depends only on the set.

## 🚚 Migration path

### 1. Keys at rest and the record blob (owner decision 3, implemented)

- `SyncData` v2 is `{ v: 2, pairings, log }`. It holds no device key. It does hold the pairings with their epochs and chain states.
- The private key lives in a `KeyStore`. In the app: `indexedDbKeyStore()`, which stores `{ publicKey (raw 32 bytes), privateKey (non-extractable X25519 CryptoKey) }` in database `trustweb-device-sync`, object store `keys`, key `device`. In tests: `memoryKeyStore()`.
- IndexedDB keeps a `CryptoKey` object by structured clone, so it comes back still non-extractable. No IndexedDB means every call rejects; it never falls back to localStorage.
- **Migration on first start:** a v1 blob with `secretKey` is moved by `migrateSecretToKeyStore`: the secret is imported non-extractable, saved in the key store, and the blob is rewritten as v2 without it. Same `deviceId`. A second start reads the key store, not the blob.
- **v1 pairings are dropped**, with a log line: they carry no ratchet state. The person pairs those devices again. The log is kept.
- If the key store holds a key, the blob's `secretKey` is not used. If nothing can be read, the device makes new keys and logs that it has to be linked again.
- `deviceKeysFromPrivateKey` checks that the stored public key belongs to the stored private key (by an ephemeral ECDH), so a mismatched record is refused.

### 2. Keys from the v3 sync identity

- v3 stores a `SerializedIdentityV1` per device. Its `keyAgreementSecretKey` is the raw X25519 secret of the sync DID's `E` key.
- Option A: `migrateSecretToKeyStore(keyStore, keyAgreementSecretKey)` imports it as the v2 device key. During the dual run the v3 identity still holds the raw secret in localStorage, so the IndexedDB gain arrives only when v3 retires.
- Option B (this document's recommendation, not an owner decision): a fresh v2 key from `generateDeviceKeys`. Every pairing has to be made again anyway, and the address stays the sync DID.
- v2 keys are domain-separated from v3: different HKDF salt and labels (`.../v2/...` against `.../v1`), so no v2 key opens a v3 wire.
- Naming trap: the HKDF label `trustweb-device-sync/v1` belongs to the v3 bundle sync. `/v2` is this design.

### 3. Carrying a pairing over

| Option | How | Trust |
|---|---|---|
| Pair again (recommended) | New `TWS2` QR | Full v2 ceremony, fresh epoch, fresh chains |
| Re-confirm | Build a v2 `Pairing` from the v3 one with a newly defined epoch and roots, show the SAS, Confirm | SAS check; needs an epoch rule not in the package |
| Silent carry-over | Build the v2 `Pairing` without asking | Keeps only the v3 4-hex check; needs an epoch rule too; not recommended |

### 4. Seeding the log from the current record

- Run one last v3 sync so the devices agree.
- **Seed on one device only.** It appends one `put` per entity field, with `at` taken from the v3 stamp. The other devices receive the seed in their first v2 sync.
- If every device seeded, every field would be written concurrently on all devices, and "Review merge" would fill with noise.
- Kinds map to v3's: `person`, `resource`, `meeting`, `event`, `task`, `channel`, `sameAs`, `chat`, `name`, and one kind for settings.
- `SYNC_EXCLUDED` keeps its meaning: per-device fields never become ops. Images stay on their device.
- **Nested collections need their own kind.** Model each note line as an entity (`kind: 'line'`, `id`) with a field for its person, and each chat message likewise.
- The connect code and `otherCodes` never enter the log (U22).

### 5. Turning edits into ops

- Pragmatic first step: at sync time, diff the record against `materialize()` and append one `put` (or `del`) per changed field.
- Later, edit sites can append ops directly, which gives truer causality and clocks.

### 6. Dual-run plan

| Phase | v3 | v2 | Exit check |
|---|---|---|---|
| 0 (now) | Live | Package only, tests | Package tests green |
| 1 Shadow | Live, decides | Runs after each v3 merge, materializes, compares, logs differences only | No unexplained difference over a test period |
| 2 Switch | Fallback for a device that announces only v3 | Decides; snapshot before every merge stays (R1) | Both devices on v2 |
| 3 Retire | Moved to `archive/` | Only path | |

### 7. Wiring in `sync_view.ts` and the app

- Pass `keyStore: indexedDbKeyStore()` and `onIncoming` to `createDeviceSync` (it is async: it reads the key store first).
- Pairing shows the code as a QR only. No "copy link", and no link input. A `TWD1` code gets "update TrustWeb on the other device".
- Confirm sheet: the 6-digit SAS replaces the 4-hex `fp`.
- "Receive from <device>?" sheet stays (owner decision 1), fed by `onIncoming`: name, entry and device counts, Receive / Decline.
- "Review merge" lists `FieldConflict`s: field, kept and dropped value with device and time.
- A device that logs "already used" from a peer after a restore needs re-pairing: say so in the sync log, offer the QR.
- Still the app's job: the per-pairing "shares my username" tick, `canSend`, the pre-merge snapshot, the version hello.
- Log lines (`onLog`) feed the existing sync log (I6). They name devices and counts, never values.
- **One raw sink.** The relay keeps one `onRawWire` callback. During dual run create the v2 sync with `register: false` and let the app's sink route each wire to v3 or to `handle(from, payload)`, acking when either returns `true`.

## 🔀 Alternatives considered

| Option | Runtime deps | Privacy against the relay | Forward secrecy / PCS | Conflict model | Effort |
|---|---|---|---|---|---|
| Keep v3 bundle | None | Content sealed; one key for both directions; no AAD; whole-record size per sync | Neither | Entity-level LWW by wall clock | None, but the gaps remain |
| Automerge or Yjs CRDT | One large library (Automerge ships a Wasm core) | Same as this design only if wrapped in our own seal | Only what our seal gives | Rich CRDT (maps, lists, text) | Medium to large |
| Matrix Megolm (group ratchet) | An Olm implementation (for example vodozemac via Wasm) | Content sealed; metadata to the server | Forward secrecy by a symmetric hash ratchet per session; no PCS within a session (new session needed) | None: messaging only | Large |
| Signal Double Ratchet | libsignal or an own implementation needing review | Content sealed | Forward secrecy and PCS (a DH step per round trip) | None: messaging only | Large: skipped-key storage, multi-device handling |
| Syncthing-style block sync | Separate daemon and protocol (BEP) | TLS between devices | TLS sessions | File level, conflict copies | Very large; files, not a record |
| **This design (round 2)** | **None (WebCrypto)** | **Content sealed, padded to buckets; directional chains; from/to/ctr in AAD** | **Forward secrecy by a symmetric ratchet per direction; no DH ratchet, so no PCS** | **Causal field-level LWW, deterministic, every loser listed** | **Small to medium; prototype exists** |

Round 2 sits between Megolm and the Double Ratchet: like Megolm's ratchet it only hashes forward; unlike the Double Ratchet it never mixes in fresh key agreement.
Adding that DH step is the main open point.

## 🚧 Open points and future work

| Topic | Why it matters | Direction |
|---|---|---|
| Post-compromise security | A stolen current chain key opens everything that follows until re-pairing | A DH ratchet step per sync round (fresh X25519 per `have`) |
| Restore from an older backup | Requires re-pairing (by design) | A future "re-key" handshake could shorten that |
| Post-quantum | Recorded traffic could be opened later | Hybrid X25519 + ML-KEM once WebCrypto or a vetted library offers it |
| Per-device signatures | A compromised paired device can write under a third device's id | Ed25519 signature over the entry hash, key bound to `deviceId` |
| Storage blob | The blob (now without keys, still with chain states and the whole log) is one synchronous localStorage write per accepted wire: quadratic for large syncs, about 5 MB limit | Split chain states from the log; IndexedDB for both |
| Unlinked-key acking | Wires from an unlinked pairing no longer open, so they stay un-acked and fill the relay's queue | Keep an unlinked pairing's state for a while, only to ack its wires |
| Device names: bidi | Names are cleaned and truncated to 64 characters, but bidi and zero-width characters are kept (spoofable display) | Strip or flag them before showing the name |
| Compaction and snapshots | The log only grows | Agreed snapshot entry plus pruning below a common head |
| More than 5 devices | n(n-1)/2 pairings, vector clocks grow per device | Hub-and-spoke pairing, clock pruning |
| Key backup and recovery | Losing all devices loses the key and the log | Encrypted export, recovery phrase |
| Metadata beyond buckets | Bucket, piece count and counter reveal record growth and activity | Fixed-size pieces only, cover `have`s |
| Fork repair | Forks are detected, not repaired | UI to retire a forked `deviceId` |
| Behind `TransportAdapter` | The package couples only to `RelayLike` | Move `RelayLike` into `packages/protocol` (I5), add a `MockTransport`-based test |

## 🧪 Test map

All files in `packages/device-sync/src/`. Run `node --test "src/**/*.test.ts"` from `packages/device-sync`.
All cases are exact test names. Totals: bytes 11, keys 18, keystore 13, log 35, ratchet 15, seal 20, sync 24 = **136**.

### `bytes.test.ts` (11)

| Claim | Cases |
|---|---|
| base64url is RFC 4648 §5 and strict | "b64u: round trips every length 0..64 and random bytes", "b64u: matches RFC 4648 §5 vectors (no padding)", "b64u: rejects bad characters and impossible lengths" |
| Byte helpers | "utf8 / fromUtf8 round trip; invalid UTF-8 throws", "concat joins in order", "equalBytes: equal, different, length mismatch", "randomBytes: length and not constant", "sha256: known vector" |
| Canonical JSON | "canonicalJson: sorts nested keys, keeps array order, omits undefined", "canonicalJson: stable across insertion order", "canonicalJson: throws on non-JSON values" |

### `keys.test.ts` (18)

| Claim | Cases |
|---|---|
| Non-extractable device keys | "generateDeviceKeys: 32-byte public key, NON-extractable private CryptoKey, no raw secret, id derived from the public key", "deviceKeysFromSecret reproduces the public key of the same secret (and the RFC 7748 vector); keeps secretKey; private key non-extractable" |
| Keys from the key store | "deviceKeysFromPrivateKey: rebuilds DeviceKeys from a CryptoKey + public key, without secretKey", "deviceKeysFromPrivateKey: rejects a public key that does not belong to the private key, bad lengths, and non-X25519 keys" |
| `deviceId` bound to the key | "deviceIdOf: 22 b64u chars of sha256(label \|\| pub)" |
| X25519 per RFC, low-order refused | "sharedSecret: both sides agree; matches RFC 7748", "sharedSecret: rejects bad lengths and low-order (all-zero result) public keys", "sharedSecret works from a generated (non-extractable) key against an RFC 7748 key" |
| SAS, directions, epoch | "derivePairKeys: same SAS on both sides; A.send opens with B.recv and NOT with B.send", "derivePairKeys: a context (pairing epoch) changes the keys and the SAS; both sides with the same context agree", "derivePairKeys: deterministic for the same pair (RFC vectors), different pairs → different keys", "derivePairKeys: refuses to pair a device with its own key" |
| Ratchet roots | "derivePairRoots: both sides agree crosswise, send != recv, 32 bytes, sas equals derivePairKeys' sas", "derivePairRoots: deterministic; context and peer change the roots; own key refused" |
| Pairing-secret key | "secretKeyFromPairingSecret: same secret → same key; other secret → no" |
| Existing sync DID | "base58btc: known vectors, leading zeros, round trip, bad chars", "x25519PublicKeyFromDidPeer2: extracts the E key", "x25519PublicKeyFromDidPeer2: throws for a DID without E or with a malformed E" |

### `keystore.test.ts` (13)

| Claim | Cases |
|---|---|
| Memory store | "memoryKeyStore: round trip, the loaded key works and is not extractable, clear empties it", "memoryKeyStore: returns copies of the public key (callers cannot mutate the stored one)", "memoryKeyStore / indexedDbKeyStore: save rejects a malformed key" |
| IndexedDB store (fake IndexedDB) | "indexedDbKeyStore (fake IDB): round trip through structured clone; upgrade creates the store once; connections closed", "indexedDbKeyStore (fake IDB): what is stored is a CryptoKey object and the public key, never secret bytes" |
| IndexedDB failures are loud | "indexedDbKeyStore: a malformed stored record makes load reject (it is not silently treated as \"no key\")", "indexedDbKeyStore: no IndexedDB available → load/save/clear reject with a clear message", "indexedDbKeyStore: an open error rejects", "indexedDbKeyStore: a failing put rejects instead of resolving" |
| Migration of a v1 secret | "migrateSecretToKeyStore: same deviceId/publicKey as deviceKeysFromSecret, no secretKey, key saved non-extractable", "migrateSecretToKeyStore: idempotent -- a store already holding the same public key keeps its key", "migrateSecretToKeyStore: a store holding a DIFFERENT key is overwritten by the v1 secret (the pairings belong to it)", "migrateSecretToKeyStore: through the fake IndexedDB, and a bad secret rejects without touching the store" |

### `log.test.ts` (35)

| Claim | Cases |
|---|---|
| Append | "builds the per-device chain, sequence, id and vector clock", "the vector clock names every device known at append time", "serializes concurrent appends (no duplicate seq)", "returned entries are frozen and changing the op passed in later does not change the log", "refuses an op that is not JSON" |
| Hash and order | "the hash covers every field but `hash` and does not depend on key order", "dominates and isConcurrent", "compareEntries: (at, device, seq) ascending" |
| Heads and `since` | "heads are the highest CONTIGUOUS seq per device", "since(heads) returns exactly the missing entries, by device then seq" |
| Merge: idempotent, ordered, commutative | "is idempotent: a second merge of the same batch counts duplicates and adds nothing", "sorts the batch, so an out-of-order batch still chains", "is commutative: A∪B and B∪A give byte-identical materialized JSON" |
| Merge: rejections reported | "tampered entry → bad-hash, not added; the rest of that device in the batch become chain-gaps", "missing predecessor → chain-gap; delivering it later then accepts both", "a correctly hashed entry whose prev does not match the predecessor we hold → fork (two histories), not chain-gap", "same id with different content → fork, the known entry stays", "malformed input → malformed (never throws), with the id when there is one" |
| Merge: forgery, own id, safe ids | "a forged \"next\" entry under another device id is caught as a fork when the real one arrives, and reported, not silently kept", "entries carrying MY OWN device id are refused (own) unless recovery is asked for", "device ids are base64url names; a name like a prototype property is plain data everywhere", "never mutates or keeps a reference to the incoming objects" |
| Materialize: fields and conflicts | "folds puts into entities[kind][id][field]", "concurrent puts on one field: one winner (later at), one FieldConflict, the same on both devices", "equal wall clocks: the device id decides (string compare), deterministically" |
| Causality beats clocks | "a causally later put wins without a conflict, even with an EARLIER wall clock", "a winner is never an entry that something else causally replaced (clock skew)" |
| Tombstones and revival | "del concurrent with a put: the tombstone wins and the put is listed (field \"\")", "a put dominated by the del is simply gone (no conflict)", "a put that causally follows the del revives the entity, without the fields the del erased", "revival after a concurrent del/put keeps the concurrent put (the del never saw it)" |
| Safety and determinism | "keys like \"__proto__\" from the wire stay data (no prototype pollution) and the result is a fresh copy", "the same entry set in any insertion order → identical JSON and identical conflicts" |
| Storage round trip | "round-trips through JSON text", "returns null for anything that is not a LogJson" |

### `ratchet.test.ts` (15)

| Claim | Cases |
|---|---|
| Constants and start | "constants", "initChain: chain = root, next = 1, no skipped keys; refuses a root that is not 32 bytes" |
| Send and receive | "send/receive in order", "sendKey and receiveKey never mutate the input state; keys are AES-GCM, non-extractable", "send side and receive side from the same root agree for 50 messages in random order" |
| Out of order, bounded | "out of order within MAX_SKIP: receive 5 first, then 1..4, each exactly once", "a ctr more than MAX_SKIP ahead → null, state unchanged; exactly MAX_SKIP ahead is accepted", "skipped keys are bounded by MAX_SKIP: the smallest ctrs are evicted", "invalid ctr → null" |
| One-time keys (replay) | "second use of a skipped key → null" |
| Forward secrecy | "chain keys differ per step; a later state cannot re-derive or open an earlier message", "two chains from different roots differ" |
| Stored state | "state round-trips through JSON (including skipped keys)", "parseChainState rejects garbage" |
| Commit only after open | "with the seal key resolver: the receiver commits the new state only after the wire opened" |

### `seal.test.ts` (20)

| Claim | Cases |
|---|---|
| Format and counter | "constants and aadOf (the counter is in the AAD)", "round trip A.send → B.recv", "wire layout: ctr (8 bytes BE, visible) \|\| iv \|\| ct; the plaintext is padded canonical JSON of {kind, body}", "large counters round trip through the 8-byte prefix", "peekCtr: garbage, short, zero or above 2^53 - 1 → null; never throws", "a key resolver: called with the counter; its key opens; null from it → null; a throwing resolver → null" |
| Tamper, wrong key, re-address | "tampering any single byte → null (prefix, iv, ciphertext, tag)", "ctr tampered in the prefix → null (AAD mismatch), even to a valid counter", "wrong key → null (other direction, other pair)", "re-addressed or re-attributed wire → null" |
| Fresh IV; open never throws | "two seals of the same message differ (fresh IV)", "garbage / empty / non-b64u / short → null, never throws", "authentic but invalid content → null (bad UTF-8, bad JSON, bad kind, bad ctr in the prefix)", "sealMessage rejects a message it could never open again" |
| Padding (finding 4) | "PAD_BUCKETS", "a 10-byte and a 900-byte message produce the same wire length (bucket 1024 + 12 IV + 16 tag, + 8 counter)", "bucket edges: 4 + JSON = 1024 stays in 1024, one byte more goes to 4096; 1 200 bytes → 4096; 20 000 → 65536", "too large: JSON longer than 65 536 - 4 → throws; exactly 65 532 seals", "padding bytes altered (under a valid AEAD) → null; bad length prefix → null; off-bucket size → null", "a sync.ts 'entries' piece of CHUNK_BYTES (45 000) raw bytes seals and opens (fits the 65 536 bucket)" |

### `sync.test.ts` (24)

| Claim | Cases |
|---|---|
| QR pairing | "pairing code: format, parse, garbage refused (QR only: there is no link form)", "pair via code: same 6-digit SAS on both sides, confirm stores the pairing on both", "a code is one use; a code whose address is my own is refused; cancel stores nothing", "an expired code is refused by join; an expired offer ignores a pair wire", "confirm is one decision: a second confirm throws and resets nothing; a stale confirm after unlink cannot revive the pairing" |
| Convergence; relay sees no content | "syncNow converges both logs and the materialized state; the relay sees no plaintext and no entity id", "a third device pairs with both and all three converge" |
| Replay, re-attribution, unlinked | "replay: re-delivering a captured entries wire changes nothing; it is consumed (acked) so the relay stops redelivering", "a wire re-attributed to another linked address, or to an unlinked one, is ignored", "a have from an unlinked device is ignored", "after unlink a wire from that device is ignored, and syncNow says not linked", "re-pairing the same two devices derives new keys: a wire captured under the earlier pairing does not open" |
| Offline | "syncNow rejects offline when the peer never answers" |
| Persistence and crash safety | "persistence: a device recreated from its saved SyncData and key store keeps pairing, keys, log and ratchet state", "a crash before persist cannot double-apply: re-delivery after restart merges idempotently" |
| Forward secrecy | "forward secrecy: no key left in a device state captured after a round opens the wires of that round" |
| Restore needs re-pairing | "a device restored from an older backup cannot sync (its keys are gone on the peer: forward secrecy) until it pairs again" |
| The Receive prompt | "Receive from <device>?: nothing is merged before accept; decline applies nothing and fails the waiting sync" |
| Key migration | "migration: a v1 blob with the secret key moves the key into the key store and is rewritten without it" |
| Pieces and rounds | "two piece streams from one peer at once both complete (the relay hands over several waiting have-answers together)", "a round larger than the budget is sent in parts; the next round continues where it stopped", "large logs travel in several pieces under CHUNK_BYTES each" |
| Wiring | "register:false leaves the relay sink to the app, which can route to handle itself", "createDeviceSync refuses an address containing a separator" |

The round-1 window tests live on in `archive/replay.test.ts`; they are not run.

## 📚 Sources

Tiers: [A] standard or primary specification, [B] peer-reviewed or authoritative project specification, [C] project documentation.
⚠️ marks a source older than 10 years.

- [A] ⚠️ IRTF, RFC 7748, "Elliptic Curves for Security" (X25519), Langley, Hamburg, Turner, 2016.
- [A] ⚠️ IETF, RFC 5869, "HMAC-based Extract-and-Expand Key Derivation Function (HKDF)", Krawczyk, Eronen, 2010.
- [A] ⚠️ NIST, SP 800-38D, "Recommendation for Block Cipher Modes of Operation: Galois/Counter Mode (GCM) and GMAC", Dworkin, 2007.
- [A] ⚠️ IETF, RFC 4303, "IP Encapsulating Security Payload (ESP)", section 3.4.3 anti-replay window (round 1, archived), Kent, 2005.
- [A] ⚠️ IETF, RFC 4648, "The Base16, Base32, and Base64 Data Encodings", section 5 base64url, Josefsson, 2006.
- [A] W3C, "Web Cryptography API" (`CryptoKey`, non-extractable keys, structured clone of keys into IndexedDB), W3C Recommendation, accessed 2026.
- [A] W3C / WHATWG, "Indexed Database API" (IndexedDB), accessed 2026.
- [B] Decentralized Identity Foundation (DIF), "Peer DID Method Specification" (did:peer, numalgo 2), living specification, accessed 2026.
- [B] ⚠️ Fidge, C., "Timestamps in Message-Passing Systems That Preserve the Partial Ordering", Australian Computer Science Conference, 1988.
- [B] ⚠️ Mattern, F., "Virtual Time and Global States of Distributed Systems", Workshop on Parallel and Distributed Algorithms, 1988 (published 1989).
- [B] ⚠️ Lamport, L., "Time, Clocks, and the Ordering of Events in a Distributed System", Communications of the ACM, 1978.
- [B] Perrin, T., Marlinspike, M., "The Double Ratchet Algorithm", Signal, revision 1, 2016-11-20 (symmetric-key ratchet, skipped message keys, the DH step this design lacks).
- [B] Matrix.org Foundation, "Olm" and "Megolm" cryptographic ratchet specifications, accessed 2026.
- [C] Automerge project, Automerge documentation (documents, conflicts), automerge.org, accessed 2026.
- [C] Syncthing project, "Block Exchange Protocol v1" documentation, accessed 2026.
- In-repo: `apps/trustweb/src/sync_core.ts`, `sync_link.ts` (v3), `apps/demo/src/relay.ts`, `packages/transport/src/relay_server.ts` (`MAX_WIRE_BYTES`), `apps/demo/src/did.ts`, `DECISIONS.md` (D-device-sync-v2, D-device-sync-e2ee, D-device-sync-e2ee-2, D-username-devices, D-relay-send-auth), `PRIVACY.md`, PR #68, PR #71.
