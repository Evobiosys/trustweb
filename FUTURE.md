# FUTURE.md — temptations deliberately not built (§12)

- Chat-platform bridges (WhatsApp/Signal/Telegram)
- Real NFC / QR onboarding beyond [S2]
- Reputation scores, token economics
- Multi-hop beyond one relay
- Mobile packaging
- Real ZK circuits (v1 target — Markus owns crypto review, DECISIONS.md D1.3/D2)
- Federation with OpenVTC networks
- Exclusion cascade as *group* governance — per Jakob (D1.5) exclusion stays individual: I downgrade a peer in my own trust graph, no appeals, no notification. Protocol only records `vouched_by` to keep collective mechanisms possible later.

- ~~Per-item SharePolicy editor driven by AppProfile.defaultPolicy~~ — landed as the permission-gating split-button + matrix, D21 (gating-ui branch): `createDefaultPolicy()` reads `AppProfile.defaultPolicy` as a seed. What's still open: (1) no `/api/policy` REST route or live daemon round-trip — the UI is local-first (localStorage) today; (2) the matrix's "once" cell state has no enforcement wiring in `daemon/listings.ts` — it's a settable standing default with no one-shot-then-revert behavior at publish/broadcast time yet.
- WhatsApp/Signal bridge onboarding: user chats in a bridged WhatsApp group with their private agent (no app install; Tana 2026-07-17). Requires Matrix path + bridge configs on matrix.myceli.al. Steward already speaks message-events.
- NFC handshake (Anton: QR "cannot just be pointed at"); web alpha ships QR + manual code.
- **Animated ("moving") QR as a liveness proof** (Jakob, 2026-09-03 — deferred, not for the Sept demo). The still QR can be screenshotted and forwarded, so it proves nothing about co-presence. A code whose frames rotate a nonce several times a second, where the answering device must echo the nonce belonging to the frame it actually saw within a tight deadline, cannot be relayed over any network without blowing the deadline — the latency budget IS the proof. Shape of the work: (1) `QueryEnvelope` already carries `qid` + `issuedAt` (`apps/demo/src/types.ts`), so the nonce seam exists; add a per-frame counter + short expiry. (2) `apps/demo/src/ui/qr.ts` renders one static canvas — needs a frame loop re-encoding on an interval. (3) `apps/demo/src/ui/scanner.ts` calls `stop()` on the FIRST successful decode — it must instead accumulate frames, keep the freshest valid nonce, and report round-trip time. (4) The paste fallback cannot carry a live code, so the copy/paste escape hatch stops being equivalent — a product decision, not just code. Budget: it is a real change across three files plus a timing model, not a tweak.
- holons.io-style dashboard beyond the Web-rings tab (reference/holons).
- Second-degree borrow via via-chain (alpha: direct-connection borrow only; relay/ask flow covers FoaF discovery).
- In-app offer/gathering composer — v0.1 creates listings via REST/steward text only; a first-class compose-and-preview UI (with the per-item policy/tier picker above) is deferred (D17 stub).
- `TRANSPORT=matrix` wiring into `agent-daemon/src/main.ts` + WhatsApp/Signal bridge onboarding on matrix.myceli.al — the transport and Synapse profile exist in-tree but the factory throws on `matrix` today (D17 stub, D12 vision).
- Persist signed VRC trust credentials — v0.1 issues them on-demand at `/api/trust` export, not stored (D17 stub).
- Publish the iroh address (node id + relay URLs) in the `did:peer:2` service entry / contact card, so `resolvePeer` needs no out-of-band config (D-iroh-live).
- Build `trustweb-iroh-sidecar` in CI and run `iroh_sidecar.integration.test.ts` there instead of skipping (D-iroh-live).
- Relay allowlists / per-operator access policy for community iroh relays (who may connect; iroh-relay access config, ⚠️ unverified) (D-iroh-live).

## Next-phase research tracks (decision inputs — `docs/research/*.md`, untracked, NOT shipping docs)

Three alignment/architecture notes were written ahead of v0.1's next phase. They are decision inputs for Jakob, each ending in an explicit ❗ decision block — surfaced here so the calls do not get lost:

- **`docs/research/ad4m-fit.md`** — does AD4M (coasys/ad4m) fit, and is a non-Holochain path real. ❗ Jakob to decide: (1) is any AD4M/Flux interop actually wanted or just intellectual alignment (lean: keep as reference / backlog only); (2) if a graph export is greenlit, is it post-consent-data-only (lean: yes — anything else needs a Markus privacy review); (3) does OpenVTC (D12) have a formal relationship to AD4M's VC-shaped credentials or is the resemblance convergent (lean: ask Jakob directly). ⚠️ note: the non-Holochain Link-Language ecosystem it relies on is suspiciously fresh (many repos pushed in one 2-day window) — treat "production-ready" claims as unverified.
- **`docs/research/storage-kidur-semantic.md`** — make storage work "in the kidur.org core / semantic manner." ❗ Jakob to confirm the interpretation of "kidur core" (his own EvoBioSys project, tier-C self-published, confidence 0.7) before it drives design; the `Store` seam (I5) needs nothing today. Open ❗ design calls: per-field visibility (`policy.audience` is item-level today) and open vs. fixed node types (closed additive enum today vs. Tana-style user-defined supertags) — both protocol/policy-layer decisions, not storage-engine ones.
- **`docs/research/solo-graph-extension.md`** — hold data ABOUT contacts who have no accounts (local-only `Contact`, peer-less until an edge is minted). Its §5 `forwardRelay` connected-only guard already landed as D16. ❗ Jakob to decide the `Contact` id namespace convention (`local:<uuid>` vs. another prefix) — not urgent, but names the pre-seam D16 already assumes.
- **CONNECT abuse-hardening (D18, Task 4).** The consent-gated inbound CONNECT ships one guard: at most one pending inbound connect card per requester DID (dedupe/refresh). Deferred deeper hardening — a per-origin cross-requester flood cap (an unknown-peer swarm each with a distinct DID still mints one card apiece), outbound-record dedupe on repeated `sendConnect` to the same origin, a short-circuit when a live edge to the requester already exists, and honouring the CONNECT body's `relay` routing hint on a real (non-in-memory) transport. None weakens an invariant; they narrow surface area for a spam/DoS actor and complete real-transport routing.
- `trustweb` CLI (D-cli) temptations, not done: custom zone names beyond the ladder; a `sync` that pushes the record into the app's
  device sync; tag-scoped field sets; an OpenFGA/SpiceDB export of the effective store (the adapter stubs in tuples.ts); a `--watch`
  that re-renders `show` as the record changes; shell completion.
