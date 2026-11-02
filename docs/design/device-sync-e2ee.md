# Device sync, end to end encrypted (v2): design and prototype

Status: **prototype, not wired into the app.** Proposal for the owner's decision (see "Open questions"). Licence of the code:
`SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later` (the repo's header; AGPL is the licence in force, see `NOTICE`).

| Part | File | Tests |
|---|---|---|
| Crypto: pairing code and link, key schedule, sealed frames, padding, replay guard | `apps/trustweb/src/sync_e2ee.ts` | `apps/trustweb/test/unit/sync_e2ee.test.mjs` |
| Record log: append-only ops, hybrid clock, verify, frontier, merge, conflicts | `apps/trustweb/src/sync_log.ts` | `apps/trustweb/test/unit/sync_log.test.mjs` |
| Network: pairing and sync over the existing relay interface (`RelayChannel.sendRaw` / `onRawWire`) | `apps/trustweb/src/sync_e2ee_link.ts` | `apps/trustweb/test/unit/sync_e2ee_link.test.mjs` |

Nothing changes on the relay (`packages/transport/src/relay_server.ts`) and nothing changes in v1 (`sync_link.ts`, `sync_core.ts`,
`sync_view.ts`). The prototype sits beside v1 until the owner decides how to roll it out.

---

## 1. What exists today (v1), read before designing

- **`apps/demo/src/did.ts`**: a device identity is a did:peer:2 with an Ed25519 signing key (relay drain auth, send auth) and an X25519
  key-agreement key; `ecdhSharedSecret(identity, theirDid)` resolves the other DID's public X25519 key from the DID itself. No registry.
- **`apps/demo/src/relay.ts`** (`RelayChannel`): store-and-forward through `POST /relay/send` and the authenticated `wss …/relay/drain`.
  The relay routes on the clear `to`, sees the clear `from` (and since D-relay-send-auth verifies it on ingress), the time and the size,
  and holds a wire until the recipient drains and acks it (at-least-once). `sendRaw` / `onRawWire` carry a payload verbatim; the callback's
  `true` is the ack. Wire limit 128 KiB (`MAX_WIRE_BYTES`).
- **`apps/trustweb/src/sync_link.ts` + `sync_core.ts`** (v1 device sync): a separate sync DID per device; pairing code
  `TWD1~<did>~<16-byte secret>`; the joiner's DID sealed under a key from the secret; pair key = HKDF(X25519) → one AES-GCM key; four hex
  digits of SHA-256(ECDH secret) as the check. Messages `hello` / `ready` / `data` with `exp` = +10 min. A sync sends the **whole record**
  as a bundle in 45 KB pieces; the receiver confirms, takes a snapshot, merges per entity by id with **wall-clock** stamps, and lists both-
  sides-changed entities in Review merge. Nothing is ever deleted.
- **`apps/trustweb/src/sovereign_switch.ts`**: "the log is the shape the record moves to (append-only JSONL)". Today the export writes one
  `create_node` line per node; there is no live log yet.

### Findings in v1 that v2 addresses

| # | Finding | Who can use it | Effect | v2 |
|---|---|---|---|---|
| F1 | One AES key for both directions | the relay operator (it writes the drain frames, including `from`) | a wire A sent to B can be delivered back to A as "from B" and opens: a reflected `hello` makes A answer `ready`; a reflected `data` shows A its own record as "Receive from B?" | a key per direction, DIDs in the AAD (additional authenticated data) |
| F2 | Freshness is only `exp` (10 min) | the relay operator | within 10 minutes a captured `data` set can be replayed any number of times; each replay completes again and raises a new "Receive from …?" sheet | sequence numbers + stored replay window; authentic replays are acked and dropped |
| F3 | Check = 4 hex digits (16 bit) of the bare ECDH secret | whoever learns the pairing code (a link sent through a messenger) | 1 in 65 536 per attempt to pass a substituted key | 6 digits (~20 bit) over a root bound to both DIDs, the epoch and the code's secret; the offer is single use |
| F4 | Piece size is exact | the relay operator | the size of the record (to the byte, from the last piece) and how it grows | padding to size buckets (1, 4, 16, 64 KiB) |
| F5 | Merge by wall clock | any device with a wrong clock | an older edit can win (documented caveat; snapshot as the safety net) | hybrid logical clock: an edit made after seeing another one always wins |
| F6 | Whole record per sync | everyone pays (bandwidth, battery); the relay sees the full size each time | — | only the ops the other side lacks |

Unchanged and out of scope for v2 (as in v1): the identity and pairing secrets sit in the browser's storage in clear (`localStorage`);
see "Open questions".

---

## 2. Goals and non-goals

Goals
1. The relay (and anyone on the network) learns **nothing of the record**: no entity, no name, no device name, no message type, no exact
   size. It learns what it must to route: the two sync DIDs, the time, a size class.
2. Pairing of the owner's own devices with **one scan or one link**, checked by the person with a six-digit number on both screens.
3. Replays, reflections, re-addressing and tampering are **refused**, also across restarts.
4. Two devices that edited apart **converge** to the same record, without losing anything, without trusting either clock, and with the
   same conflicts listed on both.
5. Behind the **existing relay interface**, no server change; swappable like every transport (I5).

Non-goals (for this step)
- Forward secrecy and post-compromise security (a ratchet). See section 9.
- More than two devices in one group key (MLS-style). v2 pairs devices two by two; three devices are three pairings, and the log merge is
  the same (ops travel through any device).
- Hiding *that* two sync DIDs talk, or when (traffic analysis). The sync DID is separate from the asking DID (as v1), so this links no one
  in anybody's web.

---

## 3. Threat model

Assets: the record (people, notes, resources, meetings, events, chats, settings), the device names, the pairing secret and keys.

| Actor | Capability | What they get with v2 | Residual |
|---|---|---|---|
| Relay operator (honest but curious) | reads every outer wire: `to`, `from`, time, size | two sync DIDs talk; when; size class | timing, frequency, size class |
| Relay operator (malicious) | drops, delays, duplicates, reorders, reflects, rewrites, injects drain frames with any `from` | nothing opens: wrong key (direction), wrong AAD (addresses, header) or replay | can **drop** (denial of service); can delay up to `exp` |
| Network observer | TLS-encrypted traffic to the relay | less than the relay | as above |
| Carrier of the pairing **link** (messenger, mail, clipboard history) | knows the code's secret for up to 10 minutes | can try to pair **once** with its own key; the check differs (a 1-in-a-million guess), the person sees an unknown request or a wrong number and cancels | the person must compare the six digits; see 4.4 |
| Someone who photographs the **QR** | same as the link carrier | same | same |
| A third person's device | knows our sync DID (from the relay or a leak) | cannot pair without a live code; cannot open frames | — |
| A lost or stolen own device | holds the keys and the record | everything that device holds (as today) | unlink on the other devices stops new data reaching it; nothing takes back what it holds |
| A compromised own device (malware) | holds the keys | can write ops into the log (it is the owner's device) | ops are signed by content id only, not by a device key; see 9 |
| A device restored from an old backup | old counters | its new ops reuse numbers | detected as a fork, both versions kept (5.6) |

Assumptions: WebCrypto (AES-GCM, HKDF, SHA-256) and X25519 are sound; each device's CSPRNG works; the person compares the six digits.

Invariants: **I1** the record leaves the device only sealed to the owner's own linked devices (as D-device-sync-v2 reads I1). **I2**
untouched: nothing here is asker-facing. **I5** the link depends only on `Pick<RelayChannel, 'sendRaw' | 'onRawWire'>`; the tests run it
over a fake relay. **I6** every pairing, merge, replay and refusal writes a local log line (`onLog`). **I7** this note says what is not
protected (section 3 residuals, section 9). **I9** a code is single use and short lived; pairing needs a Confirm on both devices.

---

## 4. Key exchange between own devices (QR or link)

### 4.1 Flow

```
 Laptop (offers)                                 relay                                  Phone (joins)
 ───────────────                                 ─────                                  ─────────────
 secret s = 32 random bytes
 shows QR / link:  TWD2~<laptopDid>~<s>  ── camera or link, never the relay ──▶  parses it
                                                                                ep = random 32-bit epoch
                                                                                keys = KDF(X25519(phone, laptop), s, DIDs, ep)
                       ◀──────── frame(ep=0) sealed under offerKey(s, laptopDid): {pair, phoneDid, "phone", ep} ────────
 offer spent (single use)
 keys = KDF(X25519(laptop, phone), s, DIDs, ep)
 shows "phone — 123 456"   Confirm                                               shows "Other device — 123 456"   Confirm
 ──────── frame(ep, seq) under laptop→phone key: {hi, "laptop"} ────────▶        key confirmation; names the laptop
```

- **QR**: the code itself (`TWD2~…`). **Link**: `https://<app>/#tw-sync=<code>`; the code is in the **fragment**, which a browser never
  sends to a server, so the web server that serves the app does not see it either (`offerLink`, `parseOffer` accept both).
- The relay carries only the joiner's `pair` frame and from then on pair-keyed frames. It never sees `s`.

### 4.2 Key schedule (`derivePairKeys`)

```
salt   = SHA-256("trustweb-device-sync/v2\n" || min(didA, didB) || "\n" || max(didA, didB) || "\n" || epoch)
root   = HKDF-SHA256(ikm = X25519(own, other) || s, salt, info = "trustweb-device-sync/v2 root")          256 bit
k(A→B) = HKDF-SHA256(root, info = "trustweb-device-sync/v2 key " || didA || ">" || didB)                   AES-256-GCM
k(B→A) = HKDF-SHA256(root, info = "trustweb-device-sync/v2 key " || didB || ">" || didA)                   AES-256-GCM
check  = uint32(HKDF-SHA256(root, info = "trustweb-device-sync/v2 sas")) mod 10^6, shown "123 456"
offer  = HKDF-SHA256(s, info = "trustweb-device-sync/v2 offer " || offerDid)                               AES-256-GCM
```

Why both X25519 and `s`: X25519 alone needs no code at all (anyone who knows both DIDs could start a pairing request); `s` alone would
let anyone who saw the code read the sync. Both together: a party needs the code **and** one of the two private keys. A label of its own
(`…/v2`) means no v2 key can ever open a v1 or a connect-link message, and the reverse.

### 4.3 Epoch, unlink, re-pair

- The joiner picks a random non-zero 32-bit **epoch** per pairing; it is in the salt and in every frame header. A re-pair gives new keys,
  and frames of the old pairing are refused before decryption (header epoch ≠ pairing epoch) and would not open anyway.
- **Unlink** forgets the pairing on this device: frames from the other device no longer open and are not acked. (Telling the other device
  is a UI step, not a crypto one; v1's "Unlink takes the secret back" for the public link stays as it is.)

### 4.4 Man in the middle, honestly

- The relay cannot substitute a key: it never sees `s`, and the `pair` frame is sealed under `offerKey(s)` with both DIDs in the AAD.
- Whoever **has the code** (link carrier, QR photo) can race the real device with its own DID. The offer is spent by the first valid
  `pair` frame, so the attacker gets one try, and the two screens then show different checks (the attacker would need the six digits to
  match by chance: 1 in 10^6), or the offering device shows an unexpected request. The check is therefore load-bearing whenever the code
  travelled as a link; with a QR scanned in the same room the race window is small. The UI must say: "Confirm only if both screens show
  the same six digits."
- After Confirm, the offering device's first frame (`hi`) is the **key confirmation** for the joiner: it only opens if both derived the
  same keys.

---

## 5. Wire format, replay protection, sync protocol

### 5.1 Frame (`sealFrame` / `openFrame`)

```
payload = base64url( header(13) || IV(12) || AES-256-GCM(padded plaintext) )
header  = version(1) = 0x02 || epoch(uint32 BE) || seq(uint64 BE)
AAD     = "trustweb-device-sync/v2\n" || fromDid || "\n" || toDid || "\n" || header
padded  = uint32 BE length || plaintext || zeros, to 1 KiB, 4 KiB, 16 KiB, 64 KiB, then multiples of 64 KiB
```

- The IV is random per frame (not derived from `seq`): a device restored from a backup can repeat a `seq`, and a repeated IV under one
  GCM key would be catastrophic; a random 96-bit IV is safe for far more frames than a pairing will ever send.
- Binding `from` / `to` / header into the AAD refuses re-addressing, header rewrites and (with the per-direction key) reflection.
- The largest frame the link sends (48 000 bytes of ops + JSON, padded to 64 KiB) is about 87 KB of base64url, under the relay's 128 KiB.

### 5.2 Replay protection (`isReplay` / `admit` / `nextSeq`)

- **Sender**: `seq = max(last + 1, now_ms × 1000)`, stored before the frame leaves. Because the floor is the clock in microsecond steps, a
  counter restored from an older backup still moves forward (as long as the clock does).
- **Receiver**, per pairing: `floor` + the last `REPLAY_WINDOW` (512) accepted numbers. A number at or under `floor`, or in the window, is a
  replay. Frames may arrive out of order (the relay redelivers un-acked wires). Stored with the pairing, so a restart does not reopen the
  window (tested). A number is admitted only **after** its frame opened, so forged headers cannot fill the window.
- **Ack rule** (relay at-least-once): an authentic replay or an expired message is **acked and dropped** (else the relay delivers it
  forever); a frame that does not open is **not acked** (same as v1: it may be for a pairing confirmed later).
- `exp` (10 min) stays inside every message as a second, coarse bound.

### 5.3 Sync protocol (`sync_e2ee_link.ts`)

```
A → B   have {f: frontier(A), r: false}
B → A   ops  {ops A lacks}          (0..n frames of at most 48 000 bytes)
B → A   have {f: frontier(B), r: true}
A → B   ops  {ops B lacks}
```

`frontier` is a version vector (highest op number per device). A second sync with nothing new is two small frames, padded to 1 KiB like
any other. The person's per-sync "Receive from …?" of v1 is not needed for safety (the log is append-only, nothing is overwritten or
lost); see "Open questions" for what the UI keeps.

---

## 6. Conflict handling for the append-only record log (`sync_log.ts`)

### 6.1 Ops

```ts
{ id, dev, n, prev, hlc: {t, c}, key, op: 'put' | 'add' | 'retract', val?, base? }
```

- `key` is the entity key v1 already uses (`p:<person>`, `i:<resource>`, `m:<meeting>`, `e:<event>`, `t:<task>`, `c:<channel>`,
  `g:<setting>`, `n:me`), so v2 speaks about the same entities as Review merge.
- `put` sets the entity's whole value (a last-writer-wins register per key). `add` puts an element (`{id, …}`) into a grow-only set (note
  lines, chat messages: v1 already "unites by id"). `retract` hides an entity; the value stays in the log and readable. **No op is ever
  edited or removed.**
- `dev` is a random id of the device's log (not a DID, so the log names no identity), `n` its counter, `prev` the id of its op `n-1`.
- `id` = SHA-256 of the canonical JSON (sorted keys) of everything else. An altered op is refused (`hash`); an op whose predecessor is not
  known is held back (`gap`) and comes with a later sync.

### 6.2 Order: a hybrid logical clock (HLC)

Each device keeps `{t, c}`: `t` = max(wall clock, every stamp seen), `c` counts within one `t`. A local edit ticks; taking ops in moves
the clock past them. So an edit made **after** seeing another device's edit always orders after it, even if that device's clock runs an
hour ahead (tested). The total order for folding is `(hlc.t, hlc.c, dev, id)`, the same on every device.

A device with a clock far in the future drags the logical clock forward. That is harmless to correctness (the clock only orders), and
nothing is clamped (clamping would bring back "an older edit wins"). The UI can warn when an op arrives more than a day ahead.

### 6.3 When is it a conflict

`base` = the op the device saw as current for that key when it wrote. Two `put`/`retract` ops on one key **with the same base** were
written without seeing each other: that is a conflict. The later one in the total order is shown; the other(s) are listed
(`materialise().conflicts`: key, base, op ids, kept) and stay in the log. An edit that saw the other one (its base is the other) is no
conflict, just the newer version. Sets (`add`) never conflict. The conflict list is computed from the log, so both devices show **the same
list** (v1: each device lists what it saw at its own merge).

Mapping to today's UI: one conflict = one Review merge entry (`mine` / `theirs` = the op values, `kept` = the op that won). Dismissing it is
a local note, not an op.

### 6.4 Merge of two device logs

`mergeLogs(mine, incoming)` = the union by id after the checks above. Union is commutative, associative and idempotent, so devices that
exchange ops in any order, any number of times, through any device, end with the same set and therefore, through `materialise`, the
same record (tested: both directions, shuffled input, double merge).

### 6.5 Bridge from today's record

The 40-odd edit sites do not write ops. `observe(log, entries)` compares each `[key, value]` of the record with what the log shows and
appends a `put` for each one that differs: the same idea as v1's `refreshStamps`, run before each sync. The entity extraction stays where
it is (`sync_core.ts`'s `entities`, which would need to be exported). Note lines and chat messages can move to `add` ops later, when the
edit sites are touched anyway.

### 6.6 Restore from a backup, forks

A device restored from an older backup would append with numbers it already used. `mergeLogs` reports this as a **fork** (`dev`, `n`) and
keeps both versions (they are both the owner's). Rule for the integration: **a log restored from a backup takes a new `dev` id** (its old
ops keep theirs), so forks only come from bugs, and the frontier exchange stays exact (with a fork, the twin op with a number the other side
already has is not sent by `missingFor`; a full exchange heals it).

### 6.7 Growth

The log grows with every edit. Plan: periodic **checkpoint** = a `put` per live key at a known frontier, signed off by both devices, after
which ops below it can be archived locally (moved, never deleted, per repo rule). Not built; the sizes today (hundreds of people) make it
unnecessary for now.

---

## 7. Rollout plan (proposal)

1. **Ship nothing user-visible**: this branch (prototype + tests + this note).
2. Export `entities` from `sync_core.ts`; store a `DeviceLog` beside the record (IndexedDB); run `observe` at app start and before sync.
3. Wire `createE2eeSync` into `sync_view.ts` behind a feature flag: "Link a device (new)", QR + link, six-digit check.
4. Both versions side by side: v1 pairings keep working; a new pairing is v2. The first v2 sync seeds the log by `observe` on both sides;
   the existing Review merge shows `materialise().conflicts`.
5. After a release with both: v1 pairing off; v1 receive stays for one more release; then archive v1 (moved to `archive/`, not deleted).
6. DECISIONS.md entry when the owner decides (a proposal entry is added with this branch).

---

## 8. Test map (what the tests prove)

| Property | Test |
|---|---|
| Code and link round-trip; the secret sits in the fragment; other shapes refused | `sync_e2ee` › pairing code and link |
| Both sides: same six digits, mirrored keys; a different secret, epoch or key gives a different check | `sync_e2ee` › key schedule |
| No reflection (per-direction keys) | `sync_e2ee` › key schedule; `sync_e2ee_link` › reflected wire |
| Encrypt / decrypt round trip; any flipped byte, swapped sender/recipient or header refused | `sync_e2ee` › sealed frames |
| Relay sees no plaintext: markers, message types, keys, device names absent from every wire | `sync_e2ee` › sealed frames; `sync_e2ee_link` › edits made apart |
| Padding to buckets; largest frame under 128 KiB | `sync_e2ee` › sealed frames; `sync_e2ee_link` › larger than one frame |
| Replay: once only, any order, bounded window, survives restart; send counter grows after restore | `sync_e2ee` › replay guard; `sync_e2ee_link` › relay plays again, after a restart |
| Pairing: single-use offer, no pairing without the secret, Cancel keeps nothing, key confirmation names the device | `sync_e2ee_link` › pairing over the relay |
| Unlink and re-pair (epoch) shut old frames out | `sync_e2ee_link` |
| Append-only, content ids, tamper and gap refused | `sync_log` › append-only log, merge |
| Merge of two device logs converges, idempotent, order-free | `sync_log` › merge of two device logs; `sync_e2ee_link` › edits made apart |
| Causality beats a skewed clock; concurrent edits listed identically on both, loser kept | `sync_log` › merge |
| Restore fork detected, both versions kept | `sync_log` › merge |

---

## 9. Not covered, and what would cover it

| Gap | Risk | Next step |
|---|---|---|
| No forward secrecy: the pairing keys are static | a later theft of a device's storage reads recorded traffic (the relay deletes acked wires, so mainly a malicious relay that kept copies) | a symmetric ratchet per direction (HKDF chain, key per `seq` range) is a small step; a DH ratchet (Double Ratchet) is a larger one |
| Keys at rest in `localStorage` (as v1) | an XSS or a stolen unlocked device reads them | non-extractable `CryptoKey` in IndexedDB; OS keystore in the native app |
| Ops are authenticated per pairing, not per device | a compromised own device can write ops claiming another `dev` | sign each op with the device's Ed25519 key (the DID's `V` key) |
| Timing and frequency visible to the relay | when the owner edits | cover traffic is out of proportion for now |
| Two-by-two pairings | three devices = three pairings | group key (MLS) only if many devices become common |
| `hi` is the only key confirmation for the joiner; if it is lost the joiner still shows "Other device" | cosmetic | the first `have` also names the device |

---

## 10. Open questions for the owner

1. **Per-sync confirmation.** v1 asks "Receive from …?" before every merge and takes a snapshot. With an append-only log nothing is lost,
   so v2 could merge silently and only show conflicts. Keep the sheet (I9-style conservative default) or drop it?
2. **Link pairing.** Allow pairing by link at all (convenient across rooms, but the six digits become essential), or QR only?
3. **Key storage.** Move the sync keys to non-extractable IndexedDB keys in the same step, or later?
4. **Forward secrecy.** Is a symmetric ratchet worth doing before rollout?
