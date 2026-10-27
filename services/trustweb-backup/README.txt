trustweb-backup: the TrustWeb Swiss server (node stdlib only, binds 127.0.0.1)

  /backup/*       encrypted-blob store for backups, hand-overs and meeting packs ("back it up on a Swiss server?"). Ciphertext made
                  on the phone (apps/trustweb/src/backup.ts); the server cannot read it. GET sends ETag/Last-Modified and answers
                  If-None-Match with 304 (a reader polls a pack that was uploaded "pending" and replaced when the transcript is done).
  /hosted/*       hosted recordings with a free allowance COUNTED IN RECORDINGS (wave 2, P10): 10 recordings of up to 1 h per
                  person (MAX_RECORDINGS; `used` and `limit` of /usage are recordings). Guards beside it: 36000 s and 1 GB per
                  account, one recording 3600 s / 30 MB. The 1 GB is a backstop (10 x 30 MB = 300 MB is the real ceiling); the
                  backups are protected by the server-wide pool (HOSTED_MAX_BYTES 2 GB, free-disk floor 2 GB), not by it.
                  Opaque ciphertext, own directory (HOSTED_DIR), account token to read or a per-recording read capability.
                  90 days untouched = removable by the sweeper (sweep_hosted.mjs).
                  GET /hosted/status also says who transcribes: provider.transcribe {enabled, provider, region, dataPolicy, fallback} (status.mjs).
  POST /transcribe  audio in, {text, segments} out, stores nothing. PROVIDERS (wave 3): Berget AI (Sweden, Whisper, EUR 0.000033 per second =
                  about EUR 0.12 per hour; transcribe_berget.mjs) is the default once its key exists; OpenRouter (Whisper, USD 0.012-0.04 per hour,
                  US inference, data policy "deny"; transcribe_openrouter.mjs) is the fallback behind it, or the provider when there is no Berget key;
                  transcribe_infomaniak.mjs (TRANSCRIBE_PROVIDER=infomaniak, async batch API) stays for reference. transcribe_chain.mjs makes
                  Berget+OpenRouter ONE provider: OpenRouter only takes over on a Berget outage (5xx, timeout, no answer) or when Berget cannot take
                  the file type (it takes webm, m4a/mp4, mp3, wav; NOT ogg/opus/aac/flac), never on a 4xx or a 429. Shared shape: transcribe_provider.mjs.
                  There is NO free transcription on either service (checked 2026-10-07).
                  KEYS reach the unit as systemd credentials, JSON {"key": "..."}, 0600 root, owned by TrustWeb:
                    /etc/trustweb/orkey.json   OpenRouter   (LoadCredential=orkey:...)
                    /etc/trustweb/berget.json  Berget       (LoadCredential=berget:...; the line is written at DEPLOY, only when the file exists)
                  No secret is read by any script. Segment times are the model's own when plausible, else sentence-level estimates ("approx": true).
                  503 not_configured until switched on: scripts/trustweb_transcribe_switch_on.sh production berget | berget-only | openrouter | off.
                  WHO PAYS: the person's allowance is charged only for a transcript they RECEIVED; a failed, timed-out or lost job is always refunded
                  to the person. OUR budgets (global day, per client) stay conservative: a job that may still have been billed keeps its seconds there.
                  Money: ONE paid job at a time (short queue), booked before the call, followed to its end even when the phone leaves, the provider's
                  duration booked afterwards; a timeout closes the day's global budget; the third maybe-billed failure of a day does too.
                  Bytes do not bound duration (Opus DTX), so the residual is one crafted job per UTC day (see transcribe.mjs).
  POST /feedback  website feedback from https://idea2.site / https://app.idea2.site only (the one CORS route), one JSON line
                  per entry in a 0600 file. Optional {notify, newsletter, email} (wave 2, P14/P15): the email is validated and kept
                  only when notify or newsletter is true; ONLY newsletter:true forwards it (after the entry is stored) to the
                  subscriber service (SUBSCRIBER_URL; newsletter.mjs; same body as the join form; double opt-in at the subscriber;
                  the answer stays 204 whatever it does; no retry). review-wave2: with a ticked box the message may be empty;
                  at most NEWSLETTER_PER_MINUTE (2), NEWSLETTER_PER_DAY (20) and NEWSLETTER_PER_30_DAYS (240) forwards for all
                  visitors together (the subscriber allows this server's one address 3/min, 50/day, 250/30 days; the counts live
                  in memory, a restart forgets them), past any of them the entry is stored with deferred:true and logged "feedback newsletter
                  deferred" for a later replay (the subscriber answers a repeat with already_subscribed/confirmation_pending,
                  so a replay cannot double-subscribe). SUBSCRIBER_URL must be https (plain http to loopback only). The file (read with scripts/trustweb_feedback_read.sh, which shows control and
                  bidi characters as \u{XXXX} so typed-in escapes never reach the terminal).

  /websearch      (wave 3) web results from a real search API through this server, never the person's address: GET /websearch/engines,
                  POST /websearch {"q","engine"} (GET ?q=&engine= too). Engines with a documented official API: brave, mojeek (websearch.mjs,
                  websearch_engines.mjs, websearch_clean.mjs); qwant, ecosia, metager, swisscows are listed as link_only. Keys = systemd
                  credentials websearch-brave / websearch-mojeek ({"key": "..."}); no key = 503 not_configured. Per-client limit, a daily
                  budget per engine, calls in flight bounded, Sec-Fetch-Site cross-site refused; the query is never logged, cached or stored.
                  Contract: DEVLOG/trustweb-wave-1733/wave3/websearch-api-contract.txt.

  /link, /l/<id>  (wave 5) short connect links: POST /link {"url"} -> 201 {"id","expires_at"} (200 when the same url is already stored),
                  GET /l/<id> -> 302 to the stored long url, fragment included; unknown/expired/malformed id -> the same tiny 404 page.
                  Only https urls of LINK_HOSTS (app.idea2.site, app.trustintheweb.org, app.trustweb.one) with a connect parameter; 2 KB body cap, own-host Origin,
                  6/min and 30/h per address, 30 days, at most 5000, store <BACKUP_DIR>/links.json (0600). Never logged (not even method and
                  status): the modules have no logger. Caddy: scripts/trustweb_links_caddy_install.sh (log_skip). links.mjs, link_store.mjs.
                  Contract: services-api-contract.txt section 9.

  /connect, /c/<code>, /name, /who/<name>  (wave 6b) a permanent short address for a phone's connect link, and an optional username:
                  POST /connect {"url"} -> 201 {"code","secret","url"} (22 char code, 43 char secret, only sha256 kept); {"url","code","secret"} -> 200
                  (update; a wrong secret and an unknown code give the identical 403). GET /c/<code> -> 302 to the stored url (validated again on every
                  GET). POST /name {"name","code","secret"} claims a lowercase [a-z0-9._-] name (409 name_taken, "" releases); GET /who/<name> -> 302 to
                  https://<same app host>/c/<code>. 2 KB bodies, own-host Origin, POSTs 6/min and 30/h and GETs 20/min and 300/h per address, 365 days after
                  the last use, at most 20000 codes, store <BACKUP_DIR>/connect.json (0600). Never logged. CONNECT_* settings (config.mjs). Caddy:
                  scripts/trustweb_connect_caddy_install.sh. connect.mjs, connect_store.mjs, connect_names.mjs. Contract: services-api-contract.txt section 10.
  name limits, wave 15 (name_cap.mjs, connect_store.mjs): a network address (IPv4 as is, IPv6 by /64) may CLAIM 3 names per 30 days (NAME_CAP; promoting an alias, a re-claim,
                  a release and a read are no claims); the 4th answers 429 {"error":"name-cap","until":<ms>}. The count sits in the connect store file ("claims") and survives
                  restarts. A freed name rests 30 days for every other code (answered name_taken; its former holder may reclaim at once); "released" in the store file keeps it
                  180 days. GET /c/<code> of a code whose claimed name had another holder in the last 180 days redirects with &prev=1 added to the query (the app shows a dismissible
                  note; no identity is kept or told). HOW AN ORGANIZER GETS MORE: mails the steward BEFORE the event (no squatting) with the username(s) and the event. The operator
                  then adds an entry to the NAME_CAP_ALLOW file (JSON array) and runs `systemctl kill -s HUP trustweb-backup` (or `kill -HUP <pid>`; no restart needed):
                    [{"code":"<22-char connect code of the organizer>" | "addr":"203.0.113.7" | "prefix":"2001:db8:1:", "cap":20, "note":"organizer <who>, approved <when>"}]
                  The highest matching cap wins; entries without cap >= 1 or without code/addr/prefix are ignored.
  name cap request, wave 21 (connect.mjs): POST /names/cap-request {"code","secret","name","reason","wanted"} from a code that holds `name` -> 202 {"at"}; one per address (IPv6: /64) per day
                  (a second is 429). It appends one JSON line {at, address, name, reason (280 chars), wanted (50 at most)} to NAME_CAP_REQUESTS (default name_cap_requests.jsonl beside
                  the NAME_CAP_ALLOW file). HOW THE STEWARD ANSWERS: read the file (tail -n 20), mail the organizer, and when approved add {"code":"<their 22-char code>","cap":<wanted>,
                  "note":"..."} to the NAME_CAP_ALLOW file and send SIGHUP (see above); the request file is never read by the server. AGENTIC CLAIMS: a POST /name with the header
                  X-TW-Agent: 1 (set by agents and scripts, never by the app) counts toward a separate cap of the same size and window; the store file's "claims" keeps it under "agent:<address>" (the connect modules log nothing, so that key is the marker).
  usernames, wave 6e (contract section 10.9): a code holds up to 3 names (a primary + 2 aliases; POST /name {"name","alias":true} / {"release":"<name>"} / code+secret
                  alone = READ the names; answers {"name","aliases","locked"}: locked = the held names that are reserved). RESERVED_NAMES (env, production japossert,jakob) + the built-in list answer 409 reserved;
                  a reserved name a code holds was granted by the admin and is LOCKED against the app (409 name_locked). The admin routes POST|DELETE /admin/name and
                  GET /admin/names are loopback-only (loopback peer, Host 127.0.0.1[:port] or localhost[:port], no Forwarded / X-Forwarded-* / X-Real-IP / Origin header,
                  X-Admin-Token from the systemd credential admin = /etc/trustweb/admin.json), dispatched before the Host gate, NEVER in Caddy. Operator:
                  scripts/trustweb_name_grant.sh --host questhub --list | --code <22> --name <n> [--alias <n2>] | --remove <n>. admin.mjs, connect_aliases.mjs.

  What protects a trustweb.one/<name> link (wave 9): GET /who and /c share a per-address limit (20/min, 300/h) and /who has a per-name limit of
                  WHO_PER_NAME_PER_MINUTE (60) over all addresses together, so one name cannot be burned from many addresses (plain-text 429 with
                  Retry-After). Every /who and /c answer carries X-Robots-Tag: noindex, nofollow. An unknown name and a bad shape answer the
                  same no-store 404 page. A claim (primary or alias) is refused as name_taken when another code holds a lookalike (connect_names.mjs
                  confusableKey: "." "_" "-" dropped, 0 1 3 5 7 read as o l e s t, rn as m); one's own variants are fine. The phone sends
                  at most 10 reach-outs per hour (wave9/reach-out-yellow). Counters live in memory and restart with the server.

  /org/*          (wave 8) organizer accounts, the paying side: POST /org {"name"} -> 201 {"org","secret","plan":"free","limits":{"events":3,"invitees":25}} (same
                  code/secret generator as /connect, only sha256 of the secret kept); POST /org/me {"org","secret"} -> name, plan, limits, events with counters;
                  POST /org/event {"org","secret","event","link","invitees"[,"id"]} -> 201 create / 200 update (counters kept), {..."id","delete":true} -> 204.
                  The link must be an https LINK_HOSTS url with a #ev_host= fragment; a wrong secret and an unknown org give the identical 403. 409 limit_events /
                  limit_invitees (free 3 events x 25 invitees, hosted 50 x 500). POST /org/hit {"event","kind":"opened|joined|tagged"} is the one route attendee
                  phones touch: 204 always (unknown id too), +1 on the counter, no identity and no request data kept. 16 KB bodies, own-host Origin, 6/min+30/h (create),
                  20/min+200/h (me, event), 60/min (hit) per address. POST /admin/org {"org","plan":"free|hosted"} is loopback-only like /admin/name (paid tier switch).
                  Store <BACKUP_DIR>/organizers.json (0600). Never logged. ORG_* settings (config.mjs). organizer.mjs, organizer_store.mjs. Contract: section 11.

API contract (routes, headers, bodies, status codes, curl examples): DEVLOG/trustweb-wave-1733/services-api-contract.txt.
Env vars: the header of server.mjs (backup) and config.mjs (hosted, transcribe, feedback).
One real call against questhub: scripts/trustweb_transcribe_probe.sh staging <audio> <mime> <seconds> (synthetic audio only).
Modules: server.mjs (guard, routing, /backup), http_util.mjs, limits.mjs, quota.mjs (the allowance as pure arithmetic),
hosted_store.mjs + hosted.mjs, links.mjs + link_store.mjs, connect.mjs + connect_store.mjs + connect_names.mjs + connect_aliases.mjs, organizer.mjs + organizer_store.mjs (wave 8), admin.mjs (wave 6e, + /admin/org), status.mjs (the /hosted/status body), transcribe.mjs (+ transcribe_provider.mjs, transcribe_chain.mjs, transcribe_berget.mjs, transcribe_openrouter.mjs, transcribe_infomaniak.mjs), feedback.mjs + newsletter.mjs, config.mjs, sweep_hosted.mjs.

RUN (local)
  BACKUP_DIR=/tmp/twbackup HOSTED_DIR=/tmp/twhosted PORT=8960 node server.mjs
  curl -s http://127.0.0.1:8960/health        # ok
Requires Node 20+ (fs.openAsBlob, AbortSignal.any, fs.statfs; questhub has Node 22). No dependencies.

TEST
  sh services/trustweb-backup/test/run_tests.sh      (TSC=/path/to/tsc if this worktree has no node_modules)
Typechecks backup.ts with apps/demo's tsc, compiles it to a temp dir, runs node --test over fifteen files (290 tests after wave 6e: 235 before it plus 55 for aliases, reserved and locked names, the READ intent and the admin routes, aliases.test.mjs and admin.test.mjs, with the 6b connect tests updated; 232 tests after wave 6b: 190 before it plus 42 for the connect codes and usernames, connect.test.mjs; 190 after wave 5: 166 before it plus 24 for the short links, links.test.mjs; earlier, 151 since wave 3: 130 before it plus 21 for Berget, the chain and the person-never-pays rule; the 17
original backup tests untouched, then allowance arithmetic, hosted routes, transcription against a fake Infomaniak and a fake
OpenRouter (23 tests: success, bad model JSON, 400/401/402/403/429/500, gateway statuses counted, timeout, oversized, budgets, hang-up), feedback
and CORS, ETag/late packs, the in-memory limiters; transcribe_berget.test.mjs: a fake Berget and a fake OpenRouter). Fixed test ports 8971-8976
and 8978, one per file (8977 is taken by another program on the dev machine); 8979 is the fake subscriber of feedback.test.mjs;
transcribe_berget.test.mjs takes no fixed port (its server and both fakes listen on port 0). Nothing is left running.

ANONYMOUS USAGE STATISTICS (P19, "down the road": NOT built, design note only)
When it comes, it counts per day and nothing else: one integer per UTC day and event kind (for example recordings stored, transcriptions run,
queries answered), kept in a small file the operator reads. No account id, token, IP, user agent, session id or any per-person key is ever
written next to a count, so the file cannot be joined back to a person; counters are incremented in memory and flushed once a day, and a
count below a floor (say 5) is shown as "fewer than 5" so a quiet day does not identify anyone. Opt-in per community, and not before there are
two communities (Jakob, 2026-10-07).

Per-client limits count IPv4 addresses as they are and IPv6 per /64 (limits.mjs ipKey); /backup keeps its old per-address limiter.

DEPLOY (questhub)
  scripts/deploy_trustweb_backup.sh --staging [--keep] [--dry-run]    second unit trustweb-backup-staging on 127.0.0.1:8970, smoke test, then stopped
  scripts/deploy_trustweb_backup.sh --production [--dry-run]          the real unit + Caddy routes (orchestrator, after review)
  scripts/deploy_trustweb_backup.sh --print-caddy                      the Caddy snippet
The unit text lives in the script (unit_text). Notes for the production unit:
  - StateDirectory=trustweb-backup trustweb-hosted (hosted data and feedback.jsonl live in /var/lib/trustweb-hosted, never in BACKUP_DIR)
  - LoadCredential=orkey:/etc/trustweb/orkey.json and LoadCredential=berget:/etc/trustweb/berget.json (each line is written only when its file
    exists on questhub at deploy time: a missing credential file would stop the unit; after creating a key file, DEPLOY AGAIN). The provider is
    not pinned in the unit (default auto = Berget if its key exists, else OpenRouter). EnvironmentFile=-/etc/trustweb-backup.env (0600 root)
    holds TRANSCRIBE_ENABLED=1, TRANSCRIBE_PROVIDER and TRANSCRIBE_FALLBACK (written by the switch-on script); absent = transcription off (503 not_configured)
  - Environment=SUBSCRIBER_URL=https://subscriber.questhub.eco/subscribe (production; TW_SUBSCRIBER_URL overrides): where newsletter opt-ins of
    the feedback form go. The STAGING unit points at a throwaway fake on 127.0.0.1:8979 that the smoke test starts and kills, plus
    RATE_LIMIT=300 and FEEDBACK_PER_HOUR=100 (the smoke test posts more than the production limits allow from one address).
  - SELinux (Enforcing): code dir usr_t, unit written in place with tee, data dirs var_lib_t (checked by the script)
  - Caddy: handle /hosted/*, /transcribe, /feedback (size limits, 15 min timeouts); keep /hosted/ paths out of access logs.
Behaviour change for /backup (the only one): the 30 s request deadline is now per request (server.requestTimeout is 15 min
for the long routes), still 30 s on /backup and /feedback.

Caddy keeps the original Host header (app.idea2.site) and sets X-Forwarded-For; the server trusts the last X-Forwarded-For
entry only when the socket peer is loopback. Do not log request bodies or the /backup/ and /hosted/ paths (ids are secrets).

Devices (wave 15): one account code across linked devices
  POST /connect {code, secret, rotate:true}   unlink: a NEW secret (200 {code, secret, url}); the old one is dead.
  POST /name {code, secret, move:"<name>", from:{code, secret}, as?:"primary"|"alias"}   atomic move of a name between two codes of one
     account: both secrets must open (403 either way), code === from is 400, 409 not_held / alias_cap (target would pass 3 names) /
     name_moved (one move per name per 30 days, `until` says when) / name_taken (lookalike). No claim (the name cap ignores it), no
     30-day rest, a locked name moves and stays locked. Both codes change in one step with one write.
  An OLD server (before this wave) ignores `move` and `rotate`: it answers a move as a plain READ (200 with the unchanged names, so the
     client sees no change and reports a server error) and a rotate with a 400 (no url); nothing is lost. Deploy the server first.
  The app also touches a code with a plain GET /c/<code> (read-only, no body) to keep it from expiring; the url is written only when it changed.
