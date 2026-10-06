TrustWeb CRM (apps/crm)  -  skeleton, 2026-10-06

A personal CRM over TrustWeb's own record: the people in your rings, their note lines, a timeline of when you
met someone and what happened since, follow-ups, and a pipeline over the lines tagged opportunity, looking or
offer. Local-first and phone-first like TrustWeb: no network call of any kind, nothing leaves the phone.

WHAT IT READS AND WRITES
  Reads   TrustWeb's record on the same origin (localStorage key trustweb.v1.me), read-only. Without one: an
          imported TrustWeb export (the decrypted backup payload, or a bare AppState as JSON), else the fictional
          sample set. The header line says which.
  Writes  Its own records only, key trustweb-crm.v1.<persona>: interactions, follow-ups, pipeline stages (keyed by
          TrustWeb NoteLine id), phone and email per person. Never TrustWeb's key (src/storage.ts says why).
  Model   src/model.ts adds Interaction, FollowUp, Stage, ContactPoint on top of apps/trustweb/src/model.ts, which
          is imported as types and not changed.

RUN (from this directory; the toolchain is project-local, node >= 20)
  /opt/homebrew/bin/npm install          once; installs into apps/crm/node_modules only
  npm run dev                            http://127.0.0.1:5195/
  npm run check                          svelte-check (type check)
  npm test                               unit tests (vitest, pure modules)
  npm run e2e                            headless Playwright smoke run, screenshots in test/e2e/shots/
  npm run build                          svelte-check, then dist/ with base /crm/ (CRM_BASE overrides)
  Browsers for the e2e come from the local Playwright cache (PLAYWRIGHT_BROWSERS_PATH); nothing is downloaded.

LAYOUT
  index.html, src/main.ts        mount the Svelte 5 app
  src/app.svelte                 shell: source line, import / forget, the four tabs
  src/people.svelte              search, sort, people grouped by ring (person_row.svelte per person)
  src/person.svelte              header, collapsed contact info (contact_info.svelte), notes, "just now" one-tap
                                 log (log_now.svelte), note-what-happened and remind-me forms, the person's
                                 timeline (event_row.svelte)
  src/timeline.svelte            everybody's events by day
  src/pipeline.svelte            kanban over opportunity / looking / offer lines (kanban_board.svelte: drag with a
                                 mouse, or the stage control on each card on a phone)
  src/followups.svelte           overdue / upcoming / finished
  src/state.svelte.ts            the one reactive store and every mutator; src/nav.svelte.ts where you are
  src/timeline.ts, contacts.ts   pure derivations (tested); src/storage.ts keys and import; src/sample.ts data
  src/strings.ts                 every user-facing string; ring, tag, audience and channel labels are TrustWeb's
  test/unit/*.test.ts            vitest; test/e2e/smoke.mjs the headless walk-through

TEMPLATE AND ATTRIBUTION
  Five components are adapted from 900CRM (900 Labs, Apache License 2.0): kanban_board.svelte, log_now.svelte,
  empty_state.svelte, person_row.svelte and the row shape and icons of event_row.svelte. Each file's header says
  so; the licence and the list of changes sit in third_party/900crm/LICENSE and third_party/900crm/NOTICE.txt.
  The rest is original and under the repository's licence.

NOT YET (open design points, see the result report in DEVLOG/trustweb-v3-plan)
  write-back into TrustWeb's record; editing or deleting a past interaction; a clear-CRM-records control; a backup
  of the CRM's own records (TrustWeb's E2E backup covers only its own key); mounting these screens inside TrustWeb
  as the Advanced view.
