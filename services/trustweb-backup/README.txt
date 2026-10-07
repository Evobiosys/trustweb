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
                  GET /hosted/status also says who transcribes: provider.transcribe {enabled, provider, region, dataPolicy} (status.mjs).
  POST /transcribe  audio in, {text, segments} out; forwards to OpenRouter's speech-to-text endpoint (Whisper, one synchronous call,
                  USD 0.012-0.04 per hour of audio), stores nothing. Provider code: transcribe_openrouter.mjs (default),
                  transcribe_infomaniak.mjs (TRANSCRIBE_PROVIDER=infomaniak, async batch API); shared shape in transcribe_provider.mjs.
                  The OpenRouter key reaches the unit as a systemd credential (LoadCredential=orkey:/etc/unfold-news/orkey.json, JSON
                  {"key": "..."}); no secret is read by any script. Segment times are the model's own when they are plausible, else
                  sentence-level estimates and the answer says "approx": true. Audio goes with data policy "deny" to a US inference provider.
                  503 not_configured until switched on: scripts/trustweb_transcribe_switch_on.sh production (no prompt; "off" reverses it).
                  Money: ONE paid job at a time (short queue), booked before the call, followed to its end even when the
                  phone leaves, the provider's duration booked afterwards; a job past the deadline closes the day's budget.
                  Bytes do not bound duration (Opus DTX), so the residual is one crafted job per UTC day (see transcribe.mjs).
  POST /feedback  website feedback from https://idea2.site / https://app.idea2.site only (the one CORS route), one JSON line
                  per entry in a 0600 file. Optional {notify, newsletter, email} (wave 2, P14/P15): the email is validated and kept
                  only when notify or newsletter is true; ONLY newsletter:true forwards it (after the entry is stored) to the
                  subscriber service (SUBSCRIBER_URL; newsletter.mjs; same body as the join form; double opt-in at the subscriber;
                  the answer stays 204 whatever it does; no retry). The file (read with scripts/trustweb_feedback_read.sh, which shows control and
                  bidi characters as \u{XXXX} so typed-in escapes never reach the terminal).

API contract (routes, headers, bodies, status codes, curl examples): DEVLOG/trustweb-wave-1733/services-api-contract.txt.
Env vars: the header of server.mjs (backup) and config.mjs (hosted, transcribe, feedback).
One real call against questhub: scripts/trustweb_transcribe_probe.sh staging <audio> <mime> <seconds> (synthetic audio only).
Modules: server.mjs (guard, routing, /backup), http_util.mjs, limits.mjs, quota.mjs (the allowance as pure arithmetic),
hosted_store.mjs + hosted.mjs, status.mjs (the /hosted/status body), transcribe.mjs (+ transcribe_provider.mjs, transcribe_openrouter.mjs, transcribe_infomaniak.mjs), feedback.mjs + newsletter.mjs, config.mjs, sweep_hosted.mjs.

RUN (local)
  BACKUP_DIR=/tmp/twbackup HOSTED_DIR=/tmp/twhosted PORT=8960 node server.mjs
  curl -s http://127.0.0.1:8960/health        # ok
Requires Node 20+ (fs.openAsBlob, AbortSignal.any, fs.statfs; questhub has Node 22). No dependencies.

TEST
  sh services/trustweb-backup/test/run_tests.sh      (TSC=/path/to/tsc if this worktree has no node_modules)
Typechecks backup.ts with apps/demo's tsc, compiles it to a temp dir, runs node --test over nine files (124 tests since wave 2: 113 before it, plus status provider, recordings allowance, feedback opt-in; the 17
original backup tests untouched, then allowance arithmetic, hosted routes, transcription against a fake Infomaniak and a fake
OpenRouter (23 tests: success, bad model JSON, 400/401/402/403/429/500, gateway statuses counted, timeout, oversized, budgets, hang-up), feedback
and CORS, ETag/late packs, the in-memory limiters). Fixed test ports 8971-8976 and 8978, one per file (8977 is taken by
another program on the dev machine); 8979 is the fake subscriber of feedback.test.mjs. Nothing is left running.

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
  - Environment=TRANSCRIBE_PROVIDER=openrouter and LoadCredential=orkey:/etc/unfold-news/orkey.json (the line is written only when that
    file exists on questhub: a missing credential file would stop the unit). EnvironmentFile=-/etc/trustweb-backup.env (0600 root)
    holds TRANSCRIBE_ENABLED=1 (written by the switch-on script); absent = transcription off (503 not_configured)
  - Environment=SUBSCRIBER_URL=https://subscriber.questhub.eco/subscribe (production; TW_SUBSCRIBER_URL overrides): where newsletter opt-ins of
    the feedback form go. The STAGING unit points at a throwaway fake on 127.0.0.1:8979 that the smoke test starts and kills, plus
    RATE_LIMIT=300 and FEEDBACK_PER_HOUR=100 (the smoke test posts more than the production limits allow from one address).
  - SELinux (Enforcing): code dir usr_t, unit written in place with tee, data dirs var_lib_t (checked by the script)
  - Caddy: handle /hosted/*, /transcribe, /feedback (size limits, 15 min timeouts); keep /hosted/ paths out of access logs.
Behaviour change for /backup (the only one): the 30 s request deadline is now per request (server.requestTimeout is 15 min
for the long routes), still 30 s on /backup and /feedback.

Caddy keeps the original Host header (app.idea2.site) and sets X-Forwarded-For; the server trusts the last X-Forwarded-For
entry only when the socket peer is loopback. Do not log request bodies or the /backup/ and /hosted/ paths (ids are secrets).
