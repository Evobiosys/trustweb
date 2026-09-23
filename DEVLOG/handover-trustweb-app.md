# Handover: TrustWeb — URL consolidation + one merged demo app

Owner: Jakob. Written 2026-09-23 ~18:40 CEST. Urgency: the Manifund application
("TrustWeb: Amplifying the Power of Weak Ties") is **already submitted** and its
"Try our demo" line points at `idea2.site/trustweb`. Funders may click it any time.
Get *something* correct and live at that URL before doing the deeper app work.

Output path for your result report: `DEVLOG/result-report-trustweb-app.md` in this repo.

Handback prompt (paste this back to the orchestrating session when done):
`"trustweb-app done. Result at DEVLOG/result-report-trustweb-app.md. Resume: verify URLs live and report open items."`

## Read first

- `decisions.md` (repo root or `web-of-trust/` parent — locate it, it's the rulings ledger).
- `../../HANDOVER-CTO-implementation_2026-09-22.txt` and `../../HANDOVER-claude-desktop_2026-09-22.md` (in the `web-of-trust/` project dir, two levels up from this repo).
- `scripts/deploy_wot.sh` — the existing deploy pattern (base-URL builds, push, chcon, verify). Extend it, don't replace it.
- `apps/demo/src/i18n.ts` — the two-language string table (German source, English toggle). Read the WHOLE file for pattern.
- `apps/mobile-ui/src/nav.js`, `screens/meet.js`, `screens/web.js`, `screens/host.js` — current mobile-ui screens.
- `apps/demo/src/main.ts`, `apps/demo/src/data/templates.ts` — the working relay/consent logic and its German-only match lexicon.
- `apps/demo/test/e2e/motorrad_notification_browser.mjs` — read its full header comment. It documents that the "Motorrad" consent-flow demo (what the owner calls the "motorbike" demo, and what he wants shown at `idea2.site/trustweb`) is NOT a separate scenario — it's `apps/demo` in relay mode, with the holder listing "Motorrad" ("Was ich habe" / "What I have") and the seeker asking free-text via "Ins Netzwerk rufen" ("Call into the web"). This is already-working, already-tested logic. Do not build a new consent mechanism; reuse this one.
- Check the `cto-wot` skill before hand-rolling a build plan — it may already cover this kind of WoT build work.

## Context already gathered this session (trust it, but verify before acting)

**URL state as of 2026-09-23 18:30 CEST**, checked with `curl`:
- `idea2.site/trustweb`, `/trustweb/`, `/TrustWeb`, `/TrustWeb/` → 200, serving **Grapevine** ("Grapevine — your people, your data, one file"). Confirmed in `/etc/caddy/Caddyfile` on `questhub`:
  ```
  handle_path /applied-web-of-trust* {
      root * /srv/questhub-static/grapevine
      file_server
  }
  handle_path /trustweb* {
      root * /srv/questhub-static/grapevine
      file_server
  }
  ```
  Grapevine already has a working alias at `/applied-web-of-trust*` pointing at the same directory. **The owner has explicitly authorized freeing `/trustweb` for the new TrustWeb app and moving Grapevine off it** — this is not a destructive move of Grapevine's actual files, just removing the redundant `/trustweb*` `handle_path` block (Grapevine keeps serving fine from `/applied-web-of-trust*` and whatever else already points at `/srv/questhub-static/grapevine`). Before removing it: `grep -rn "idea2.site/trustweb\|idea2\.site/trustweb" ~/Documents/SingularStructure` for anything besides Grapevine's own docs that might depend on the old `/trustweb` path pointing at Grapevine, and flag if you find any external references (pitch decks, other applications) — don't silently break a link someone else is relying on.
- `idea2.site/tw`, `/tw/`, `/trust-web`, `/trust-web/`, `/Trust-Web`, `/Trust-Web/` → 404. Free.
- `app.idea2.site/trustweb`, `/trustweb/` → 404. Free — this is where the owner's latest message says the actual app copy should live.

**Existing URL architecture** (`/etc/caddy/Caddyfile` on questhub, site blocks start at `idea2.site, www.idea2.site {` line ~425 and `app.idea2.site {` line ~753 — re-read live, line numbers will have shifted after your edits):
- `idea2.site/web-of-trust/` is "the front door" — real content, served from `/srv/questhub-static/idea2-web-of-trust`.
- `idea2.site/wot` → 302 redirect to `/web-of-trust/`.
- `app.idea2.site/web-of-trust/` → served from `/srv/questhub-static/wot-home` (a near-duplicate of the front door, "copied not moved" per an existing Caddyfile comment).
- `app.idea2.site/wot/*` → served from `/srv/questhub-static/app-idea2-wot` (this is `deploy_wot.sh`'s target — demo1-6, demo21, app, demo).
- `evobiosys.org/web-of-trust/` also has its own separate copy at `/srv/questhub-static/evobiosys-org/web-of-trust/`.
- There is prior precedent for "keep the old path as a redirect to the new canonical one" (see the 2026-09-03 round-2 restructure comments throughout the Caddyfile) — follow that pattern for `/trustweb` and its aliases rather than inventing a new one.

**The "Systems / Meta-curation" cards the owner wants commented out** (his Image #1/#2: "SYSTEMS PAGE · Designed deep dive... systems/web-of-trust ↗" and "META-CURATION · Self-empowering discovery... meta-curation ↗") exist verbatim (grep confirmed) in THREE files:
- `/srv/questhub-static/evobiosys-org/web-of-trust/index.html`
- `/srv/questhub-static/idea2-web-of-trust/index.html`
- `/srv/questhub-static/wot-home/index.html`
These are server-only files, not in this git repo. `.bak.<timestamp>` copies already exist for some of them from prior edits — follow that same backup convention (`cp file file.bak.$(date +%Y%m%d_%H%M%S)`) before touching any of them. The owner also said (Image #1) the "App mockup" card on one of these pages links to "the website" itself and is wrong/redundant — remove that specific self-referencing card. Comment out (HTML comment), don't delete, the Systems and Meta-curation cards — they "don't work yet," not "are cancelled."

**The Grapevine card mentioned by the owner** — separately, on the WoT hub page (`apps/hub/index.html`, this repo, already fixed and deployed this session) the Rebiosys card is now tagged "an earlier use case". No action needed there, just context.

## What's already done (this session, before this handover)

- `apps/hub/index.html` (→ `app.idea2.site/wot/demo/`): fully translated to English, `lang="en"`, "Web of Trust" → "TrustWeb" in visible copy, removed the false "not linked from the homepage" claim, Rebiosys tagged "an earlier use case". Committed (`hub: translate demo listing to English, rename to TrustWeb, fix stale copy`) and deployed via `deploy_wot.sh`. Verify it's still live and correct as your first step.
- Investigated flipping `apps/demo`'s i18n default to English — **reverted**. The live "type something, watch it match" demo depends on a German-only keyword lexicon (`data/templates.ts`: `wohnung frei`, `wird frei`, etc.) with no English equivalent; flipping the UI default broke `test/inventory_match.test.ts`. `apps/demo` currently still defaults to German with a manual English toggle (`wot.lang` in localStorage). **Your new app must not repeat this mistake** — see the acceptance test below.

## The build: one merged app at `app.idea2.site/trustweb`

The owner wants ONE demo app to show, combining:
1. **The working consent-flow ("Motorrad") logic from `apps/demo`** (relay mode: holder lists an item, seeker asks free-text, consent prompt appears on match, silence on no-match). This is the substance — it must actually work standalone for one demoer showing it to a funder, not require a second LAN-connected agent device unless the demo design intentionally uses two phones/tabs (see "solo funder" below).
2. **The visual "Web" screen and nav chrome from `apps/mobile-ui`** (Image #5: the ring/graph view showing connections, "Rings"/"People" toggle, bottom nav). The owner explicitly likes this look over the apps/demo screens.
3. **A new notes-taking flow** (Image #7, described below) replacing the "Meet" ceremony screen's current content.

**Architecture decision, made for you** (confirm, don't re-litigate unless you find a blocker): `apps/mobile-ui` needs live agents on the same network to actually answer a query — per this repo's own hub-page copy, without them "it stays a click-through interface." `apps/demo` (relay mode) is the one with a real, tested, standalone-working consent flow against `questhub.eco`'s live relay. **Base the new app on `apps/demo`'s working logic, and port `apps/mobile-ui`'s visual "Web" screen and nav chrome onto it — not the reverse.** If your own investigation finds mobile-ui CAN run the relay flow standalone (check `apps/mobile-ui/src/api_client_live.js` and `runtime_config.js`), say so in your report and adjust, but verify with a real run, not by reading code alone.

### Nav (bottom bar), per the owner's latest messages + Image #5/#6

Four items: **Web | Inventory | Meet | Query**. (Ordering inferred from the owner's own numbering 1/2/4/3 in his message — he said "1) the web, 2) personal inventory, 4) a meet button... 3) a query tab"; the numbers don't sort cleanly, so this ordering — Web, Inventory, Meet, Query, with Meet as the center/highlighted button as in Image #5's mockup — is an assumption. State it as such in your report.)

- Remove Chat, Discover, You entirely, and **remove all notification badges** (the red "1" bubble on Chat in Image #5). The owner's own words: "importantly, remove the bubble of how many messages one has, one has to go there or check notifications for that — default off during dnd." A web app cannot read OS Focus/DND state — ship notifications **off by default** and say so explicitly in the UI copy (don't silently claim DND-awareness you can't implement).
- **Meet button, tap 1**: opens a blank notes editor (see below).
- **Meet button, tap 2** (i.e., tapping the same nav position again while the notes/meet screen is already open): shows a QR code with these defaults:
  - Ring: **acquaintance** (changeable later, e.g. in the note's own per-note ring picker — see Image #7 step 3).
  - What's shared: **just the notes, plus a minor/small link to the app** (this is the default; do not share more).
  - **Advanced settings: "coming soon"** — show the entry point, disabled/greyed, no functionality behind it yet.
  - **No chat.** Don't wire up messaging in this build.

### Notes flow (Image #7 — read the image directly, this is a text approximation)

Four-step flow, "Taking notes after meeting someone":
1. **New note**: right after a conversation, speak (voice, transcribed on-device, consent-gated — "X agreed to a transcript. Audio stays on this phone and is deleted after the notes are made") or type free text about the person just met.
2. **Review**: the app extracts structured lines from the note under labels like "LOOKING FOR", "CAN OFFER", "WORTH MEETING" — editable. The owner separately described this as long-press-to-tag: "the lines of the notes can be long pressed to identify them as opportunities, talent, or resources, or custom." Implement the long-press tagging (opportunities / talent / resources / custom) as the mechanism; the LOOKING FOR / CAN OFFER / WORTH MEETING labels in the mockup are one possible label set — use them as the default tag vocabulary unless you find the owner already named different ones elsewhere in this repo's copy.
3. **Place in a ring**: choose close friend / friend / acquaintance for this person, and independently choose, per note-line, who can ask about it (e.g. "Friends of friends", "My friends", "Only me"). The screen explicitly states: "If someone asks and a note isn't shared with them, they see 'no match'." This is the SAME silence-on-decline principle already implemented in `apps/demo` — reuse that mechanism (the "outcome" screen's `outNothing`/`outNothingSub` strings and the underlying gate logic that makes a decline indistinguishable from nothing-found), don't build a parallel one.
4. **Update over time**: a later screen ("Still true?") resurfaces old notes about a person with "Still true" / "Changed" / "No longer" buttons per line, so information decays gracefully rather than going stale silently.

Voice transcription: if you can wire real on-device speech-to-text (e.g. Web Speech API) in the time available, do it with the exact consent copy from the mockup ("agreed to a transcript... audio stays on this phone and is deleted after the notes are made"). If not, ship the typed-note path only and mark voice as a stub — don't fake a working mic that silently does nothing.

### Constraints, all load-bearing

- **License**: "notesnook" (the app the owner referenced as UX inspiration) is copyleft (AGPL — confirm the exact license in its own repo before you finalize this claim, but do not import any of its code either way). This repo's own standing rule is permissive licenses only, never AGPL. **Mimic the notesnook UX you were shown (the note-editor-with-voice-and-tags pattern) without importing or adapting any notesnook source.** State this explicitly in your result report.
- **DIDs**: the relay uses `did:peer` addressing under the hood — keep that in the transport layer, never surface a raw DID string in the UI copy. The owner: "this copy of the demo for this new submission doesn't have to have all of the DIDs etc."
- **English-by-default, without repeating this session's mistake**: since this is a new, separate build (not editing `apps/demo`'s shared i18n table), you can default it to English cleanly — but you MUST keep the match/query lexicon in sync with whatever language the demo actually runs in. Write your own match terms in English from the start (don't copy `data/templates.ts`'s German `matchTerms` verbatim), or make the lexicon bilingual. **Acceptance test, must pass before you call this done**: an English inventory/note item like "motorbike" plus an English free-text query for it makes the holder's consent prompt appear; an unrelated English query leaves the holder silent (no prompt, matches the existing `outNothing` behavior). Check `apps/demo/src/match/kanon.ts` (or wherever `match_kanon` lives — grep for it) for existing text-canonicalization helpers before writing new matching code.
- **k-threshold**: `kThreshold: 1` is explicitly banned from shipping (see `C-03` comments throughout `apps/demo/src/data/templates.ts` — "must not ship"). Use `DEFAULT_K` (3) or the existing owner-declared-entry bypass (`B-08`, the same mechanism `apps/demo`'s inventory-only matches already use) for a single demoer's own seeded data. Do not hardcode a demo-only k=1 crutch in the new app.
- **Storage namespacing**: this app will share the `app.idea2.site` origin with the existing `/wot/*` apps. Namespace your `localStorage`/`IndexedDB` keys distinctly (don't reuse `wot.lang` or other existing keys) — a stale `wot.lang='de'` from a visitor's earlier `/wot/demo1/` visit must not leak into this app's language state.
- **Solo-funder path**: a single presenter on one laptop can't physically play both "holder" and "seeker," and two browser tabs on the same machine share one storage identity (so they'd share notes/state, breaking the two-persona demo). You must ship a way for one person to demo this alone — e.g. a split-view showing both personas' screens side by side, or a simulated second persona driven by seeded data. Decide and document your choice.
- **Copy voice**: reuse the Manifund application's own vocabulary where it overlaps ("the three rings", "a decline looks exactly like no match", "close friends, friends, acquaintances") rather than inventing new phrasing — the full application text is in this session's conversation; ask the orchestrating session for it if you need the exact wording and it isn't already duplicated somewhere in this repo's `grants/` or `web-of-trust/grants/` directories (check there first).

### Mockup video (Google Drive)

The owner referenced `https://drive.google.com/file/d/1ZDm1DH4Q1UAGGO1XqnIosfeCAW9_YXzb/view` (the notes-flow mockup — now superseded by the still image already described above, which you should trust) and two more: Example A (`1AbEYOETxEgpxpTf_9FBz4eU-qlvNOHCw`) and Example B (`1H3xHwuidJWFoERoWwabQHJeKk9vEwZFA`). Google Drive MCP tools are available in this environment (`mcp__claude_ai_Google_Drive__*`) — try `get_file_metadata`/`download_file_content` on these IDs. If they're videos, extract a few frames (`ffmpeg`) and read them as images. If the connector fails or access is denied, don't guess at their content — flag it as an open item in your report rather than inventing UI you haven't seen. The Image #7 description above should be sufficient for the notes flow regardless.

## Build and deploy

- New Vite app (or a mode/build variant of `apps/demo` — your call, but keep it a genuinely separate deployable target, not a `VITE_WOT_MODE` flag bolted onto the existing demo1-6 family, since its nav/screens are substantially different).
- Absolute base `/trustweb/` (see `deploy_wot.sh`'s own comment on why relative bases break: opening without a trailing slash 404s every asset and renders a black rectangle — this has happened before, don't repeat it).
- New server directory under `/srv/questhub-static/` needs `chcon --reference=$REF` copied from a working sibling, exactly like `deploy_wot.sh`'s `push_dir`/`push_page` helpers already do — reuse those functions, don't hand-roll new ones.
- Add a `trustweb` block to `scripts/deploy_wot.sh` (build + push), and add its verify-URL(s) to the script's `verify_urls` array.
- Caddy, on `idea2.site` (root): remove the `/trustweb*` → Grapevine `handle_path` block; add `/trustweb*` (and case/hyphen variants `/tw*`, `/trust-web*`, `/Trust-Web*`, `/TrustWeb*` — Caddy paths are case-sensitive, use one `(?i)` regexp matcher or explicit entries per the existing repo's own prior-art for this exact problem, e.g. how `/wot`/`/WOT` or similar was handled elsewhere if you find precedent) all redirecting to `https://app.idea2.site/trustweb/`. Back up the Caddyfile first (`cp`), run `caddy validate` before reloading, and confirm existing routes (`/web-of-trust`, `/wot`, `/rebiosys`, etc.) still resolve afterward — a full sweep, not just the paths you touched.
- After deploying, update `apps/hub/index.html` (already-English, this repo) to add a TrustWeb card pointing at the new app, OR leave that for a follow-up — your call, note which you chose.

## Verification before you report done

- `curl -sI` every one of: `idea2.site/trustweb`, `/trustweb/`, `/tw`, `/tw/`, `/trust-web`, `/trust-web/`, `/Trust-Web`, `/Trust-Web/`, `/TrustWeb`, `/TrustWeb/`, `app.idea2.site/trustweb`, `/trustweb/` — all should 200 or redirect cleanly to the live app, none should 404 or serve Grapevine.
- Confirm Grapevine still resolves at `/applied-web-of-trust*` (and anywhere else it's mounted) after you remove its `/trustweb*` alias.
- Run the acceptance test above (English motorbike-equivalent item, matches; unrelated query, silent) against the live deployed app, not just in a local dev server.
- Run this repo's full test suite (`cd apps/demo && npx vitest run`, plus whatever test command your new app/directory has) — all green, no regressions to the existing demo1-6/21 family.
- Confirm the Systems/Meta-curation cards are visibly commented out (view-source, not just "should be") on all three server files you touched, and that backups exist.

## Report format

Write `DEVLOG/result-report-trustweb-app.md`: what you built, every file changed (repo + server-side), every URL now live with its curl-verified status, the architecture decisions you made (and which were assumptions vs. confirmed), the AGPL/notesnook statement, the solo-funder demo mechanism you chose, and a clearly labeled list of anything you could not finish or verify (Drive video access, exact nav ordering, label vocabulary, etc.) rather than silently guessing past them.
