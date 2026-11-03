# TRANSPORT.md — `@resource-web/transport` (M2-T)

Owned by `packages/transport`. Implements `TransportAdapter` (frozen in
`@resource-web/protocol/src/transport_adapter.ts`, D7) twice: `MatrixTransport`
(real, over a synapse homeserver via `matrix-bot-sdk`) and `MockTransport`
(deterministic, in-memory, for tests — the I5 swappability proof). This
package moves envelopes only; it contains no matching/policy/lifecycle logic
and does not import `agent-daemon`.

## 1. Wire format (Matrix)

Envelopes travel as ordinary `m.room.message` events, so any Matrix client
(Element, etc.) shows something readable in the timeline even without
understanding the custom `msgtype`:

```jsonc
{
  "msgtype": "app.resource-web.envelope",
  "body": "resource-web envelope: REQUEST",       // human-readable fallback
  "app.resource-web.envelope": "{\"v\":\"0.1\",\"type\":\"REQUEST\",...}" // serializeEnvelope() output, verbatim
}
```

`msgtype` and the content key intentionally share the same string — one
namespaced identifier for "this is a resource-web envelope," not two
independently-evolving constants (`packages/transport/src/wire.ts`).

**Sending** (`MatrixTransport.send`): `serializeEnvelope(env)` (from
`@resource-web/protocol` — never re-implemented here) produces the canonical
JSON string; it's placed under the content key above and sent via
`client.sendMessage(roomId, ...)`.

**Receiving**: the client's `"room.message"` event handler:
1. drops the client's own echoes (`event.sender === self`, resolved once via
   `client.getUserId()`, not trusted from `cfg.self` — the server is the
   source of truth for the canonical mxid);
2. ignores any event whose `msgtype` isn't `app.resource-web.envelope`
   (`extractEnvelopeWire`, `wire.ts`) — silently, since foreign messages in a
   DM room (a human typing "hi" in Element, say) are expected, not errors;
3. `parseEnvelope(wire)` on what's left. A parse failure (malformed JSON,
   unknown `type`, extra keys) is logged at **debug** level only and
   dropped — never info, and never the payload contents at any level above
   debug (metadata hygiene per task-m2t-brief.md).

## 2. Account provisioning

`packages/transport/src/matrix_provisioning.ts`. Synapse's admin
shared-secret registration flow (`/_synapse/admin/v1/register`):

1. `GET` the endpoint for a `nonce`.
2. HMAC-SHA1 `nonce\0username\0password\0notadmin` with the registration
   shared secret (`cfg.registration_secret`) → `mac`.
3. `POST { nonce, username, password, admin: false, mac }`. Success returns
   an `access_token` directly — no separate login step needed for a
   brand-new account.

**Idempotent re-run**: registering an already-existing localpart returns
`400 M_USER_IN_USE`. The fallback is a normal password login
(`MatrixAuth.passwordLogin`) using a password derived deterministically from
the same secret: `HMAC-SHA256(registration_secret, localpart)`. This
password is set at registration time and re-derived (never stored) at every
subsequent login, so the same function works on both paths and the
transport carries no persisted secret beyond `registration_secret` itself.

**Display name**: set post-provisioning via `client.setDisplayName`,
best-effort (a failure here is logged and swallowed — it's cosmetic, not
load-bearing).

## 3. One DM room per agent-pair (idempotent)

`MatrixTransport.send` calls `client.dms.getOrCreateDm(peer)` —
matrix-bot-sdk's own idempotent DM-room tracker, backed by `m.direct`
**account data on the homeserver**, not local process state. That's what
makes it idempotent *across restarts*, not just within one process's
lifetime: a fresh `MatrixTransport` instance calls `client.dms.update()`
once after `client.start()` (forcing a fetch of existing `m.direct` data)
before the first `send()`, so a restart never races an empty local cache
into creating a duplicate room for a pair that already has one.

Room creation (`preset: "trusted_private_chat"`, `is_direct: true`) invites
the peer; the **receiving** side auto-joins via `AutojoinRoomsMixin`
(accepts every invite unconditionally). That's an acceptable simplification
for v0's scope — a closed two-agent sim behind a private synapse instance —
not a production posture; gating invite-acceptance by trust-graph membership
is agent-daemon's policy layer, not transport's, per I5/no-protocol-logic-here.

## 4. `createSharedRoom`

Creates a room (`trusted_private_chat`), invites every peer, posts
`context.context_card` as a plain `m.text` message (not an envelope — this
is a human-readable summary, not machine-parsed), and returns
`{ room_id }`. Verified in the integration suite with an independent client
session (not the internal state of either transport instance) actually
reading the posted card back via the standard `GET .../rooms/{roomId}/messages`
API — i.e., "readable by both" is proven at the wire level, not assumed.

## 5. E2EE status: **[S3] — not shipped, platform-blocked, not a code gap**

The brief's 2-hour timebox assumed the risk was "does matrix-bot-sdk's
Rust crypto engine work cleanly." The actual finding is stronger and
took under 30 minutes to establish conclusively: **on this development
machine (macOS, darwin-arm64), `matrix-bot-sdk`'s native E2EE dependency
(`@matrix-org/matrix-sdk-crypto-nodejs`) cannot be imported at all** —
independent of whether E2EE is ever invoked:

- `matrix-bot-sdk`'s `e2ee/CryptoClient.js` and `e2ee/RustEngine.js` both do
  an **unconditional, top-level** `require("@matrix-org/matrix-sdk-crypto-nodejs")`,
  reached via `matrix-bot-sdk`'s own barrel `index.js`. So merely
  `import { MatrixClient } from "matrix-bot-sdk"` fails on this platform —
  not just constructing a client with a `RustSdkCryptoStorageProvider`.
- The native module has no npm-published prebuilt binary for darwin-arm64
  as an `optionalDependency` (confirmed: `@matrix-org/matrix-sdk-crypto-nodejs-darwin-arm64`
  and `-darwin-universal` both 404 from the npm registry). Its actual
  distribution mechanism is a `postinstall` script (`download-lib.js`) that
  fetches the binary from `github.com` release assets — a target this
  machine's outbound network policy does not reach (DNS resolution to
  `github.com` times out; `registry.npmjs.org` is reachable, confirmed by
  the successful `pnpm install` of every other dependency).
- Even setting that network limit aside, `pnpm` ignores the package's
  `postinstall` script by default (a supply-chain safety default, not
  something to override lightly), and doing so would require editing
  root-level config (`pnpm-workspace.yaml` / root `package.json`
  `onlyBuiltDependencies`) — outside this package's owned paths
  (`packages/transport/**`) and risking merge conflicts with the sibling
  `agent-daemon`/`device-ui` worktrees, per this sprint's worktree-isolation
  process.

**Fix shipped — probe, then patch only if needed**:
`packages/transport/src/matrix_crypto_stub.ts` first *attempts the real*
`require("@matrix-org/matrix-sdk-crypto-nodejs")` (via `createRequire`).
If that succeeds — a working native binary genuinely is present, on this
machine or a future one — the module stays exactly as Node's module cache
loaded it and **nothing further happens**: `Module._load` is left untouched,
every later `require` of that specifier (including from within
`matrix-bot-sdk`) resolves to the real, working module. Only if the probe
*throws* (no platform binary, corrupt file, etc. — the case on this
development machine today) does the code fall through to patch
`Module._load`, returning an empty object for that one specifier instead of
propagating the error. Installed as the first import in every file in this
package that touches `matrix-bot-sdk`. Safe on both paths, because nothing
at *module-evaluation* time in `CryptoClient.js`/`RustEngine.js` touches the
native module's exports — every reference is inside instance methods that
only execute if a `MatrixClient` is constructed **with** a
`RustSdkCryptoStorageProvider`, which `MatrixTransport` never does either
way. The stub is scoped entirely to this package's own source files (no
root config touched); `matrix_crypto_stub.test.ts` asserts the probe-then-
patch contract directly (idempotent, never throws either way, and documents
which branch this development machine currently takes).

**What this means for whoever picks up E2EE next**: the platform-availability
half of the problem now takes care of itself — drop this package onto a
machine/container where the native binary loads (a future darwin build,
linux-arm64, whatever), and the probe succeeds, the patch never installs,
and the real crypto engine is live with **zero code changes**. But E2EE is
still [S3] either way: `MatrixTransport` doesn't construct a
`RustSdkCryptoStorageProvider` or pass a `cryptoStore` to `MatrixClient`
today, so even where the binary loads cleanly, rooms stay unencrypted until
that wiring is added as its own piece of work. This file only removes
"binary can't load" as a reason encryption can't work — it doesn't implement
encryption.

**Net effect**: rooms are **unencrypted** in v0 (consistent with I7 — v0 is
already honestly labeled not-zero-knowledge; this is one more instance of
that same honest labeling, not a new privacy regression: envelope contents
were never claimed to be E2EE, and Matrix's own transport-layer TLS still
protects it in flight to the homeserver).

**For DECISIONS.md** (not edited directly here — worktree merge-conflict
risk per process; main-thread integrator should append): *E2EE deferred to
[S3], not for lack of an engineering timebox but because
`@matrix-org/matrix-sdk-crypto-nodejs` is architecturally unavailable on at
least one contributor's platform (darwin-arm64) under this project's
network policy — this is an environment/supply-chain constraint, not a
matrix-bot-sdk API gap. `matrix_crypto_stub.ts` ships a probe-then-patch
workaround (real binary wins if present; suppression only where it
genuinely can't load) so this stops being a per-machine landmine — but
`MatrixTransport` still never wires up a `RustSdkCryptoStorageProvider`, so
E2EE remains unimplemented (not merely unblocked) regardless of platform.
Revisit if/when: (a) LuLu/network policy is relaxed for `github.com`
release-asset fetches so `pnpm approve-builds` can run the vendor's own
downloader, or (b) a future `matrix-bot-sdk`/native-module release ships
darwin-arm64 via npm `optionalDependencies` directly — either way, the next
step is wiring `RustSdkCryptoStorageProvider` into `MatrixTransport.init`,
not just fixing binary availability.*

## 6. MockTransport

`packages/transport/src/mock_transport.ts`. A `MockBus` (shared per test
scenario) plus `MockTransport` instances (`new MockTransport(bus)`) that
register on `init({ self })`. `send` round-trips through the **same**
`serializeEnvelope`/`parseEnvelope` pair `MatrixTransport` uses — delivered
via a queued microtask (deterministic FIFO order, still asynchronous, so
tests must `await` a tick after `send()` rather than assume synchronous
delivery). `createSharedRoom` returns a bus-wide monotonic `room-<n>`
counter. This is what makes the Mock an actual proof of I5 swappability
rather than a same-object handoff that would prove nothing: both
`MockTransport` and `MatrixTransport` exercise the identical wire contract.

## 7. DIDComm swap notes (future, [S4] — prose only, no code)

v1's stated target ("Hosting model," DECISIONS.md D1.4: eventually one VPS
per user, agent-to-agent over a self-hosted mediator) points toward DIDComm
v2 as the eventual transport, replacing Matrix. The seam this package sits
behind (`TransportAdapter`) is already shaped for that swap:

- `TransportConfig.homeserver_url` becomes a DIDComm mediator endpoint;
  `access_token`/`registration_secret` become whatever the mediator's own
  provisioning scheme requires (DIDComm has no single standard analog —
  likely an out-of-band invitation + DID exchange, not a shared-secret HMAC).
- `PeerId` (currently a matrix user id string) becomes a `did:` URI. Nothing
  in `@resource-web/protocol`'s schemas assumes matrix-specific structure
  (`PeerIdSchema` is `z.string().min(1)`), so this swap doesn't touch the
  frozen v0.1 protocol contract at all.
- `send`/`onEnvelope` keep their shape: DIDComm messages are themselves
  JSON envelopes over an encrypted (by default, not optional like Matrix's
  E2EE) transport — `serializeEnvelope`'s output would become the DIDComm
  message's plaintext body rather than a Matrix event's custom content key.
- `createSharedRoom`'s "shared room + context card" concept doesn't map
  1:1 — DIDComm has no room primitive. The v1 equivalent is likely a small
  n-party thread (DIDComm's `thid`) with the context card as the thread's
  first message; this needs its own design pass at v1, not a mechanical
  swap, and is explicitly out of scope for this task.
- Nothing in `agent-daemon` should need to change beyond constructing a
  different `TransportConfig` and instantiating a different class — that's
  the whole point of I5, and is the reason `MockTransport` exists as a
  standing regression test for the seam rather than a one-off scaffold.

## 8. `infra/synapse/`

No new files added here. The sprint's local synapse (already running,
`docker-compose.yml`'s `synapse` service, `--profile local`,
`server_name: wot.local`, data volume at `infra/synapse/data/`) predates
this task and is shared live state read (not written) by every worktree
provisioning test accounts against it — see § 8.1 for why it wasn't touched.

### 8.1 Why this package didn't need to touch `infra/synapse/data/`

`infra/synapse/data/homeserver.yaml` is synapse's own generated config,
already running and already holding the effective registration shared
secret this task reads from `.env` (`MATRIX_REGISTRATION_SECRET`). It's
live, shared state: the `agent-daemon`/`device-ui` sibling worktrees
provision their own (`anna`/`ben`) accounts against the same instance.
Editing it, or restarting the container, would have broken their sessions
concurrently with this task's own work — so this task only ever reads it
(to confirm which of its three duplicate `registration_shared_secret` keys
is actually effective — YAML's last-key-wins — matching what `.env` holds)
and never writes to it.

## 9. Test accounts

Integration tests use localparts prefixed `test-<label>-<timestamp>-<random>`
(`test_support/live_synapse.ts: uniqueTestLocalpart`) — collision-free across
repeated runs, and clearly distinguishable from the demo's `anna`/`ben`
accounts on the shared synapse instance.

**Synapse's default `rc_login` rate limit** is easy to trip if the suite is
re-run many times back-to-back within a short window (observed during this
task's own development: after ~8 rapid re-runs, `passwordLogin` started
returning `M_LIMIT_EXCEEDED` with a multi-minute `retry_after_ms`). This is
synapse's own default login-attempt throttling, not a transport bug — each
test run only needs one deliberate `passwordLogin` call
(`matrix_provisioning.integration.test.ts`'s idempotent-fallback check, which
must exercise that code path to prove D3's idempotency claim) plus whatever
registrations it needs (registration isn't subject to `rc_login`). The
`createSharedRoom` integration test deliberately reuses an already-
authenticated session (`underlyingClientOf`, a test-only escape hatch into
MatrixTransport's private `client` field) rather than provisioning a second
verifier client, specifically to avoid adding an unnecessary second login
per run. If re-running the suite in a tight loop, expect occasional
`M_LIMIT_EXCEEDED` and just wait out the backoff — this is homeserver-side
throttling, orthogonal to whether the transport code itself is correct.

## 10. OpenVTC pillar — DIDComm-shaped transport (Task 11, D12)

`DidCommTransport` is a third `TransportAdapter` implementation (a sibling to
`MatrixTransport`/`MockTransport`, **not** a replacement — Matrix stays
drop-in and untouched). It is the project's primary communication pillar:
peer-to-peer, no homeserver, no mediator, no directory. Files:
`did_identity.ts`, `didcomm_crypto.ts`, `didcomm_transport.ts`, `vrc.ts`.

### 10.1 Identity — did:peer:2 (`did_identity.ts`)

`createIdentity(endpoint)` mints a `did:peer:2` encoding, inline, exactly three
elements in a fixed (deterministic) order:

- `.V<multibase>` — an **Ed25519** verification key (authentication / signatures)
- `.E<multibase>` — an **X25519** key-agreement key (ECDH encryption)
- `.S<base64url>` — a DIDCommMessaging service block `{"t":"dm","s":"<endpoint>","a":["didcomm/v2"]}`

`<multibase>` is base58btc-multibase over the multicodec-prefixed raw public
key (`0xed01` for Ed25519, `0xec01` for X25519) — the same `z6Mk…`/`z6LS…`
form `did:key` uses. `resolveDidPeer(did)` is a **pure, local** decode (no
network, no ledger). The service endpoint is this daemon's own
`http://<host>:<agentPort>/didcomm`.

### 10.2 Message security (`didcomm_crypto.ts`)

Sign-then-encrypt, so authorship is confidential:

1. Serialize the JWM-shaped message to exact bytes; **Ed25519-sign** those bytes.
2. Wrap `{ payload, sig, from: senderDid }` — the signature and the sender DID
   live **inside** what gets encrypted.
3. **X25519 ECDH-ES**: fresh ephemeral sender key × recipient static key-
   agreement key → shared secret → **HKDF-SHA256** (info binds alg + recipient
   DID + ephemeral pubkey) → 32-byte key.
4. **XChaCha20-Poly1305** AEAD with a fresh random 24-byte nonce (never reused),
   transmitted alongside the ciphertext.

On receipt: decrypt → resolve the sender DID's Ed25519 key → verify the
signature over the **exact transmitted bytes** → assert the signed message's
`from` equals that DID (**from-binding**). Any failure = drop + audit-log,
never a partial. Replay protection: a small in-memory window keyed on the
**signed** message id + `created_time` (reject duplicates, too-old, or
future-dated). The outer wire deliberately does **not** contain the sender DID.

### 10.3 Rooms

DIDComm has no native rooms. `createSharedRoom` mints a `uuid` and fans a
`ROOM_CREATE` control message to every member (so each peer's transport learns
membership); room chat then fans out member-to-member as encrypted
`room-message` JWMs. This mirrors agent-daemon's `RoomMessagingTransport`
extension **structurally** (duck-typed via `hasRoomMessaging`), so no
`agent-daemon` import is introduced.

### 10.4 VRCs (`vrc.ts`)

Each side can issue an Ed25519-signed, W3C-VC-shaped `RelationshipCredential`
about a peer DID. `verifyVrc` recovers the issuer key from its `did:peer:2` and
checks the signature over the canonical, proof-stripped credential, binding
`proof.verificationMethod` to the issuer.

**Issuance timing (alpha):** VRCs are issued **on demand at export time** from
the daemon's **current, non-expired** trust edges — they are **not** persisted,
and there is no issue-and-store step on trust-edge creation. (Storing on
creation would mean writing through `daemon.ts`/`store`, owned by other tasks;
issuing at export keeps this task's daemon footprint additive.) Served at
`GET /api/trust/export?format=vrc`.

### 10.5 HONEST LABELING (I7) — how this deviates from the RFCs

This is **DIDComm v2-SHAPED, not certified-interoperable**, and the VRCs are
**self-asserted pairwise**. It will **not** interoperate with a conformant
DIDComm agent or a conformant W3C-VC processor. Precise deviations:

- **Not JWE/JWM on the wire.** We use a bespoke compact JSON envelope
  (`{typ,alg,epk,nonce,ciphertext,to}`) and `alg:"ECDH-ES+XC20P"`, not the
  RFC's JWE JSON serialization, protected headers, or the DIDComm
  `application/didcomm-encrypted+json` media type. `type` values are
  `https://didcomm.org/resource-web/2.0/*` app URIs, not registered protocols.
- **did:peer:2 is shaped, not certified.** Element/purpose codes and multicodec
  key encoding are implemented and the encode↔decode round-trip is exact, but
  interop with other did:peer implementations is untested/unclaimed. Unknown
  purpose codes are ignored (forward-compat), and only the `V`/`E`/`S` set is emitted.
- **VRC proof is `Ed25519Signature2020`-shaped, not Data-Integrity.** We
  canonicalize by deterministic key-sorted JSON, **not** JSON-LD URDNA2015, and
  there is no `@context` dereferencing, no revocation/status list, no witness.
  A `verifyVrc → valid:true` means "this issuer really signed this", **not** "a
  witness attests the relationship". Keyring-wallet / OpenVTC witnessing is future work.
  VRCs are **issued on demand at export time** from current non-expired trust
  edges and **not persisted** — there is no issue-and-store on edge creation
  (see §10.4).
- **Replay window + secret storage are alpha-grade.** The dedup cache is
  in-memory and per-instance; identity secret keys are persisted as **plaintext**
  base64 JSON at `DID_IDENTITY_PATH` (file mode `0600`). A production build must
  move secrets into an OS keystore / encrypted wallet and persist the replay
  window. Key-material bytes are never logged.

### 10.6 Daemon wiring

`TRANSPORT=didcomm` (config: `DID_IDENTITY_PATH`, `DIDCOMM_HOST`) loads/creates
the identity, uses the **DID as the peer id** (a DID is a valid `PeerId`; no
schema change), and mounts — additively, without touching `daemon.ts` —
`POST /didcomm` (inbound) and `GET /api/trust/export?format=vrc` on the API
server. The meet-card payload (`getCardPayload(identity, display)`) gains
`did` + `endpoint`; wiring that into `/api/card` (Task 5) happens at integration.

## 11. Relay ingress authentication v2 and DID key rotation (2026-11-03)

Audit of the per-DID signature on `POST /relay/send` (PR #50, DECISIONS.md D-relay-send-auth), with the fixes that followed.
Code: `packages/transport/src/relay_send_auth.ts` (verifier + signer), `send_nonce_store.ts` (replay memory),
`did_key_records.ts` / `did_key_registry.ts` / `did_key_store.ts` (rotation, revocation, device keys), `relay_server.ts`
(`ingress()`, `keyRecord()`, drain auth), `relay_env.ts` (operator env). Browser port: `packages/browser-agent/src/relay_send_auth.ts`.

### 11.1 Threat model of the v1 scheme (what was found)

| # | Weakness | Consequence | Fix |
|---|---|---|---|
| F1 | Audience unbound | one captured request replays verbatim to every other relay (and the daemon's own `/relay/send` mount) inside the window | v2 signs the relay origin (`x-tw-relay-aud`); the relay checks it against `senderAuthAudiences` or the request `Host` |
| F2 | Nonce memory only in RAM | a relay restart reopens the whole ±window to replay | `SendNonceStore`: SQLite on the queue db by default (`relay_only.ts`) |
| F3 | Relay clock stepping back (NTP) | pruned nonces become valid again | prune against a monotonic high-water clock; freshness against the live clock |
| F4 | Client clock skew > 5 min | `401 stale` forever, no recovery | clients read the `Date` response header once and re-sign with the offset |
| F5 | No rotation / revocation | did:peer:2 *is* the key: a leaked key is forever, a DID can never move | signed key records (`rotate`, `revoke`), `POST /relay/keys`, consulted by send **and** drain auth; the successor drains the old DID's held mail |
| F6 | One root key on every device | losing a phone means losing the DID | per-device Ed25519 keys (`device_grant` / `device_revoke`, `x-tw-relay-kid`), expiring after one year (I9) |
| F7 | v1 accepted in `required` mode | audience-unbound signatures pass the strict mode | v1 only with `senderAuthAllowV1` (default: on in `optional`, off in `required`) → `401 legacy_signature` |
| F8 | relay_only header said "required (default)" | operators believed strict mode was on; the code default is `optional` | comment and env docs corrected; the default stays `optional` until every client signs |
| F9 | `apps/demo` client never signed | forces operators to keep `optional` | demo signs v2 |

Not fixed, by design or deferred: `optional` gives no sender authenticity (unsigned passes); anyone can mint DIDs, so per-DID caps
bound honest senders only (use `isAllowedSender` plus proxy rate limits); one Ed25519 verify per unauthenticated request (bounded
by the body cap); the relay learns the sender DID (D-relay-send-auth); a key leaked together with the owner's recovery is a race
(see FUTURE.md, pre-committed recovery key).

### 11.2 The v2 send signature

Headers: `x-tw-relay-did`, `x-tw-relay-kid` (optional device key, `z6Mk…`), `x-tw-relay-aud` (origin of the ingress URL, e.g.
`https://relay.example`), `x-tw-relay-ts`, `x-tw-relay-nonce`, `x-tw-relay-sig`. Signed bytes, UTF-8, newline separated:

```
trustweb-relay-send/v2
<did>
<kid or empty>
<aud>
<ts>
<nonce>
<hex(sha256(body))>
```

Verification order (fail closed, never throws): presence → shape → window (±5 min, live clock) → version (`aud` present = v2;
absent = v1, only with `allowV1`) → audience (configured list, else `URL(aud).host == Host`; the scheme is not compared because
TLS ends at the proxy) → key lookup (`SendKeyPolicy`: root key from the DID, or a granted device key from the registry) →
Ed25519 → replay memory (`(did, nonce)` once; 429 per-DID budget, 503 global budget; fails closed). Only a verified signature
touches the nonce store.

### 11.3 Key records (`POST /relay/keys`)

Self-authenticating JSON, signatures base64url, times in ms:

| type | signed input | signed by |
|---|---|---|
| `rotate` | `trustweb-did-rotate/v1 \n did \n successorDid \n at` | old root key (`sig`) **and** new root key (`successorSig`) |
| `revoke` | `trustweb-did-revoke/v1 \n did \n at` | root key |
| `device_grant` | `trustweb-did-device/v1 \n did \n kid \n at \n expiresAt` | root key (`sig`) **and** the device key (`kidSig`, proof of possession) |
| `device_revoke` | `trustweb-did-device-revoke/v1 \n did \n kid \n at` | root key |

Rules: `revoke` is terminal; a rotated DID accepts nothing further; the successor must be active, not the DID itself nor any
predecessor (no cycles); records dated more than the window into the future are refused; an older record than the stored
state is refused; the identical record again is idempotent. A rotation ends every device grant of the old DID; the successor
grants anew. Rotation and revocation apply to the drain handshake too: the old DID can no longer drain, the successor drains
the mail still queued under the old DID. Records are per relay: a peer publishes them to every relay it uses.

### 11.4 Operator settings

`RELAY_SENDER_AUTH` (required | optional | off; default **optional** during the transition), `RELAY_SENDER_AUTH_AUDIENCES`
(comma-separated origins; unset = derive from `Host`), `RELAY_SENDER_AUTH_ALLOW_V1` (true | false), `RELAY_KEY_REGISTRY`
(off to disable). Nonce memory and key records live in the queue db (`RELAY_QUEUE_DB`).
