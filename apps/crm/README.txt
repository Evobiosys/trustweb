Web Curator (apps/crm, was TrustWeb CRM)  -  skeleton, 2026-10-06

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

DEV RECORD (dev server only; a build ignores it)
  TW_CRM_RECORD=<path to an AppState json> npm run dev   loads that file as the record instead of the sample set; the
                                 header says "Tana persons (n)". Convert a Tana #person export first:
  node scripts/tana_persons_to_record.mjs <persons-index.json> <persons-nodes.json> <out.json> [person-schema.md]
                                 per person: name, one note line per field / child bullet, met date = node created,
                                 id tana-<node id>, "Google Calendar Contacts" kept as a tag; file-only, no network.
                                 Keep the output outside the repo (private data). Next to the nodes file it also reads
                                 workspaces.json and environment-*.json/-schema.md (record.environments).
                                 Rings are derived once (a ring: line in Tana wins): personal connection -> friend; a desire "intending to connect (0-10)"
                                 of 1 or more with no closer ring -> intending to connect (reads the number + "intending since"; the old
                                 checkbox is ignored); else unsorted. Family is a tag (checkbox), no ring. The person gets the note "ring: derived".
                                 Order from the centre: close friend, friend, acquaintance, intending to connect, unsorted. "Met through" holds person refs
                                 ([Name #person](tana:id), a Content field accepts them): the converter keeps them as links, no Tana change.
  ring-suggestions.json          also read by the converter (next to the nodes file): for a person with no manual ring the suggested ring is
                                 the ring (a person who already has a desire of 1 or more keeps the ring that desire gives), the family tag and desire (number + since = conversion day) become fields, and the person gets the note
                                 "ring: suggested" (not "derived"). The ring chip shows dashed until tapped once (that tap files the ring as an edit);
                                 the family / desire writes go to Tana once through the sync queue (prefs.suggestedQueued).
                                 Dev server, next to the record: { "<person id>": { "ring", "family": bool, "intending": 0-10,
                                 "reason" } }. The Sort cards pre-select the suggested chip (outlined, "suggested: <reason>"): one tap
                                 on it files the whole suggestion; "Confirm all suggestions" files every card at once.
  TW_CRM_TANA_TOKEN=<token>      dev server only: preloads Tana sync ON (auto, 2 s) on a device that never saved its choice.
                                 Never in a build.

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
  src/import_contacts.svelte     Import contacts: files or a folder (vCard, Google CSV, Facebook JSON), summary, duplicate review, save,
                                 undo (src/import/*: detect, intake, parsers, dedup); contact_page.svelte shows one imported contact;
                                 contacts live in the CRM key only, never in TrustWeb's record
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
