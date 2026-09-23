# Result report: TrustWeb, URL consolidation and one merged demo app

Written 2026-09-23 (Sep-23), about 19:50 CEST. Handover: `DEVLOG/handover-trustweb-app.md`.

## Summary

- **`idea2.site/trustweb`** and its variants now 302 to **`https://app.idea2.site/trustweb/`**, which serves the new merged TrustWeb app. Grapevine no longer answers at `/trustweb`. It still serves at `/grapevine*` and `/applied-web-of-trust*`.
- **The acceptance test passes against the live deployment and the production relay**, 9 of 9:
  - An English motorbike ask brings up the holder's consent prompt.
  - An unrelated ask leaves the holder silent, and the asker sees "No match".
  - A decline also shows "No match".
- **Front-door pages:**
  - The Systems and Meta-curation cards are commented out.
  - The self-linking "App mockup" card is commented out and marked REMOVED.
  - A TrustWeb card was added.
  - This was done on all three server copies, each backed up first.
- **Tests:** apps/demo's vitest suite passes, 39 files and 436 tests (baseline 38 and 424; the 12 new tests are TrustWeb's). tsc is clean for apps/demo and apps/trustweb.
- **Commits** (local only, branch `demo-2026-08-31`; nothing pushed):
  - `e0177ea` the app
  - a follow-up commit for the voice probe and ring spacing
  - `hub: add the TrustWeb card`
  - this report

## Order of work

The URL came first, since funders may be clicking it:

1. An interim English holding page went up at `app.idea2.site/trustweb/`. It linked to `/wot/demo2/`.
2. The new route was verified.
3. Only then was idea2.site's `/trustweb` switched from Grapevine to the redirect.
4. The real app later replaced the holding page in the same directory, so no redirect ever pointed at a 404.

## What was built: `apps/trustweb`

| File | Role |
|---|---|
| `src/net.ts` | Network layer. It imports these apps/demo modules unchanged (not copied): `did.ts`, `crypto.ts` (did:peer:2 and the ECDH pair key), `relay.ts` (through `app.idea2.site/relay/*`), `connect_link.ts` (one-scan link and connect-ack), `match/lexical.ts`, `incoming_query.ts` (surface or stay silent) and `answer_key.ts`/`gate.ts` (a sealed, fixed-length answer; a decline and a no-match are the same bytes). DIDs stay in this layer: the rendered DOM contains no `did:peer` string on either phone (checked live). |
| `src/lexicon.ts` | Bilingual ask lexicon: English and German stopwords plus a small synonym table (motorbike/motorcycle/Motorrad, hiring/position, fund/funding, ...). `kThreshold` is the shared `DEFAULT_K` (3). Owner-declared lines pass through the existing B-08 bypass. There is no k=1 anywhere. |
| `src/model.ts` | Ring enum (close friend / friend / acquaintance), per-line Audience (Friends of friends / My friends / Only me), `threadsForRing()`. A line not shared with the asker's ring never reaches the matcher, so the asker gets the same sealed "nothing" as a genuine no-match. There is no parallel hide mechanism. |
| `src/notes.ts` | Keyword-rule line extraction and first-guess tags, on the device, with no AI. |
| `src/main.ts` | UI. Nav is Web, Inventory, Meet, Query. There is no chat, no Discover, no You and no badges. |
| `src/solo.ts` + `solo.html` | Solo-funder split view. |
| `src/speech.ts` | Voice, on-device only. |
| `src/store.ts` | Storage under `trustweb.v1.<persona>` keys. It never uses `wot.lang`, the `wot-demo` IndexedDB or `localStorage.clear()`. |
| `src/strings.ts` | All copy in one table. English only. |
| `src/seed.ts` | Seed data for the solo view. |
| `src/styles.css` | Styles ported from mobile-ui. |
| `vite.config.mjs`, `tsconfig.json` | Build config. apps/trustweb has no `node_modules` or `package.json` of its own, because `pnpm install` is gated on this machine. It is built with apps/demo's tsc and vite. Its unit tests live at `apps/demo/test/trustweb_match.test.ts` so they run in the existing suite. |
| `test/e2e/acceptance.mjs` | Browser acceptance test. By default it runs locally against a real RelayServer; with `TW_URL=...` it runs against live. |

### Screens

- **Meet, first tap:** a new note. It has who, where, the mic, the consent line (the exact mockup wording, "X agreed to a transcript. Audio stays on this phone and is deleted after the notes are made.") and the typed note.
- **Meet, second tap (on the note screen):** a QR sheet showing:
  - Ring: acquaintance (changeable later on their card)
  - Shared: just these notes, plus a small link to the app
  - Advanced settings: coming soon (disabled)
  - "No chat in this version"
- **Review:** editable lines with tag pills. A long-press on a line opens the tag picker (the label is also tappable). Picker options: Looking for, Can offer, Worth meeting, Opportunity, Talent, Resource, Note, or a custom label.
- **Place:** ring radio buttons, plus a per-line "who can ask" pill, and the mockup's footer "If someone asks and a note isn't shared with them, they see 'no match'."
- **Still true?:** reached from a person's card. Each line has Still true / Changed (edit inline) / No longer (struck through and removed from matching).
- **Web:** mobile-ui's ring view with three rings. It has the Rings/People toggle and person sheets (with Still true?, Add a note, Change ring).
- **Notifications card:**
  - Off by default.
  - It says plainly that a web page cannot see Do Not Disturb.
  - It says there are no unread counters.
  - If the user turns notifications on, an OS notification fires only while the tab is hidden.
- **Inventory ("What I have"):** a per-item audience and on/paused switch, plus the local log of asks (I6).
- **Query:** free text. Answers are held for a 30-second window, and "No match" uses the apps/demo `outNothingSub` wording.
- **Consent prompt:** appears over any screen, in mobile-ui's cosmic register. It asks each time; the copy says so.

### Timing (I3)

Every answer leaves the holder's device no earlier than `RELAY_DEADLINE_MS` (30 s) after the ask arrived, whether it matched or not and whether it was shared or declined. A holder who takes longer than 30 s is answered when they decide. The asker's screen says "Every answer is held for 30 seconds, so a 'no' looks exactly like 'no match'." Timing is not hidden from a network observer beyond that window (same honesty level as apps/demo).

### Two-phone path (verified live)

This was tested in two separate browser contexts:

1. Anna shows her QR.
2. Ben opens the QR URL and sees "Anna wants to connect ... also shared the notes".
3. Ben enters his name and connects.
4. Both get "Connected ... as an acquaintance".
5. Ben's copy of Anna's notes arrives as "Only me" lines.
6. Ben's ask to Anna returns "No match" after the window.

## Architecture decisions

- **Confirmed, from code:** the new app is based on apps/demo's logic, with mobile-ui's look ported on top. mobile-ui's live mode talks to an agent-daemon at `http://localhost:4101` (`runtime_config.js` DEFAULTS, `api_client_live.js`). There is no browser-only relay path, so it cannot answer a query standalone. **I verified this by reading the code, not by running it.** Running it would need a local agent-daemon, which the handover's premise already rules out for funders.
- **Chosen, solo-funder mechanism:** `solo.html` puts two iframes side by side.
  1. `?persona=holder` (Maya, seeded with the motorbike, notes for Examples A and B, and a spare room set to "Only me") posts its real connect link to the parent.
  2. The parent opens `?persona=seeker` (Jonas) on that link, exactly as a phone camera would.
  3. There are two storage records and two relay identities, and everything runs over the live relay. The acceptance test drives exactly this page.
  4. The start screen offers it as "See it work: two phones side by side". A reset link clears only those two personas.
- **Chosen:** a solo pairing uses the ring "friend", so Maya's "My friends" lines are reachable. A QR pairing between real phones uses "acquaintance", per the spec.
- **Chosen:** Friends of friends currently admits all three direct rings. The second hop (friends of friends proper) is not wired in this app; apps/demo's demo21 has it.
- **Assumption, nav order:** Web, Inventory, Meet, Query, with Meet as the raised centre button. It was inferred from the owner's 1/2/4/3 numbering and Image #5.
- **Assumption, tag vocabulary:** the mockup's Looking for / Can offer / Worth meeting plus the owner's opportunities / talent / resources / custom, plus a neutral "Note". I found no other owner-named set in the repo copy.
- **Chosen:** the hub card was added now (`apps/hub/index.html`, pushed to `app.idea2.site/wot/demo/`), not left for follow-up.

## License statement

- **notesnook:** its own repo (`streetwriters/notesnook`, GitHub license API and LICENSE file, checked today) is **GPL-3.0**, not AGPL. The handover guessed AGPL; the conclusion is the same.
  - **No notesnook code was imported, adapted or consulted.** Only the UX pattern described in the handover and the owner's mockup (a note editor with voice and tags) was mimicked.
  - This respects decisions.md R10 (no GPL code consumed).
- **Contradiction to flag:** the handover says "this repo's own standing rule is permissive licenses only, never AGPL". This repo's own `CLAUDE.md` says the repo **is AGPL-3.0-or-later** (the owner leads it). The binding rule applied here was R10, and the new files add no dependencies.

## Constraints check

- **k:** no `kThreshold: 1`. It uses `DEFAULT_K` plus B-08 (a unit test asserts `DEFAULT_K > 1`).
- **DIDs:** none appear in the UI (checked live on both phones).
- **Storage:** namespaced under `trustweb.v1.*`. A stale `wot.lang` cannot leak, because the app has no language state at all.
- **Absolute base:** `/trustweb/`. `app.idea2.site/trustweb` without the slash 308s to the slash form, and the Caddy guard follows the `/wot` precedent.
- **Copy:** no em dashes; the Manifund vocabulary is used for the three rings and "a decline looks exactly like no match". I did not have the full Manifund text; nothing under `grants/` duplicated it.

## Files changed

**Repo** (`Code/primary-repo`, branch `demo-2026-08-31`):
- `apps/trustweb/**` (new)
- `apps/demo/test/trustweb_match.test.ts` (new)
- `scripts/deploy_wot.sh`:
  - adds the `trustweb` target, `REMOTE_TRUSTWEB` and `TRUSTWEB_URLS`
  - adds `ONLY_TRUSTWEB=1` to deploy TrustWeb alone without re-pushing any `/wot/*` demo
  - a plain full run now includes TrustWeb
- `apps/hub/index.html` (TrustWeb card)
- `DEVLOG/handover-trustweb-app.md` (committed as given)
- this report

**Server** (questhub):
- `/etc/caddy/Caddyfile`:
  - Backups: `Caddyfile.bak.trustweb_pre_20260923_171416` and `Caddyfile.bak.trustweb_idea2_pre_20260923_171625`.
  - Each change was checked with `caddy validate` before `systemctl reload caddy`.
  - `app.idea2.site`: added `@trustweb_bare` 308 and `handle_path /trustweb/*` → `/srv/questhub-static/app-idea2-trustweb`.
  - `idea2.site`: replaced Grapevine's `handle_path /trustweb*` with `@trustweb_alias path /trustweb /trustweb/ /trustweb/* /trust-web /trust-web/ /trust-web/* /tw /tw/ /tw/*` → `redir https://app.idea2.site/trustweb/ temporary`.
  - Caddy path matching proved case-insensitive in practice (`/GRAPEVINE/` and `/TrustWeb` matched lowercase blocks), so one lowercase list covers `/TrustWeb`, `/Trust-Web` and `/TW`. Exact `/tw` paths are used, so `/twitter` still 404s.
- `/srv/questhub-static/app-idea2-trustweb/`: new directory, `chcon --reference=/srv/questhub-static/wot-app`, pushed by `deploy_wot.sh`.
- The three front-door files below. Each was backed up to `.bak.20260923_174444`, then the Systems and Meta-curation cards were commented out ("do not work yet; not cancelled"), the "App mockup" card was commented out and marked REMOVED (it linked to the page itself), a TrustWeb card was added and the "Five working surfaces" line was updated:
  - `/srv/questhub-static/idea2-web-of-trust/index.html`
  - `/srv/questhub-static/wot-home/index.html`
  - `/srv/questhub-static/evobiosys-org/web-of-trust/index.html` (not currently routed: `evobiosys.org/web-of-trust` 302s to idea2)
  - Verified in the page source on both live URLs; a headless render shows exactly 3 cards (Demo app, Interactive, Infrastructure).
- `/srv/questhub-static/app-idea2-wot/demo/index.html`: the hub, with backup `.bak.20260923_174600`.

## URLs, curl-verified after the last change

Every alias returns a first response of 302 (or 308 on app.) and ends in 200 at `https://app.idea2.site/trustweb/`:

| First response | Ends in 200 | URL |
|---|---|---|
| 302 | yes | `idea2.site/trustweb` |
| 302 | yes | `idea2.site/trustweb/` |
| 302 | yes | `idea2.site/tw` |
| 302 | yes | `idea2.site/tw/` |
| 302 | yes | `idea2.site/trust-web` |
| 302 | yes | `idea2.site/trust-web/` |
| 302 | yes | `idea2.site/Trust-Web` |
| 302 | yes | `idea2.site/Trust-Web/` |
| 302 | yes | `idea2.site/TrustWeb` |
| 302 | yes | `idea2.site/TrustWeb/` |
| 308 | yes | `app.idea2.site/trustweb` |
| 200 | - | `app.idea2.site/trustweb/` |
| 200 | - | `app.idea2.site/trustweb/solo.html` |

Regression sweep: 200 or the expected redirect for:
- `idea2.site`: `/grapevine/`, `/applied-web-of-trust/` (title "Grapevine ..."), `/web-of-trust/`, `/wot` (302), `/rebiosys` (302), `/wot-demo-draft/`, `/wot-demo/`, `/signal-orbit/`, `/unlocking-housing/`, `/`
- `app.idea2.site`: `/web-of-trust/`, `/wot/demo/`, `/wot/demo2/`, `/wot/demo21/`, `/wot/app/`, `/web-of-trust/demos/`
- `evobiosys.org`: `/web-of-trust/` (302), `/rebiosys/`

`POST app.idea2.site/relay/send` returned 202.

## Evidence and commands

- Unit and suite: `cd apps/demo && npx vitest run` gives 39 files and 436 tests passed.
- Types: `cd apps/trustweb && ../demo/node_modules/.bin/tsc --noEmit -p tsconfig.json` is clean. apps/demo tsc is clean.
- Browser acceptance, locally and against live (all pass; about 2 minutes, mostly the three 30-second windows). Run from `apps/demo/`:
  ```
  PLAYWRIGHT_PACKAGE=/Users/personal/Documents/SingularStructure/code/other/signal-orbit/node_modules/playwright-core/index.js \
    [TW_URL=https://app.idea2.site/trustweb/] npx tsx ../trustweb/test/e2e/acceptance.mjs
  ```
- Deploy TrustWeb alone: `ONLY_TRUSTWEB=1 ./scripts/deploy_wot.sh`, which ends with "all good".

## Not finished, not verified, or open

1. **Voice is real only where the browser does on-device recognition.** It uses `SpeechRecognition` with `processLocally` (Chromium's on-device mode). Elsewhere the mic is disabled and the screen says why; typing always works.
   - I could not test real dictation: headless has no microphone.
   - `SpeechRecognition.available()` **crashed the renderer in headless Chromium 153**, so it is now called only when someone taps the mic, never on render. ⚠️ Whether it also crashes real Chrome on some devices is unverified; if it does, only that tap is affected.
   - Safari/iOS will show "mic off" (no `available()` API). Please check on a real phone.
2. **The notes from a QR travel inside the QR URL** (the first 300 characters, as the `n` parameter). They are therefore visible to anyone who sees or photographs the code, and to the server log of the page load. A relay-delivered, encrypted version is the proper fix. Flagging it rather than calling it private.
3. **No second hop** (friends of friends proper) in this app, and no chat, by design.
4. **The Drive images were readable, and they are PNGs, not videos:** `trustweb-note-taking-mockup.png`, `trustweb-example-a.png`, `trustweb-example-b.png`. They were read via the Drive connector and used for the notes flow and the solo seed content (Examples A and B).
5. The nav order and tag vocabulary are assumptions (see above).
6. **`/etc/caddy/Caddyfile.candidate` (Sep 12) sits next to the live file.** It does not contain today's TrustWeb routes. If anyone swaps it in, `/trustweb` goes back to Grapevine or 404s.
7. **The pnpm workspace does not know about apps/trustweb** (no `package.json`, on purpose, see above). If the owner wants it as a proper workspace package, that takes one `pnpm install` to update the lockfile.
8. **The interim holding page is gone** (the `rm` in `push_dir` replaced it). Its source was only in the scratchpad.
9. **Real two-phone run:** only a human can do it. The two-browser live run is the closest proxy, and it passed.
10. **The idea2 front door still describes Rebiosys as "The resource-sharing layer Web of Trust queries run against"**, while the hub now calls it "an earlier use case". I left it untouched because it is outside this handover.

Handback: "trustweb-app done. Result at DEVLOG/result-report-trustweb-app.md. Resume: verify URLs live and report open items."
