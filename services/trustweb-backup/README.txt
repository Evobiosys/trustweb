trustweb-backup: the TrustWeb Swiss server (node stdlib only, binds 127.0.0.1)

  /backup/*       encrypted-blob store for backups, hand-overs and meeting packs ("back it up on a Swiss server?"). Ciphertext made
                  on the phone (apps/trustweb/src/backup.ts); the server cannot read it. GET sends ETag/Last-Modified and answers
                  If-None-Match with 304 (a reader polls a pack that was uploaded "pending" and replaced when the transcript is done).
  /hosted/*       hosted recordings with a free allowance (the equivalent of 10 recordings of 1 h per person: 36000 s, 200 MB;
                  one recording 3600 s / 30 MB; 50 slots). Opaque ciphertext, own directory (HOSTED_DIR), account token to read
                  or a per-recording read capability. 90 days untouched = removable by the sweeper (sweep_hosted.mjs).
  POST /transcribe  audio in, {text, segments} out; forwards to Infomaniak AI Tools Whisper (async batch API, polled), stores nothing.
                  503 not_configured until the key is placed (scripts/trustweb_transcribe_switch_on.sh).
                  Money: ONE paid job at a time (short queue), booked before the call, followed to its end even when the
                  phone leaves, the provider's duration booked afterwards; a job past the deadline closes the day's budget.
                  Bytes do not bound duration (Opus DTX), so the residual is one crafted job per UTC day (see transcribe.mjs).
  POST /feedback  website feedback from https://idea2.site / https://app.idea2.site only (the one CORS route), one JSON line
                  per entry in a 0600 file (read with scripts/trustweb_feedback_read.sh, which shows control and
                  bidi characters as \u{XXXX} so typed-in escapes never reach the terminal).

API contract (routes, headers, bodies, status codes, curl examples): DEVLOG/trustweb-wave-1733/services-api-contract.txt.
Env vars: the header of server.mjs (backup) and config.mjs (hosted, transcribe, feedback).
Modules: server.mjs (guard, routing, /backup), http_util.mjs, limits.mjs, quota.mjs (the allowance as pure arithmetic),
hosted_store.mjs + hosted.mjs, transcribe.mjs, feedback.mjs, config.mjs, sweep_hosted.mjs.

RUN (local)
  BACKUP_DIR=/tmp/twbackup HOSTED_DIR=/tmp/twhosted PORT=8960 node server.mjs
  curl -s http://127.0.0.1:8960/health        # ok
Requires Node 20+ (fs.openAsBlob, AbortSignal.any, fs.statfs; questhub has Node 22). No dependencies.

TEST
  sh services/trustweb-backup/test/run_tests.sh      (TSC=/path/to/tsc if this worktree has no node_modules)
Typechecks backup.ts with apps/demo's tsc, compiles it to a temp dir, runs node --test over eight files (86 tests: the 17
original backup tests untouched, then allowance arithmetic, hosted routes, transcription against a fake provider, feedback
and CORS, ETag/late packs, the in-memory limiters). Fixed test ports 8971-8975, one per file. Nothing is left running.
Per-client limits count IPv4 addresses as they are and IPv6 per /64 (limits.mjs ipKey); /backup keeps its old per-address limiter.

DEPLOY (questhub)
  scripts/deploy_trustweb_backup.sh --staging [--keep] [--dry-run]    second unit trustweb-backup-staging on 127.0.0.1:8970, smoke test, then stopped
  scripts/deploy_trustweb_backup.sh --production [--dry-run]          the real unit + Caddy routes (orchestrator, after review)
  scripts/deploy_trustweb_backup.sh --print-caddy                      the Caddy snippet
The unit text lives in the script (unit_text). Notes for the production unit:
  - StateDirectory=trustweb-backup trustweb-hosted (hosted data and feedback.jsonl live in /var/lib/trustweb-hosted, never in BACKUP_DIR)
  - EnvironmentFile=-/etc/trustweb-backup.env (0600 root) holds TRANSCRIBE_URL / TRANSCRIBE_KEY; absent = transcription off
  - SELinux (Enforcing): code dir usr_t, unit written in place with tee, data dirs var_lib_t (checked by the script)
  - Caddy: handle /hosted/*, /transcribe, /feedback (size limits, 15 min timeouts); keep /hosted/ paths out of access logs.
Behaviour change for /backup (the only one): the 30 s request deadline is now per request (server.requestTimeout is 15 min
for the long routes), still 30 s on /backup and /feedback.

Caddy keeps the original Host header (app.idea2.site) and sets X-Forwarded-For; the server trusts the last X-Forwarded-For
entry only when the socket peer is loopback. Do not log request bodies or the /backup/ and /hosted/ paths (ids are secrets).
