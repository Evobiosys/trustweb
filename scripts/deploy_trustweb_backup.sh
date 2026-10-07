#!/bin/bash
# Install / update the TrustWeb server on questhub: encrypted backups, hosted recordings with a free
# allowance, the transcription proxy and website feedback (services/trustweb-backup).
#
#   ./scripts/deploy_trustweb_backup.sh --staging [--keep] [--dry-run]
#   ./scripts/deploy_trustweb_backup.sh --production [--dry-run]
#   ./scripts/deploy_trustweb_backup.sh --print-caddy
#
# A mode flag is REQUIRED (the old no-flag run deployed production; that is now refused so a stray
# run cannot touch Jakob's real backups).
#
#   --staging     A SECOND unit, trustweb-backup-staging, on loopback port 8970 with its own data dirs
#                 (/var/lib/trustweb-backup-staging, /var/lib/trustweb-hosted-staging) and code dir
#                 (/opt/trustweb-backup-staging), MemoryMax=128M, no Caddy route. Smoke-tests it over ssh
#                 with curl, then STOPS and DISABLES it again (the server has 2 GB RAM) unless --keep.
#                 Prints free -m and df -h before and after. Never touches the production unit, its data
#                 dir or the Caddyfile.
#   --production  Backs up the server copy (cp .bak.<timestamp>), installs the code, rewrites the unit
#                 (adds the hosted data dir, the OpenRouter and Berget keys as systemd credentials when
#                 /etc/trustweb/orkey.json / /etc/trustweb/berget.json exist on questhub, an optional EnvironmentFile),
#                 restarts, and adds the Caddy routes /hosted/*, /transcribe, /feedback (timestamped
#                 Caddyfile backup, `caddy validate` before reload, restore on failure). RUN BY THE
#                 ORCHESTRATOR ONLY, after review.
#   --dry-run     Print what would be done; change nothing (local or remote).
#   --keep        (staging) leave the staging unit running after the smoke test.
#
# Newsletter opt-ins of the feedback form (wave 2, P14/P15): the unit carries SUBSCRIBER_URL. Production: the real
# https://subscriber.questhub.eco/subscribe (override: TW_SUBSCRIBER_URL). Staging: NEVER the real one, a throwaway listener
# on 127.0.0.1:8979 that the smoke test starts and kills (override: TW_STAGING_SUBSCRIBER_URL); the smoke only uses example.org addresses.
#   --print-caddy Print the Caddy snippet and exit.
#
# Same SSH recipe as deploy_wot.sh (questhub needs publickey + password; the askpass helper reads both
# from the login Keychain). questhub runs SELinux Enforcing: code dirs get usr_t, units are written in
# place with `sudo tee` (never mv from /tmp), data dirs are created by systemd (StateDirectory) and
# checked to carry var_lib_t like production.
set -euo pipefail

MODE=""
DRY=0
KEEP=0
CONFLICT=0
set_mode() { if [ -n "$MODE" ] && [ "$MODE" != "$1" ]; then CONFLICT=1; fi; MODE="$1"; }
for arg in "$@"; do
  case "$arg" in
    --staging) set_mode staging ;;
    --production) set_mode production ;;
    --print-caddy) set_mode print-caddy ;;
    --dry-run) DRY=1 ;;
    --keep) KEEP=1 ;;
    -h|--help) sed -n '2,31p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done
[ "$CONFLICT" = 0 ] || { echo "use only one of --staging / --production / --print-caddy" >&2; exit 2; }
case "$MODE" in
  staging|production|print-caddy) ;;
  *) echo "usage: $0 --staging|--production [--dry-run] [--keep]   (or --print-caddy)" >&2; exit 2 ;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$HERE/../services/trustweb-backup"
SSHENV=(env SSH_ASKPASS="$HOME/.ssh/questhub-jump-askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0)
rsh() { "${SSHENV[@]}" ssh questhub "$@"; }
TS="$(date +%Y%m%d_%H%M%S)"
# The transcription keys live in root-owned files ({"key": "..."}, 0600) that TrustWeb owns (wave 3: no longer unfold-news's
# /etc/unfold-news/orkey.json, a legacy file of another project that must be free to disappear). The unit receives each as a
# systemd credential (LoadCredential=orkey:... / berget:...): systemd reads it as root and hands the service a private copy under
# $CREDENTIALS_DIRECTORY, so the service user needs no access to /etc/trustweb. This script never reads the files.
CRED_FILE=/etc/trustweb/orkey.json          # OpenRouter (the fallback provider)
BERGET_CRED_FILE=/etc/trustweb/berget.json  # Berget AI (the default provider once this file exists; Jakob creates it, see the README)
# Where feedback entries with newsletter:true are forwarded (services/trustweb-backup/newsletter.mjs). Staging must never reach the real service.
SUBSCRIBER_URL_PRODUCTION="${TW_SUBSCRIBER_URL:-https://subscriber.questhub.eco/subscribe}"
SUBSCRIBER_URL_STAGING="${TW_STAGING_SUBSCRIBER_URL:-http://127.0.0.1:8979/subscribe}"

caddy_snippet() {
  cat <<'CADDY'
	# --- TrustWeb hosted recordings, transcription and feedback (wave 1733) ---
	# Same upstream as /backup (127.0.0.1:8960). The path of /hosted/ carries an account id and the
	# recording id: keep these paths out of any access log. Bodies are streamed by the server; the
	# limits here are the outer guard (hosted: one recording is at most 30 MB; transcribe: 21.6 MB;
	# feedback: 16 KB). Long timeouts: a phone upload of 20 MB takes minutes, a transcription up to
	# ten minutes (the server polls the provider).
	handle /hosted/* {
		request_body {
			max_size 31MB
		}
		reverse_proxy 127.0.0.1:8960 {
			transport http {
				read_timeout 15m
				write_timeout 15m
				response_header_timeout 15m
			}
		}
	}
	handle /transcribe {
		request_body {
			max_size 22MB
		}
		reverse_proxy 127.0.0.1:8960 {
			transport http {
				read_timeout 15m
				write_timeout 15m
				response_header_timeout 15m
			}
		}
	}
	handle /feedback {
		request_body {
			max_size 20KB
		}
		reverse_proxy 127.0.0.1:8960
	}
CADDY
}

# The systemd unit. $1 = suffix ("" or "-staging"), $2 = port, $3 = memory max, $4 = 1 when the OpenRouter credential file exists on
# questhub, $5 = 1 when the Berget one does (a LoadCredential= line for a missing file would stop the unit from starting, so each
# line is written only when its file is there).
unit_text() {
  local s="$1" port="$2" mem="$3" cred="${4:-0}" berget="${5:-0}" allowed="app.idea2.site" cred_line="" subscriber="$SUBSCRIBER_URL_PRODUCTION" staging_line=""
  if [ -n "$s" ]; then
    subscriber="$SUBSCRIBER_URL_STAGING"
    # The smoke test makes more than 30 requests and more than 5 feedback posts from one address (loopback): staging only, production keeps the defaults.
    staging_line="Environment=RATE_LIMIT=300
Environment=FEEDBACK_PER_HOUR=100
"
  fi
  [ "$cred" = 1 ] && cred_line="LoadCredential=orkey:${CRED_FILE}
"
  [ "$berget" = 1 ] && cred_line="${cred_line}LoadCredential=berget:${BERGET_CRED_FILE}
"
  cat <<UNIT
[Unit]
Description=TrustWeb server${s:+ (staging)}: encrypted backups, hosted recordings, transcription proxy, feedback (see web-of-trust services/trustweb-backup)
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/trustweb-backup${s}/server.mjs
Environment=HOST=127.0.0.1
Environment=PORT=${port}
Environment=BACKUP_DIR=/var/lib/trustweb-backup${s}
Environment=HOSTED_DIR=/var/lib/trustweb-hosted${s}
Environment=FEEDBACK_FILE=/var/lib/trustweb-hosted${s}/feedback.jsonl
Environment=ALLOWED_HOSTS=${allowed}
Environment=SUBSCRIBER_URL=${subscriber}
${staging_line}# Transcription: the provider is NOT pinned here (TRANSCRIBE_PROVIDER default auto = Berget when its key exists, else OpenRouter);
# keys handed in as credentials, everything switched on by scripts/trustweb_transcribe_switch_on.sh (it writes TRANSCRIBE_ENABLED=1,
# TRANSCRIBE_PROVIDER and TRANSCRIBE_FALLBACK into the env file below). Without that switch /transcribe answers 503 not_configured.
${cred_line}EnvironmentFile=-/etc/trustweb-backup${s}.env
DynamicUser=yes
StateDirectory=trustweb-backup${s} trustweb-hosted${s}
StateDirectoryMode=0700
Restart=on-failure
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
MemoryMax=${mem}

[Install]
WantedBy=multi-user.target
UNIT
}

# Smoke test, run ON questhub through ssh (bash -s). $1 = port, $2 = the port of the throwaway fake subscriber it starts and kills.
# Fails (non-zero) on the first wrong answer.
smoke_script() {
  cat <<'SMOKE'
set -euo pipefail
PORT="$1"
SUBPORT="$2"
B="http://127.0.0.1:$PORT"
H='Host: app.idea2.site'
ACC=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
TOK=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
RC=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
RID=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
expect() { [ "$1" = "$2" ] && echo "  ok   $3 -> $1" || { echo "  FAIL $3 -> got $1, expected $2" >&2; exit 1; }; }
echo "health"
expect "$(curl -fsS -H "$H" $B/health)" ok "GET /health"
echo "hosted status (wave 2: the provider block for the app's copy; the old booleans stay)"
STATUS=$(curl -fsS -H "$H" $B/hosted/status); echo "$STATUS"
# wave 3: the active provider depends on which credential files exist (Berget "se", OpenRouter "us", or Berget + a fallback), so the
# smoke checks the SHAPE (off, a known provider and region, a fallback member), not one fixed provider.
case "$STATUS" in
  *'"provider":{"transcribe":{"enabled":false,"provider":"berget","region":"se","dataPolicy":null,"fallback":'*|*'"provider":{"transcribe":{"enabled":false,"provider":"openrouter","region":"us","dataPolicy":"deny","fallback":null}}'*) echo "  ok   status.provider.transcribe" ;;
  *) echo "  FAIL status.provider.transcribe missing or wrong" >&2; exit 1 ;;
esac
case "$STATUS" in *'"transcribe":false'*) echo "  ok   old boolean transcribe:false" ;; *) echo "  FAIL old boolean" >&2; exit 1 ;; esac
echo "hosted recording cycle"
printf 'smoke-test-ciphertext' > /tmp/tw_smoke.bin
expect "$(code -H "$H" -X PUT -H "X-Write-Token: $TOK" -H 'X-Seconds: 60' -H "X-Read-Token: $RC" --data-binary @/tmp/tw_smoke.bin $B/hosted/$ACC/rec/$RID)" 204 "PUT recording"
expect "$(code -H "$H" $B/hosted/$ACC/rec/$RID)" 403 "GET without credential"
expect "$(code -H "$H" -H "X-Read-Token: $RC" $B/hosted/$ACC/rec/$RID)" 200 "GET with read capability"
ETAG=$(curl -s -D - -o /dev/null -H "$H" -H "X-Write-Token: $TOK" $B/hosted/$ACC/rec/$RID | tr -d '\r' | awk -F': ' 'tolower($1)=="etag"{print $2}')
expect "$(code -H "$H" -H "X-Write-Token: $TOK" -H "If-None-Match: $ETAG" $B/hosted/$ACC/rec/$RID)" 304 "GET If-None-Match"
USAGE=$(curl -fsS -H "$H" -H "X-Write-Token: $TOK" $B/hosted/$ACC/usage); echo "$USAGE"
case "$USAGE" in *'"used":1,"limit":10,'*'"recordings":1,"maxRecordings":10,'*) echo "  ok   usage counts recordings: used 1 of limit 10" ;; *) echo "  FAIL usage is not counted in recordings" >&2; exit 1 ;; esac
expect "$(code -H "$H" -X DELETE -H "X-Write-Token: $TOK" $B/hosted/$ACC/rec/$RID)" 204 "DELETE recording"
echo "backup route + late pack validators"
BID=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
expect "$(code -H "$H" -X PUT -H "X-Write-Token: $TOK" --data-binary pending $B/backup/$BID)" 204 "PUT pack (pending)"
BETAG=$(curl -s -D - -o /dev/null -H "$H" $B/backup/$BID | tr -d '\r' | awk -F': ' 'tolower($1)=="etag"{print $2}')
expect "$(code -H "$H" -H "If-None-Match: $BETAG" $B/backup/$BID)" 304 "GET pack If-None-Match"
expect "$(code -H "$H" -X PUT -H "X-Write-Token: $TOK" --data-binary complete $B/backup/$BID)" 204 "PUT pack again (same token)"
expect "$(code -H "$H" -H "If-None-Match: $BETAG" $B/backup/$BID)" 200 "GET pack changed since"
echo "origin guard"
expect "$(code -H "$H" -H 'Origin: https://idea2.site' $B/backup/$BID)" 403 "/backup with Origin idea2.site"
expect "$(code -H "$H" -H 'Origin: https://idea2.site' $B/hosted/status)" 403 "/hosted with Origin idea2.site"
echo "feedback"
expect "$(code -H "$H" -X POST -H 'Origin: https://idea2.site' -H 'Content-Type: application/json' -d '{"text":"smoke test, please ignore","kind":"feedback"}' $B/feedback)" 204 "POST /feedback"
expect "$(code -H "$H" -X POST -H 'Origin: https://evil.example.com' -H 'Content-Type: application/json' -d '{"text":"x"}' $B/feedback)" 403 "POST /feedback foreign Origin"
expect "$(code -H "$H" -X OPTIONS -H 'Origin: https://app.idea2.site' $B/feedback)" 204 "OPTIONS /feedback"
echo "feedback + newsletter opt-in against a FAKE subscriber on 127.0.0.1:$SUBPORT (never the real service)"
umask 077
SUBDIR=$(mktemp -d); SUBLOG="$SUBDIR/received.log"; : > "$SUBLOG"
node -e 'const h=require("http"),fs=require("fs");h.createServer((q,r)=>{let b="";q.on("data",c=>{b+=c});q.on("end",()=>{fs.appendFileSync(process.argv[1],q.method+" "+q.url+" "+b+"\n");r.writeHead(200);r.end()})}).listen(+process.argv[2],"127.0.0.1")' "$SUBLOG" "$SUBPORT" &
SUBPID=$!
trap 'kill $SUBPID 2>/dev/null || true; rm -rf "$SUBDIR"' EXIT
for _ in $(seq 40); do curl -s -o /dev/null "http://127.0.0.1:$SUBPORT/" && break; sleep 0.25; done
: > "$SUBLOG" # the readiness probe above is not an opt-in
FB() { code -H "$H" -X POST -H 'Origin: https://idea2.site' -H 'Content-Type: application/json' -d "$1" $B/feedback; }
expect "$(FB '{"text":"smoke: notify only","email":"smoke-notify@example.org","notify":true}')" 204 "feedback notify only"
expect "$(FB '{"text":"smoke: unticked boxes","email":"smoke-none@example.org","notify":false,"newsletter":false}')" 204 "feedback email without a ticked box"
expect "$(FB '{"text":"smoke: bad box","newsletter":"true","email":"smoke-bad@example.org"}')" 400 "feedback newsletter must be a boolean"
expect "$(FB '{"text":"smoke: no address","newsletter":true}')" 400 "feedback newsletter without email"
[ ! -s "$SUBLOG" ] && echo "  ok   nothing reached the subscriber so far" || { echo "  FAIL the subscriber received something it should not have" >&2; cat "$SUBLOG" >&2; exit 1; }
expect "$(FB '{"text":"smoke: newsletter opt-in","email":"smoke-newsletter@example.org","notify":true,"newsletter":true}')" 204 "feedback newsletter:true"
RECEIVED=$(cat "$SUBLOG")
echo "  fake subscriber received: $RECEIVED"
case "$RECEIVED" in
  'POST /subscribe {"email":"smoke-newsletter@example.org","project":"questhub","source":"trustweb","gdpr":true}') echo "  ok   exactly one forwarded opt-in, join-form body" ;;
  *) echo "  FAIL unexpected forward" >&2; exit 1 ;;
esac
kill $SUBPID 2>/dev/null || true; wait $SUBPID 2>/dev/null || true
if ss -ltn 2>/dev/null | grep -q ":$SUBPORT "; then echo "  FAIL the fake subscriber is still listening" >&2; exit 1; else echo "  ok   fake subscriber stopped, port $SUBPORT free"; fi
echo "transcription (credential loaded or not, but not switched on): not configured"
expect "$(code -H "$H" -X POST -H "X-Account: $ACC" -H "X-Write-Token: $TOK" -H 'X-Audio-Seconds: 5' -H 'Content-Type: audio/webm' --data-binary @/tmp/tw_smoke.bin $B/transcribe)" 503 "POST /transcribe"
rm -f /tmp/tw_smoke.bin
echo "SMOKE OK"
SMOKE
}

remote_state() { # label
  echo "-------- $1"
  rsh 'free -m; echo; df -h / | tail -n 2'
}

install_code() { # $1 = remote code dir
  local dest="$1" stage="/tmp/twdeploy.$TS" f
  echo "install code -> $dest"
  if [ "$DRY" = 1 ]; then
    echo "[dry-run] scp $(cd "$SRC_DIR" && ls ./*.mjs | tr '\n' ' ') -> questhub:$stage"
    echo "[dry-run] ssh questhub: back up existing $dest/*.mjs to *.bak.$TS, install -m 0644 into $dest, chcon -R -t usr_t $dest"
    return
  fi
  rsh "mkdir -p $stage"
  for f in "$SRC_DIR"/*.mjs; do "${SSHENV[@]}" scp -q "$f" "questhub:$stage/"; done
  rsh "set -e; sudo install -d -m 0755 $dest
       for f in $dest/*.mjs; do [ -e \"\$f\" ] && sudo cp -p \"\$f\" \"\$f.bak.$TS\"; done
       sudo install -m 0644 $stage/*.mjs $dest/
       rm -rf $stage
       sudo chcon -R -t usr_t $dest
       ls -Z $dest | head -n 20"
  if [ "${TW_TEST_BREAK:-0}" = 1 ]; then
    echo "TW_TEST_BREAK=1 (test hook): corrupting the installed $dest/server.mjs to exercise the rollback"
    rsh "echo 'this is not javascript (' | sudo tee -a $dest/server.mjs >/dev/null"
  fi
}

# Puts the code and the unit back as they were before this run (the .bak.$TS copies made by install_code / install_unit),
# restarts, and checks health. $1 = unit name, $2 = suffix, $3 = port.
rollback() {
  local unit="$1" s="$2" port="$3" dest="/opt/trustweb-backup$2" file="/etc/systemd/system/$1.service"
  echo "ROLLBACK: restoring $dest/*.mjs.bak.$TS and $file.bak.$TS" >&2
  rsh "set -e
       for b in $dest/*.mjs.bak.$TS; do [ -e \"\$b\" ] && sudo cp -p \"\$b\" \"\${b%.bak.$TS}\"; done || true
       [ -e $file.bak.$TS ] && sudo cp -p $file.bak.$TS $file || true
       sudo systemctl daemon-reload && sudo systemctl reset-failed $unit && sudo systemctl restart $unit && sleep 2
       curl -fsS -H 'Host: app.idea2.site' http://127.0.0.1:$port/health && echo '  <- health after rollback'" >&2 || echo "ROLLBACK FAILED: restore by hand (see the report recipe)" >&2
}

install_unit() { # $1 = unit name, $2 = suffix, $3 = port, $4 = mem
  local unit="$1" file="/etc/systemd/system/$1.service" cred=0 berget=0
  echo "systemd unit $file (written in place with tee, never mv from /tmp)"
  if [ "$DRY" = 1 ]; then
    echo "[dry-run] LoadCredential=orkey:$CRED_FILE and LoadCredential=berget:$BERGET_CRED_FILE are each written only if 'sudo test -e <file>' succeeds on questhub (a missing file would stop the unit); both shown here as if present:"
    echo "[dry-run] unit text:"; unit_text "$2" "$3" "$4" 1 1 | sed 's/^/    /'
    echo "[dry-run] then: daemon-reload, enable, restart, health check on 127.0.0.1:$3; on failure the code and unit are rolled back from their .bak.$TS copies"
    return
  fi
  if rsh "sudo test -e $CRED_FILE"; then cred=1; echo "  OpenRouter credential file present on questhub: LoadCredential=orkey line written"; else echo "  $CRED_FILE is missing on questhub: no LoadCredential=orkey line (no OpenRouter fallback)" >&2; fi
  if rsh "sudo test -e $BERGET_CRED_FILE"; then berget=1; echo "  Berget credential file present on questhub: LoadCredential=berget line written"; else echo "  $BERGET_CRED_FILE is missing on questhub: no LoadCredential=berget line (Berget not available yet, see the README)" >&2; fi
  rsh "[ -e $file ] && sudo cp -p $file $file.bak.$TS || true"
  unit_text "$2" "$3" "$4" "$cred" "$berget" | rsh "sudo tee $file >/dev/null && sudo chcon -t systemd_unit_file_t $file"
  rsh "sudo systemctl daemon-reload && sudo systemctl enable $unit && sudo systemctl reset-failed $unit && sudo systemctl restart $unit" || true
  sleep 2
  if rsh "curl -fsS -H 'Host: app.idea2.site' http://127.0.0.1:$3/health" >/dev/null 2>&1; then
    echo "  health ok on 127.0.0.1:$3"
  else
    echo "the unit did not come up healthy" >&2
    rsh "sudo journalctl -u $unit -n 8 --no-pager | cut -c1-200" >&2 || true
    rollback "$unit" "$2" "$3"
    exit 1
  fi
}

check_data_labels() { # $1 = suffix
  local s="$1"
  echo "data dir labels (production uses var_lib_t)"
  if [ "$DRY" = 1 ]; then echo "[dry-run] sudo ls -Zd /var/lib/private/trustweb-backup$s /var/lib/private/trustweb-hosted$s; chcon -R -t var_lib_t if different"; return; fi
  rsh "set -e
       for d in /var/lib/private/trustweb-backup$s /var/lib/private/trustweb-hosted$s; do
         t=\$(sudo ls -Zd \$d | awk '{print \$1}')
         echo \"  \$d \$t\"
         case \"\$t\" in *:var_lib_t:*) ;; *) sudo chcon -R -t var_lib_t \$d; echo '  relabelled to var_lib_t' ;; esac
       done"
}

do_staging() {
  echo "STAGING: unit trustweb-backup-staging on 127.0.0.1:8970, data /var/lib/trustweb-backup-staging + /var/lib/trustweb-hosted-staging"
  if [ "$DRY" = 1 ]; then
    echo "[dry-run] ssh questhub: free -m; df -h /"
  else
    remote_state "BEFORE (free -m, df -h)"
  fi
  install_code /opt/trustweb-backup-staging
  install_unit trustweb-backup-staging -staging 8970 128M
  check_data_labels -staging
  echo "smoke test over ssh (curl against 127.0.0.1:8970)"
  if [ "$DRY" = 1 ]; then
    echo "[dry-run] smoke script:"; smoke_script | sed 's/^/    /'
  else
    smoke_script | rsh "bash -s -- 8970 8979"
    rsh 'systemctl show trustweb-backup-staging -p MemoryCurrent -p MemoryMax'
  fi
  if [ "$KEEP" = 1 ]; then
    echo "--keep: staging unit left RUNNING (stop it: ssh questhub 'sudo systemctl disable --now trustweb-backup-staging')"
  elif [ "$DRY" = 1 ]; then
    echo "[dry-run] ssh questhub: sudo systemctl disable --now trustweb-backup-staging"
  else
    rsh 'sudo systemctl disable --now trustweb-backup-staging && echo "staging unit stopped and disabled: $(systemctl is-active trustweb-backup-staging || true)"'
  fi
  if [ "$DRY" != 1 ]; then remote_state "AFTER (free -m, df -h)"; fi
}

install_caddy_routes() {
  echo "Caddy: handle /hosted/*, /transcribe, /feedback inside app.idea2.site, before the relay block"
  if [ "$DRY" = 1 ]; then echo "[dry-run] snippet:"; caddy_snippet | sed 's/^/    /'; return; fi
  caddy_snippet | rsh "cat > /tmp/twcaddy.$TS"
  rsh "TS=$TS bash -s" <<'REMOTE'
set -euo pipefail
CF=/etc/caddy/Caddyfile
if sudo grep -q "handle /hosted/\*" "$CF"; then
  echo "Caddy routes already present, unchanged"; rm -f /tmp/twcaddy.$TS; exit 0
fi
BAK="$CF.bak.$(date +%Y%m%d_%H%M%S)"
sudo cp "$CF" "$BAK"
sudo awk -v snippet="/tmp/twcaddy.$TS" '
  /^app\.idea2\.site \{/ { inapp = 1 }
  inapp && !done && /^\thandle \/relay\/\* \{/ {
    while ((getline line < snippet) > 0) print line
    done = 1
  }
  { print }
' "$BAK" | sudo tee "$CF.new" >/dev/null
rm -f /tmp/twcaddy.$TS
# The anchor (app.idea2.site's "handle /relay/* {") must have been found: otherwise the file would validate unchanged
# and the routes would silently be missing.
if ! sudo grep -q "handle /hosted/\*" "$CF.new"; then
  sudo rm -f "$CF.new"; echo "anchor 'handle /relay/* {' not found inside app.idea2.site: Caddyfile unchanged (backup at $BAK)" >&2; exit 1
fi
if ! sudo caddy validate --config "$CF.new" --adapter caddyfile >/dev/null 2>&1; then
  sudo rm -f "$CF.new"; echo "caddy validate FAILED, Caddyfile unchanged (backup at $BAK)" >&2; exit 1
fi
sudo cp "$CF.new" "$CF" && sudo rm -f "$CF.new"
if sudo systemctl reload caddy; then
  echo "Caddy reloaded (backup at $BAK)"
else
  echo "caddy reload FAILED: restoring $BAK and reloading the old config" >&2
  sudo cp "$BAK" "$CF"
  sudo systemctl reload caddy || echo "reload of the restored Caddyfile failed too: check 'journalctl -u caddy'" >&2
  exit 1
fi
REMOTE
}

do_production() {
  echo "PRODUCTION: unit trustweb-backup on 127.0.0.1:8960 (orchestrator only)"
  [ "$DRY" = 1 ] || remote_state "BEFORE (free -m, df -h)"
  install_code /opt/trustweb-backup
  install_unit trustweb-backup "" 8960 256M
  check_data_labels ""
  install_caddy_routes
  if [ "$DRY" = 1 ]; then echo "[dry-run] verify: curl https://app.idea2.site/backup/health, /hosted/status, foreign Origin -> 403"; return; fi
  echo "verify through the public origin"
  sleep 1
  curl -fsS https://app.idea2.site/backup/health && echo "  <- /backup/health"
  curl -fsS https://app.idea2.site/hosted/status && echo "  <- /hosted/status"
  code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Origin: https://evil.example.com' https://app.idea2.site/backup/health)
  echo "foreign Origin -> $code (expect 403)"
  code=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS -H 'Origin: https://idea2.site' https://app.idea2.site/feedback)
  echo "feedback preflight from idea2.site -> $code (expect 204)"
  remote_state "AFTER (free -m, df -h)"
}

echo "… deploy_trustweb_backup running ($MODE$([ "$DRY" = 1 ] && echo ", dry-run")) …"
echo "--------"
case "$MODE" in
  print-caddy) caddy_snippet; exit 0 ;;
esac
[ -d "$SRC_DIR" ] || { echo "missing $SRC_DIR" >&2; exit 1; }
[ "$DRY" = 1 ] || ssh-add --apple-load-keychain >/dev/null 2>&1 || true
case "$MODE" in
  staging) do_staging ;;
  production) do_production ;;
esac
echo "--------"
echo "done ($MODE)"
