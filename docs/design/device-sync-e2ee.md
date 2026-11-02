# Device sync v2: end-to-end-encrypted log sync between the owner's own devices

Design document for `packages/device-sync` (`@resource-web/device-sync`).
Audience: the engineer who wires it into `apps/trustweb`.
Written 2026-11-02.

## 📦 Status

> **Prototype.** Branch `cloud/device-sync-e2ee-f`.
>
> **Implemented in `packages/device-sync`:** `bytes.ts` (base64url, canonical JSON, SHA-256),
> `keys.ts` (X25519 device keys, pair keys, 6-digit SAS, did:peer:2 `E` key reader),
> `seal.ts` (AES-GCM seal with from/to bound in the AAD), `replay.ts` (64-message anti-replay window),
> `log.ts` (append-only record log, verified merge, deterministic materialize),
> `sync.ts` (pairing code, `have` / `entries` protocol over the existing relay's raw path).
> Zero runtime dependencies (WebCrypto only). Tests run with `node --test`.
>
> **Not wired yet:** `apps/trustweb` still runs the v3 sync (`sync_core.ts`, `sync_link.ts`, `sync_view.ts`).
> No migration adapter exists in code. Section 10 is a plan, not a build.
>
> **Honest label (I7):** no forward secrecy (static keys), no post-quantum security, no metadata protection.
> The relay sees addresses, sizes, timing and how many pieces a sync takes.
> Entries are hash-chained but not signed per device, so a compromised paired device can write in another device's name.

## 🧭 Context

### How the record syncs today (v3)

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

| Gap in v3 | Effect | v2 answer |
|---|---|---|
| Whole record per sync | Cost grows with the record; size of the whole record leaks per sync | Only the entries the other side lacks travel |
| Entity-level last-writer-wins | Two edits to different fields of one person still conflict | Field-level ops |
| Wall-clock "newer" | A fast clock wins even over an edit that saw its value | Causal order first (vector clocks), clock only to break true ties |
| `exp` is the only replay defence | A captured wire replays for 10 minutes; a relay can hold and re-deliver | Counter per direction + 64-message window, idempotent merge |
| One symmetric key for both directions | A wire can be reflected back to its sender | Two directional keys |
| AAD absent | The relay could re-address a wire to another pairing that shares a key | `from` and `to` bound in the AAD |
| 4-hex fingerprint | 16 bits, compared by humans | 6-digit SAS, about 20 bits, secret to an attacker |

### Relation to the invariants

- **I1 Local sovereignty:** the log lives on the owner's devices only. It travels only between devices the owner paired, sealed. The relay carries ciphertext.
- **I6 Auditability:** merge reports every rejected entry with id and reason. The log itself is the audit trail: every change names its device, sequence and time.
- **I7 Honest labeling:** the status box above and the threat model below state what is not protected.
- **I9 Conservative defaults:** pairing codes expire after 10 minutes and are one-use. Nothing syncs before both humans Confirm. A conflict is never resolved silently: the loser is listed.

## 🎯 Scope

### Goals

- Content confidentiality and integrity against the relay and the network.
- Replay, reflection and re-addressing of wires have no effect.
- Pairing that a relay cannot man-in-the-middle, with a human check (SAS) against a leaked QR or link.
- Convergence: two devices with the same entry set show the same record, byte for byte.
- No edit is lost silently. Every overwritten concurrent value stays readable.
- Incremental sync: after the first round only new entries travel.
- Fits the existing relay without a server change (`sendRaw` / `onRawWire`).
- Zero runtime dependencies.

### Non-goals (this version)

- Forward secrecy and post-compromise security.
- Post-quantum key exchange.
- Hiding metadata (who syncs with whom, when, how much).
- Defending against a compromised paired device.
- Log compaction or snapshots.
- Rich text merge (character-level CRDT). A field is one value.
- Key backup or recovery. A lost key means pairing again.

## 🛡️ Threat model

### Assets

- The record content (people, notes, resources, settings) in the log.
- The device secret keys (X25519, 32 bytes each).
- The pair keys derived from them.
- The integrity of the log: which device wrote what, in which order.
- The pairing secret, during the 10 minutes it is valid.

### Adversaries

Test file names are relative to `packages/device-sync/src/`. Quoted cases are exact test names; `sync.test.ts` cases in parentheses are the required cases from the build spec.

| Adversary | What the design stops | What it does not stop | Proven by |
|---|---|---|---|
| **Honest-but-curious relay** | Reading content: every payload is AES-GCM ciphertext | Seeing `from` / `to` addresses, sizes, timing, piece counts; learning that two addresses belong to one owner; under D-relay-send-auth it also learns an authenticated sender DID | `sync.test.ts` (the concatenated wire payloads contain no plaintext field value); `seal.test.ts` "the plaintext is canonical JSON of {ctr, kind, body} and does not appear on the wire" |
| **Malicious relay: replay** | A re-delivered wire is dropped by the replay window; a merge of known entries is a no-op | Nothing further | `replay.test.ts` "duplicate rejected"; `sync.test.ts` (re-delivering a captured wire changes nothing) |
| **Malicious relay: reorder** | Out-of-order delivery within 64 messages is accepted once; pieces carry their index | A wire more than 64 counters behind is dropped (a liveness loss, not a safety loss) | `replay.test.ts` "out of order inside the window accepted exactly once", "too old (≤ high - 64) rejected, just inside accepted" |
| **Malicious relay: drop** | Detection only: `syncNow` rejects with `offline`, an incomplete piece set merges nothing | Availability; the relay can stop all sync | `sync.test.ts` ('offline' rejection on no answer) |
| **Malicious relay: re-address / re-attribute** | AAD binds `from` and `to`; a wire under another outer address fails AEAD | Nothing further | `seal.test.ts` "re-addressed or re-attributed wire → null"; `sync.test.ts` (delivering a wire with the outer from swapped is ignored) |
| **Malicious relay: forge / tamper** | AEAD (authenticated encryption) rejects any changed byte | Nothing further | `seal.test.ts` "tampering any single byte → null", "wrong key → null (other direction, other pair)" |
| **Malicious relay: holds wires beyond any TTL** | A held wire is either too old for the window (dropped) or still carries authentic, idempotent state; offers expire after 10 minutes and are one-use | The relay can delay the newest wire; its content is then late, not wrong | `replay.test.ts` "too old (≤ high - 64) rejected, just inside accepted"; `sync.test.ts` (expired codes are refused by join) |
| **Network observer** | Content (AEAD inside, TLS to the relay in deployment) | IP addresses, timing and sizes towards the relay | None (out of scope) |
| **QR shoulder-surfer / link interceptor** | Cannot pose as the offerer (lacks its secret key); a raced `pair` message produces a different SAS on the offerer's screen; one use only | If the owner taps Confirm without comparing, the interloper is linked and receives the record | `keys.test.ts` "derivePairKeys: same SAS on both sides; ..."; `sync.test.ts` (pair via code (same SAS both sides, confirm)) |
| **Lost or stolen device** | Remaining devices unlink it; its wires are no longer opened | The record on the device; past wires a relay kept or logged open with its static key (no forward secrecy) | `sync.test.ts` (unlink stops decryption) |
| **Compromised paired device** | Forks it creates become visible to the others | It reads everything and can append entries in any device's name (no per-entry signatures); it can pre-empt another device's next `seq`, so the real entry is later rejected as a fork | `log.test.ts` "same id with different content → fork, the known entry stays" (detection only) |
| **Cloned device / restore from backup (fork)** | A second writer under one device id is detected as a fork; a restored device that syncs first recovers its own later entries (merge accepts verified own-id entries); a rewound send counter is dropped as replay and never reuses a GCM IV (IVs are random) | Automatic fork repair; the restored device is silent until its counter passes the peer's high mark | `log.test.ts` "same id with different content → fork, the known entry stays"; `replay.test.ts` "duplicate rejected" |
| **Wrong clocks** | Causal order ignores the clock; a delete beats a concurrent edit whatever the clocks say; the loser of a true tie is listed | Among truly concurrent edits the device with the later clock wins; a skewed joiner may misjudge a code's `exp` | `log.test.ts` "a causally later put wins without a conflict, even with an EARLIER wall clock", "a winner is never an entry that something else causally replaced (clock skew)" |

Notes on three rows:

- **Shoulder-surfer.** The attacker knows the pairing secret, so it can send a valid `pair` message first. The offerer then shows SAS(offerer, attacker). The real joiner shows SAS(offerer, joiner). The attacker cannot steer its SAS to match, because the target depends on the offerer-joiner ECDH secret it cannot compute. One guess, about 1 in 1 000 000.
- **Compromised paired device.** The hash chain proves that a device's entries are consistent with each other. It does not prove who wrote them. Per-entry signatures are future work (section 12).
- **Restore from backup.** A fork occurs only if the restored device appends before it has caught up. `merge` accepts verified entries with the device's own id, so a restored device that syncs first gets its own later entries back and continues after them. Safest handling in the app: sync before the first edit, or treat a restored device as a new device (new key pair, new `deviceId`, pair again).

## 🔑 Key exchange between own devices (QR / link)

### Device identity

- Each device holds one static X25519 key pair (RFC 7748).
- `deviceId` = first 22 base64url characters of `SHA-256("trustweb-device-sync/v2/id" || publicKey)`. An id cannot be claimed without the key.
- `address` is the opaque relay routing string. In TrustWeb it is the device's sync DID (did:peer:2).
- In TrustWeb the key pair can be the `E` (key agreement) key of the existing sync DID (section 10).

### The code

```
TWS2~<address>~<publicKey b64u>~<secret b64u>~<exp ms>
```

| Part | Meaning |
|---|---|
| `TWS2` | Prefix (`PAIR_PREFIX`); v3 used `TWD1` |
| `address` | Where the joiner sends the `pair` message |
| `publicKey` | The offerer's X25519 public key, 32 bytes |
| `secret` | Fresh random one-time secret, 32 bytes (`secretKeyFromPairingSecret` refuses fewer than 16), only ever in the QR or link |
| `exp` | Offer expiry, `now + OFFER_TTL_MS` (10 minutes), in ms since epoch |

`~` cannot occur in base64url or in a did:peer:2, so splitting is unambiguous.

### The ceremony, step by step

1. **Offer.** Phone calls `offer()`. It draws a secret, keeps `{ secret, until: now + 10 min }` in memory, and shows the code as QR (and copyable text).
2. **Scan or paste.** Laptop reads the code with `join(code)`. `parsePairingCode` rejects garbage; `join` refuses an expired code.
3. **Sealed `pair` message.** Laptop derives `K_pair = HKDF-SHA256(secret, salt empty, info "trustweb-device-sync/v2/pair")` (RFC 5869). It sends one wire to the Phone's address: `pair` with body `{ deviceId, publicKey, name }`, sealed under `K_pair` with the AAD of section 6.
4. **ECDH on both sides.** Laptop computes X25519(laptop secret, Phone public key from the QR). Phone, after opening the `pair` message, computes X25519(phone secret, Laptop public key from the message). The offer is consumed by the first valid `pair`.
5. **HKDF.** Salt = `SHA-256(lo || hi)`, where `lo` and `hi` are the two public keys sorted bytewise. Three outputs from the shared secret:
   - key for direction lo→hi (info `trustweb-device-sync/v2/lo>hi`),
   - key for direction hi→lo (info `.../hi>lo`),
   - SAS: 32 bits (info `.../sas`), `mod 1 000 000`, zero-padded to 6 digits.
6. **Compare.** Both screens show the 6-digit SAS (short authentication string: a code two humans compare to detect a swapped key). The owner checks that they match.
7. **Confirm on both.** Each side's `PairRequest.confirm()` stores a `Pairing` (address, deviceId, public key, name, SAS, counters). Before Confirm nothing syncs.

`derivePairKeys` refuses to pair a device with its own key and rejects an all-zero ECDH result (a low-order public key).

### Why each side is authenticated

| Direction | Authenticated by | Why the relay cannot fake it |
|---|---|---|
| Joiner → offerer | The secret: only someone who read the QR or link can build a `pair` message that opens under `K_pair` | The secret never travels through the relay |
| Offerer → joiner | The public key in the QR: the joiner uses it directly | The relay never carries the offerer's key to the joiner |

A man-in-the-middle at the relay would have to replace the joiner's key inside the sealed `pair` message (needs the secret) and the offerer's key inside the QR (out of band).
It can do neither.
It can only drop the `pair` message, which makes pairing fail visibly.

### The link variant

- `pairingLink(base, code)` = `${base}#sync=<code, URI-encoded>`. `codeFromLink` reads it back.
- The code sits in the URL fragment, which browsers do not send to the server.
- **Added risk:** a link can be forwarded, previewed by a messenger, synced into browser history or pasted into a log. Each copy is a working pairing secret until it expires or is used.
- Mitigations: 10-minute expiry, one use, and the SAS comparison. Prefer the QR when both devices are at hand. Compare the SAS on both screens before Confirm even when the link came by your own message to yourself.

### A third device

- Pairing is pairwise. A Tablet pairs with the Phone and, separately, with the Laptop.
- With n devices there are n(n-1)/2 pairings: 3 for three devices, 10 for five.
- Entries also flow transitively: the Laptop's entries reach the Tablet through the Phone, because merge is by entry id, not by sender.
- Pairing with every device anyway means sync does not depend on one device being online.

### Unlink, lost device, rotation

- `unlink(address)` deletes the pairing (keys, counters, replay state). Later wires from that address are not opened.
- Unlink does not take back what the other device already has. Its entries stay in the log.
- **Lost device:** unlink it on every remaining device. The lost device only ever held pair keys involving itself, so other pairs stay sound.
- **Rotation:** if a device's secret key may have leaked (a backup copy, a restore), that device gets a new key pair (new `deviceId`) and pairs again with the others. No `rotate()` call exists in the prototype; rotation is "new `SyncData`, pair again".
- A replacement device is a new device. It starts with an empty log and receives everything in its first sync.

### Why a 6-digit SAS instead of the 4-hex fingerprint

| | v3 fingerprint | v2 SAS |
|---|---|---|
| Size | 4 hex = 16 bits | 6 digits, about 20 bits |
| Attacker success per pairing | about 1 in 65 536 | about 1 in 1 000 000 |
| Derived from | SHA-256 of the shared secret | HKDF of the shared secret with its own label, salted by both public keys |
| Readability | Mixed letters and digits | Digits only, easy to read aloud |
| Bias | none | `uint32 mod 1e6`, under 0.03 %, accepted |

The SAS is only as good as the human check. If nobody compares, an active attacker at pairing time is not detected.

## ✉️ Message layer (seal, counters, delivery)

### Seal

- AES-GCM-256 (an AEAD: authenticated encryption with associated data; it encrypts and detects any change), per NIST SP 800-38D.
- Fresh random 12-byte IV (initialisation vector) per message.
- Plaintext: canonical JSON of `{ ctr, kind, body }` (keys sorted).
- AAD (associated data: authenticated but not encrypted) = `trustweb-device-sync/v2|<from address>|<to address>`.
- Wire payload: `base64url(iv || ciphertext)`. This is what `sendRaw(to, payload)` hands the relay.
- The counter `ctr` sits inside the authenticated plaintext, never in cleartext. The relay cannot read or change it.
- `seal.ts` refuses an address containing `|`. Otherwise the AAD would be ambiguous: `"a|b"` + `"c"` and `"a"` + `"b|c"` would give the same bytes.
- `openMessage` never throws. Every failure is the same `null`: bad base64url, short input, AEAD failure, bad UTF-8, bad JSON, or a missing or invalid `ctr` / `kind`.

Binding `from` and `to` in the AAD means the relay's cleartext outer fields cannot be changed without the open failing.
Directional keys mean a wire sent Phone→Laptop does not open as Laptop→Phone (no reflection).
Random 96-bit IVs stay far below the NIST limit of 2^32 messages per key for any realistic device sync volume.

### Counters and the anti-replay window

- Each `Pairing` keeps `sendCtr`. Every sealed message carries the next value, starting at 1.
- The receiver keeps `ReplayState { high, seen }` per pairing, in the style of the IPsec ESP window (RFC 4303, section 3.4.3).
- `high` is the highest accepted counter. `seen` lists the accepted counters in `(high - 64, high]`.
- Accept rule: `ctr` is a positive safe integer, not in `seen`, and `> high - 64`. Otherwise the wire is dropped.
- A late wire within the window is accepted once. A wire 64 or more behind `high` is dropped.
- Any stored state the guard could not have produced itself is treated as empty. The window then reopens; the idempotent log merge is the second line of defence.

The window is the first line of defence, not the only one.

### Persistence before acknowledgement

- The relay delivers at-least-once. A wire stays queued until the receiver acks it.
- `handle(from, payload)` returns `true` (ack) only after: open, replay check, and persisting the new replay state (and, for a completed `entries`, the merged log).
- A crash before persist means no ack, so the relay redelivers, and the wire is processed then.
- A crash after persist but before the ack means a redelivery, which the window drops.
- If a crash loses `sendCtr` increments, the peer drops the repeated counters as replays until the counter passes its `high`. Because IVs are random, this never reuses a GCM nonce.

### Chunking

- `entries` carries `canonicalJson({ entries, heads })`, cut into pieces of at most `CHUNK_BYTES` = 45 000 bytes.
- Each piece is its own sealed message `{ sid, i, n, data, reply, name }`, with `data` the base64url of the piece.
- At most `MAX_PIECES` = 200 pieces, so at most about 9 MB of JSON per direction per round. More rejects with `Error('too large')`.
- Size on the wire per piece: 45 000 → about 60 000 base64url characters → sealed and encoded again, about 80 KB, under the relay's 128 KB limit.
- A piece set is merged only when all `n` pieces of one `sid` arrived. A partial set merges nothing.

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

- **Per-device sequence and hash chain.** A device's entries form a chain: entry n names the hash of entry n-1. Inserting, removing or changing one breaks the chain.
- **Vector clock** (a map from device to the highest sequence of that device the writer had seen). Entry X happened before entry Y when Y's clock covers X. If neither covers the other they are **concurrent**: written without knowledge of each other.
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
| `chain-gap` | `prev` does not equal the hash of `seq - 1` of that device |
| `fork` | Id known with a different hash; the known entry stays |

- The batch is sorted first, so an out-of-order batch still chains.
- A rejected entry makes the following entries of that device in the batch chain-gaps too. They are all reported.
- A missing predecessor that arrives later is accepted, and then its successors too.
- **Nothing is silently dropped.** Rejected entries are not stored, but every one is reported in `MergeReport.rejected` with its id and reason. The app logs these lines (I6).
- **Nothing is ever deleted from the log.** A delete is an op (`del`), a tombstone (a marker that says "this entity was deleted", kept so the deletion itself syncs).
- Foreign entries enter only through `merge` (verified). New own entries are created only by `append`. Entries loaded from own storage are trusted.
- `merge` also accepts verified entries that carry this device's own id. That recovers a device's own history from a peer after local storage loss, before it appends again.

### Storage size

- Overhead per entry is roughly 250 to 350 bytes plus the value (two 43-character hashes, id, vector clock with one number per device).
- Example: 2 000 people × 8 fields = 16 000 entries ≈ 5 MB before any edit. Every edit adds one entry.
- The log never shrinks. The first sync of a large migrated record can approach the 9 MB per-round limit.
- Compaction (a signed snapshot that replaces a prefix of the log) is future work (section 12).

## ⚖️ Conflict handling

### The materialize rule

`materialize()` turns the entry set into `entities[kind][id][field]` plus a list of `FieldConflict { kind, id, field, kept, dropped }`.

Per `(kind, id, field)`:

The rule is set-based, not a fold over a sorted list.

Per entity, deletions first:

1. The **surviving** entries are those no causally later entry replaced (a later put on the same field, or a later `del` of the entity).
2. If any `del` survives, the entity is gone. The latest surviving `del` is kept. Each surviving edit that `del` never saw is listed as a `FieldConflict` with `field: ''`. This holds whatever the clocks say.
3. Otherwise the entity is rebuilt from the puts no `del` covers. A put causally after a `del` therefore revives the entity; fields the `del` erased stay erased.

Per field of a live entity:

4. One surviving put: it wins, no conflict.
5. Several surviving puts (written concurrently): the largest `(at, device, seq)` wins. Every other survivor is listed as a `FieldConflict` (kept = winner, dropped = loser).

Consequence of rule 3: on revival, a put that was concurrent with the `del` (the `del` never saw it) comes back, and its conflict disappears.

Why not a fold: folding entries in `(at, device, seq)` order and letting each "newer" one win revives an already-replaced value under clock skew. Example D below is that case: a fold would bring back b.

### Determinism

- The winner of each field is a function of the entry set only: "causally replaced" depends on vector clocks, the tiebreak on `(at, device, seq)`, and all are fields of the entries.
- Two entries of one device are always causally ordered, so in practice `(at, device)` already decides between concurrent survivors; `seq` makes the order total.
- Output is canonical: the same set gives byte-identical JSON on every device, in any arrival order.
- Proven by `log.test.ts` "the same entry set in any insertion order → identical JSON and identical conflicts" (20 shuffled insertion orders, three devices) and "is commutative: A∪B and B∪A give byte-identical materialized JSON".

### The wall-clock caveat, and why the loser is never lost

`sync_core.ts` warns that "newer" across devices is a wall-clock comparison, and a wrong clock can win edits it should lose.
v2 narrows that to one case: two edits that truly did not see each other.
An edit that saw the other one always wins, even with an earlier clock.
In the remaining case the later clock wins, which may be the wrong one.
That is acceptable because the loser is a `FieldConflict` with its full entry (value, device, time), shown in "Review merge".
The losing entry also stays in the log forever, so the owner can restore it by writing it again.

### Worked examples (Phone, Laptop, Tablet)

Notation: `Phone:1` is the Phone's first entry. Clocks in arbitrary ms.

**A. Concurrent edit of one field.**

| Step | Phone | Laptop |
|---|---|---|
| 1 | `Phone:1` put p1.name = "alpha", at 100, vc {Phone:1} | |
| 2 | | `Laptop:1` put p1.name = "beta", at 200, vc {Laptop:1} |
| 3 | sync | sync |
| Result | name = "beta"; conflict kept `Laptop:1`, dropped `Phone:1` | identical |

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
| 6 | sync | sync |
| Result | p1 = { city: "beta", note: "gamma" }, no conflict | identical |

"alpha" stays erased: the delete saw it. "beta" returns: the delete never saw it.

**D. Three devices, clock skew.**

| Entry | Device | at | Saw |
|---|---|---|---|
| a: name = "alpha" | Phone | 5 | nothing |
| b: name = "beta" | Tablet | 10 | nothing |
| c: name = "gamma" | Laptop | 3 | b |

- b is out: c causally replaced it, even though b has the largest clock.
- Survivors: a and c, concurrent.
- a wins (5 > 3). One conflict: kept a, dropped c.
- Every device that holds all three entries shows the same result.
- A fold in `(at, device, seq)` order (c at 3, a at 5, b at 10) would end on b, a value the Laptop had already replaced. That is why materialize is set-based.

## 🔄 Sync protocol

Kinds under the pair keys (the `pair` kind uses `K_pair`, section 5):

| Kind | Body | Sent when |
|---|---|---|
| `have` | `{ heads, name }` | `syncNow(address)` starts |
| `entries` | `{ sid, i, n, data, reply, name }`; `data` holds a piece of `{ entries, heads }` | In answer to `have` (`reply: false`), or as the closing half (`reply: true`) |

### One round

| # | Phone (calls `syncNow`) | Laptop |
|---|---|---|
| 1 | sends `have { heads_P }` | |
| 2 | | sends `entries` = `since(heads_P)` plus `heads_L`, `reply: false` (may be one piece with zero entries) |
| 3 | merges, persists | |
| 4 | sends `entries` = `since(heads_L)`, `reply: true` | |
| 5 | resolves with `{ sent, received, merge }` | merges, persists; sends nothing back |

- No answer within `handshakeMs` (default 30 s): `syncNow` rejects with `Error('offline')`.
- A `have` that arrives unsolicited is answered the same way. The answering side merges the reply.
- `syncNow` on an address without a pairing rejects with `Error('not linked')`. A `have` from an unlinked address is ignored.

### Convergence

- After step 5 both logs hold the union of both entry sets, unless entries were rejected or appended during the round.
- Same entry set, so same materialized record (section 8).
- Entries appended during the round travel in the next round.
- With three devices, entries reach a device through any paired path, so repeated pairwise rounds converge.

### Partial delivery

- A missing piece leaves its `sid` incomplete. Nothing of it is merged.
- The next `syncNow` sends a fresh `sid` built from current heads, so nothing is lost and nothing is double-counted.
- Rejected entries do not advance `heads`, so the next round asks for them again; a permanently bad entry stays reported each time.

### Idempotence

- Replaying a whole round changes nothing: the window drops the wires, and if a fresh round re-sends known entries, merge counts them as duplicates.
- Merge order does not matter (commutative), and materialize depends only on the set.

## 🚚 Migration path from v3

### 1. Keys from the existing sync identity

- v3 stores a `SerializedIdentityV1` per device. Its `keyAgreementSecretKey` is the raw X25519 secret of the sync DID's `E` key.
- `deviceKeysFromSecret(fromB64u(keyAgreementSecretKey))` gives the v2 `DeviceKeys`. The address stays the sync DID.
- Each v3 `Pairing.did` yields the peer's public key through `x25519PublicKeyFromDidPeer2(did)`.
- v2 keys are domain-separated from v3: different HKDF salt and labels (`.../v2/...` against `.../v1`), so no v2 key opens a v3 wire.
- Naming trap: the HKDF label `trustweb-device-sync/v1` belongs to the v3 bundle sync (`SYNC_VERSION = 3`). `/v2` is this design.

### 2. Carrying a pairing over

Two options:

| Option | How | Trust |
|---|---|---|
| Re-confirm (recommended) | Build the v2 `Pairing` from the v3 one, compute the SAS, show it on both devices once, Confirm | Upgraded to the SAS check |
| Silent carry-over | Build the v2 `Pairing` without asking | Keeps only the v3 4-hex check; must be labeled as such |
| Pair again | New `TWS2` code | Full v2 ceremony |

### 3. Seeding the log from the current record

- Run one last v3 sync so the devices agree.
- **Seed on one device only.** It appends one `put` per entity field from the current record, with `at` taken from the v3 stamp.
- The other devices receive the seed in their first v2 sync, then append their own changes causally after it.
- If every device seeded, every field would be written concurrently on all devices, and "Review merge" would fill with noise.
- Kinds map to v3's: `person`, `resource`, `meeting`, `event`, `task`, `channel`, `sameAs`, `chat`, `name`, and one kind for settings.
- `SYNC_EXCLUDED` keeps its meaning: per-device fields never become ops. Images stay on their device.
- **Nested collections need their own kind.** v3 unites a person's note lines by id and chats by message key, so nothing is lost. A single field holding the whole `lines` array would lose concurrent additions. Model each line as an entity (`kind: 'line'`, `id`) with a field for its person, and each chat message likewise.
- The connect code and `otherCodes` never enter the log (U22). They keep their own path.

### 4. Turning edits into ops

- v3 found that about 40 edit sites would need an `updatedAt`. v2 has the same problem.
- Pragmatic first step: at sync time, diff the record against `materialize()` and append one `put` (or `del`) per changed field. Same idea as v3's stamp-at-sync-time, but per field.
- Later, edit sites can append ops directly, which gives truer causality and clocks.

### 5. Dual-run plan

| Phase | v3 | v2 | Exit check |
|---|---|---|---|
| 0 (now) | Live | Package only, tests | Package tests green |
| 1 Shadow | Live, decides | Runs after each v3 merge, materializes, compares, logs differences only | No unexplained difference over a test period |
| 2 Switch | Fallback for a device that announces only v3 ("update TrustWeb there") | Decides; snapshot before every merge stays (R1) | Both devices on v2 |
| 3 Retire | Moved to `archive/` | Only path | |

### 6. What changes in `sync_view.ts` and the app

- Confirm sheet: the 6-digit SAS replaces the 4-hex `fp` (`data-fingerprint` becomes a SAS field; `Pairing.fp` becomes `sas`).
- Code entry accepts `TWS2` codes and `#sync=` links. A `TWD1` code gets "update TrustWeb on the other device".
- "Review merge" lists `FieldConflict`s: field name, kept value and device, dropped value and device, times. Mapping to the v3 `Conflict` shape is straightforward.
- Merge-on-receive: v2 merges authenticated entries without asking. v3 asked "Receive from <device>?" first. Since nothing is lost in v2, the sheet can move to "apply the merged record", or go. This is a product decision for the wiring.
- Not in the package and still the app's job: the per-pairing "shares my username" tick, "this device only receives" (`canSend`), the pre-merge snapshot, the version hello.
- Log lines (`onLog`) feed the existing sync log (I6). They name devices and counts, never values.

## 🔀 Alternatives considered

| Option | Runtime deps | Privacy against the relay | Conflict model | Replay defence | Effort |
|---|---|---|---|---|---|
| Keep v3 bundle | None | Content sealed; one key for both directions; no AAD; whole-record size per sync | Entity-level LWW by wall clock; loser in Review merge | `exp` 10 min only | None, but the gaps remain |
| Automerge or Yjs CRDT | One large library (Automerge ships a Wasm core); the package rule is zero deps and this host cannot install | Same as this design only if wrapped in our own seal; neither encrypts | Rich CRDT (maps, lists, text); Automerge exposes conflicting values | None built in; needs our seal and window anyway | Medium to large: the record model moves into the CRDT document |
| Matrix Olm / Megolm style ratchet | An Olm implementation (for example vodozemac via Wasm) | Forward secrecy per session; still metadata to the server | None: messaging only, sync still needed on top | Per-session message indices | Large |
| Signal Double Ratchet | libsignal or an own implementation needing review | Forward secrecy and post-compromise security | None: messaging only | One-time message keys | Large: per-pair ratchet state, skipped-key storage, multi-device handling |
| Syncthing-style block sync | Separate daemon and protocol (BEP) | TLS between devices; relays see TLS endpoints | File level, conflict copies | TLS | Very large; files, not a record |
| **This design** | **None (WebCrypto)** | **Content sealed, directional keys, from/to in AAD; same metadata as today** | **Causal field-level LWW, deterministic, every loser listed** | **Counter + 64 window, idempotent merge** | **Small to medium; prototype exists** |

The ratchets were rejected for now on effort and risk, not on value. Section 12 keeps forward secrecy open.

## 🚧 Open points and future work

| Topic | Why it matters | Direction |
|---|---|---|
| Forward secrecy | A stolen device key opens every past wire a relay kept | Per-session ephemeral X25519 in `have`, or a symmetric ratchet per direction |
| Post-quantum | Recorded traffic could be opened later | Hybrid X25519 + ML-KEM once WebCrypto or a vetted library offers it |
| Per-entry signatures | A compromised paired device can write in another device's name | Ed25519 signature over the entry hash, key bound to `deviceId` |
| Compaction and snapshots | The log only grows; 9 MB per round cap | Agreed snapshot entry plus pruning below a common head |
| More than 5 devices | n(n-1)/2 pairings, vector clocks grow per device | Hub-and-spoke pairing through one trusted device, clock pruning |
| Key backup and recovery | Losing all devices loses the key and the log | Encrypted export (the existing snapshot file), recovery phrase |
| Metadata padding | Sizes and piece counts reveal record growth | Pad pieces to fixed size, send cover `have`s |
| Fork repair | Forks are detected, not repaired | UI to retire a forked `deviceId` and re-pair as a new device |
| Behind `TransportAdapter` | Today the package couples only to `RelayLike` (`sendRaw` / `onRawWire`) | Move `RelayLike` into `packages/protocol` (I5), add a `MockTransport`-based test |
| Ack of a replayed wire | Whether a replayed but authentic wire is acked decides whether the relay keeps redelivering it | Confirm in `sync.ts` that it is acked (consumed), and test it |

## 🧪 Test map

All files in `packages/device-sync/src/`. Run `node --test "src/**/*.test.ts"` from `packages/device-sync`.

| Claim | File | Case |
|---|---|---|
| base64url is RFC 4648 §5 and strict | `bytes.test.ts` | "b64u: matches RFC 4648 §5 vectors (no padding)", "b64u: rejects bad characters and impossible lengths" |
| Canonical JSON is stable | `bytes.test.ts` | "canonicalJson: sorts nested keys, keeps array order, omits undefined", "canonicalJson: stable across insertion order" |
| Constant-time compare handles length mismatch | `bytes.test.ts` | "equalBytes: equal, different, length mismatch" |
| `deviceId` is bound to the public key | `keys.test.ts` | "deviceIdOf: 22 b64u chars of sha256(label \|\| pub)" |
| X25519 matches the RFC and refuses low-order keys | `keys.test.ts` | "sharedSecret: both sides agree; matches RFC 7748", "sharedSecret: rejects bad lengths and low-order (all-zero result) public keys" |
| Same SAS on both sides; directional keys | `keys.test.ts` | "derivePairKeys: same SAS on both sides; A.send opens with B.recv and NOT with B.send" |
| Different pairs, different keys; no self-pairing | `keys.test.ts` | "derivePairKeys: deterministic for the same pair (RFC vectors), different pairs → different keys", "derivePairKeys: refuses to pair a device with its own key" |
| Existing sync DID yields the device key | `keys.test.ts` | "x25519PublicKeyFromDidPeer2: extracts the E key", "...: throws for a DID without E or with a malformed E" |
| No plaintext on the wire | `seal.test.ts` | "the plaintext is canonical JSON of {ctr, kind, body} and does not appear on the wire" |
| Tamper, wrong key, re-address fail | `seal.test.ts` | "tampering any single byte → null", "wrong key → null (other direction, other pair)", "re-addressed or re-attributed wire → null" |
| Fresh IV per seal | `seal.test.ts` | "two seals of the same message differ (fresh IV)" |
| Open never throws | `seal.test.ts` | "garbage / empty / non-b64u / short → null, never throws" |
| Replay window | `replay.test.ts` | "fresh guard: empty state, first counter accepted", "duplicate rejected", "too old (≤ high - 64) rejected, just inside accepted", "out of order inside the window accepted exactly once", "non-integer / non-positive / unsafe ctr rejected and not recorded" |
| Replay state survives a restart; bad state reopens the window | `replay.test.ts` | "state round-trips through JSON and keeps rejecting what it saw", "malformed initial state → empty" |
| Chain and vector clock | `log.test.ts` | "builds the per-device chain, sequence, id and vector clock" |
| Merge is idempotent and commutative | `log.test.ts` | "is idempotent: ...", "is commutative: A∪B and B∪A give byte-identical materialized JSON" |
| Rejections are reported | `log.test.ts` | "tampered entry → bad-hash, ...", "missing predecessor → chain-gap; ...", "same id with different content → fork, ...", "malformed input → malformed (never throws), ..." |
| `since` sends exactly what is missing | `log.test.ts` | "since(heads) returns exactly the missing entries, by device then seq" |
| Concurrent edit: one winner, one conflict | `log.test.ts` | "concurrent puts on one field: one winner (later at), one FieldConflict, the same on both devices" |
| Causality beats clocks | `log.test.ts` | "a causally later put wins without a conflict, even with an EARLIER wall clock", "a winner is never an entry that something else causally replaced (clock skew)" |
| Tombstones and revival | `log.test.ts` | "del concurrent with a put: the tombstone wins and the put is listed (field \"\")", "a put that causally follows the del revives the entity, ...", "revival after a concurrent del/put keeps the concurrent put ..." |
| Determinism | `log.test.ts` | "the same entry set in any insertion order → identical JSON and identical conflicts" |
| Pairing end to end | `sync.test.ts` | pair via code (same SAS both sides, confirm) |
| Convergence | `sync.test.ts` | syncNow converges both logs and materialized state |
| Relay sees no content | `sync.test.ts` | the concatenated wire payloads contain no plaintext field value |
| Replay and re-attribution over the relay | `sync.test.ts` | re-delivering a captured wire changes nothing; a wire with the outer `from` swapped is ignored |
| Unlinked and unlinked-later peers | `sync.test.ts` | a `have` from an unlinked address is ignored; unlink stops decryption |
| Offline and codes | `sync.test.ts` | 'offline' rejection on no answer; pairingLink/codeFromLink round trip; parsePairingCode rejects garbage; expired codes are refused by join |

Cases in quotes are the exact test names at the time of writing (bytes 11, keys 12 including RFC 7748 vectors, seal 10, replay 12, log 32 in 6 suites).
`sync.test.ts` was still being written; its rows name the required cases from the build spec, not exact test names.

## 📚 Sources

Tiers: [A] standard or primary specification, [B] peer-reviewed or authoritative project specification, [C] project documentation.
⚠️ marks a source older than 10 years.

- [A] ⚠️ IRTF, RFC 7748, "Elliptic Curves for Security" (X25519), Langley, Hamburg, Turner, 2016.
- [A] ⚠️ IETF, RFC 5869, "HMAC-based Extract-and-Expand Key Derivation Function (HKDF)", Krawczyk, Eronen, 2010.
- [A] ⚠️ NIST, SP 800-38D, "Recommendation for Block Cipher Modes of Operation: Galois/Counter Mode (GCM) and GMAC", Dworkin, 2007.
- [A] ⚠️ IETF, RFC 4303, "IP Encapsulating Security Payload (ESP)", section 3.4.3 anti-replay window, Kent, 2005.
- [A] ⚠️ IETF, RFC 4648, "The Base16, Base32, and Base64 Data Encodings", section 5 base64url, Josefsson, 2006.
- [B] Decentralized Identity Foundation (DIF), "Peer DID Method Specification" (did:peer, numalgo 2), living specification, accessed 2026.
- [B] ⚠️ Fidge, C., "Timestamps in Message-Passing Systems That Preserve the Partial Ordering", Australian Computer Science Conference, 1988.
- [B] ⚠️ Mattern, F., "Virtual Time and Global States of Distributed Systems", Workshop on Parallel and Distributed Algorithms, 1988 (published 1989).
- [B] ⚠️ Lamport, L., "Time, Clocks, and the Ordering of Events in a Distributed System", Communications of the ACM, 1978.
- [B] Perrin, T., Marlinspike, M., "The Double Ratchet Algorithm", Signal, revision 1, 2016-11-20.
- [B] Matrix.org Foundation, "Olm" and "Megolm" cryptographic ratchet specifications, accessed 2026.
- [C] Automerge project, Automerge documentation (documents, conflicts), automerge.org, accessed 2026.
- [C] Syncthing project, "Block Exchange Protocol v1" documentation, accessed 2026.
- In-repo: `apps/trustweb/src/sync_core.ts`, `sync_link.ts` (v3), `apps/demo/src/relay.ts`, `apps/demo/src/did.ts`, `DECISIONS.md` (D-device-sync-v2, D-username-devices, D-relay-send-auth), `PRIVACY.md`.
