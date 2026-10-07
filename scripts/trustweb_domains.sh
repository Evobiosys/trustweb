#!/usr/bin/env bash
#
# TrustInTheWeb domains on Infomaniak DNS and the questhub server (wave 3, 2026-10-07).
#
#   trustintheweb.org      the website (migrated from idea2.site/trustweb)  /srv/questhub-static/trustintheweb-org
#   app.trustintheweb.org  the web app at its root (/)                      /srv/questhub-static/app-trustintheweb
#   trustintheweb.com      the hosting site                                 /srv/questhub-static/trustintheweb-com
#   trustweb.one           301 -> https://trustintheweb.org{uri}
#   www.<each>             301 -> the apex
#
# Steps (each idempotent; --dry-run prints and changes nothing):
#   ./scripts/trustweb_domains.sh dns [--dry-run]           A records apex/www/app -> questhub (TTL 300); never touches other records
#   ./scripts/trustweb_domains.sh caddy-sites [--dry-run]   the site blocks above (scripts/trustweb_domains_caddy.py sites)
#   ./scripts/trustweb_domains.sh backup-env [--dry-run]    trustweb-backup: ALLOWED_HOSTS + FEEDBACK_ORIGINS for the new hosts
#   ./scripts/trustweb_domains.sh placeholders [--dry-run]  trustintheweb.com index (only while that dir is empty) and
#                                                           evobiosys.org/trustintheweb/ (only while absent)
#   ./scripts/trustweb_domains.sh redirects [--dry-run]     idea2.site/trustweb/*, /tw, /trust-web -> trustintheweb.org;
#                                                           evobiosys.org /tw, /trustweb -> /trustintheweb/. Refused until
#                                                           https://trustintheweb.org/ answers 200 with the migrated site.
#   ./scripts/trustweb_domains.sh verify                    every host and redirect, from questhub (curl), exact targets
#
# The site and the app are built and pushed by their own scripts:
#   TW_SITE_HOST=trustintheweb.org TW_SERVICES_LIVE=1 ./scripts/build_tw_front_door.sh
#   TW_APP_TARGET=trustintheweb ONLY_TRUSTWEB=1 ./scripts/deploy_wot.sh
#
# Infomaniak API: the token is the one the memory note ref_infomaniak_api names (Keychain service
# infomaniak-api), read once per call into the environment of a node process, never printed.
# Every API call is appended to $TW_DOMAINS_LOG (default DEVLOG of the wave) without the token.
#
# Server changes follow the house rules: every file changed gets a .bak.<timestamp> first, the
# Caddyfile is validated (`caddy validate`) before it is installed, the live file must still be
# byte-identical to the copy the change was computed from, and a failed reload restores the backup.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSHENV=(env SSH_ASKPASS="$HOME/.ssh/questhub-jump-askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0)
QUESTHUB_IP=83.228.207.220
TTL=300
STATIC=/srv/questhub-static
REF=/srv/questhub-static/wot-app   # a directory whose SELinux context is known good (see deploy_wot.sh)
COM_DIR=$STATIC/trustintheweb-com
ORG_DIR=$STATIC/trustintheweb-org
APP_DIR=$STATIC/app-trustintheweb
EVO_PAGE_DIR=$STATIC/evobiosys-org/trustintheweb
DROPIN_DIR=/etc/systemd/system/trustweb-backup.service.d
DROPIN=$DROPIN_DIR/10-trustweb-domains.conf
TS="$(date +%Y%m%d_%H%M%S)"
LOG="${TW_DOMAINS_LOG:-/Users/personal/Documents/agents/4claude/DEVLOG/trustweb-wave-1733/wave3/infra-domains_api-calls.log}"

# zone -> the record names (source) that get an A record; "" is the apex.
ZONES=(trustintheweb.org trustintheweb.com trustweb.one)
records_of() {
  case "$1" in
    trustintheweb.org) echo ". www app" ;;
    trustintheweb.com|trustweb.one) echo ". www" ;;
    *) echo "unknown zone $1" >&2; return 1 ;;
  esac
}

ALLOWED_HOSTS="app.idea2.site,app.trustintheweb.org"
FEEDBACK_ORIGINS="https://idea2.site,https://app.idea2.site,https://trustintheweb.org,https://trustintheweb.com,https://app.trustintheweb.org"

usage() { sed -n '2,33p' "$0" >&2; exit 2; }
[ $# -ge 1 ] || usage
CMD="$1"; shift
DRY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    *) echo "unknown option: $arg" >&2; usage ;;
  esac
done

rsh() { "${SSHENV[@]}" ssh -o ConnectTimeout=30 questhub "$@"; }
say() { echo "  $*"; }
dry() { [ "$DRY" = 1 ]; }

# ---------------------------------------------------------------- Infomaniak API
# ik METHOD PATH [JSON] -> prints the response body; non-zero exit unless result == success.
ik() {
  local token
  token="$(security find-generic-password -s infomaniak-api -w 2>/dev/null)" || { echo "Infomaniak token not in the Keychain (service infomaniak-api): stop" >&2; return 3; }
  IK_TOKEN="$token" IK_LOG="$LOG" node -e '
    const fs = require("fs")
    const [method, p, body] = process.argv.slice(1)
    const init = { method, headers: { Authorization: "Bearer " + process.env.IK_TOKEN, "Content-Type": "application/json" }, signal: AbortSignal.timeout(30000) }
    if (body) init.body = body
    fetch("https://api.infomaniak.com" + p, init).then(async (r) => {
      const text = await r.text()
      fs.appendFileSync(process.env.IK_LOG, `${new Date().toISOString()} ${method} ${p} ${body ?? ""} -> HTTP ${r.status}\n`)
      process.stdout.write(text)
      let ok = false
      try { ok = JSON.parse(text).result === "success" } catch {}
      process.exit(ok ? 0 : 1)
    }, (e) => { console.error(String(e)); process.exit(1) })
  ' "$@"
}

# The A records of one name in a zone, as "id target" lines.
a_records() { # zone source
  ik GET "/2/zones/$1/records" | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      for (const r of JSON.parse(s).data) if (r.type === "A" && r.source === process.argv[1]) console.log(r.id, r.target)
    })' "$2"
}

cmd_dns() {
  echo "DNS: A -> $QUESTHUB_IP, TTL $TTL (other records untouched)"
  local zone name existing body
  for zone in "${ZONES[@]}"; do
    for name in $(records_of "$zone"); do
      existing="$(a_records "$zone" "$name")"
      local fqdn; if [ "$name" = . ]; then fqdn="$zone"; else fqdn="$name.$zone"; fi
      if echo "$existing" | grep -q " $QUESTHUB_IP\$"; then say "$fqdn A $QUESTHUB_IP already set"; continue; fi
      if [ -n "$existing" ]; then say "$fqdn has another A record ($existing): left alone, decide by hand" >&2; continue; fi
      body="{\"type\":\"A\",\"source\":\"$([ "$name" = . ] && echo "" || echo "$name")\",\"target\":\"$QUESTHUB_IP\",\"ttl\":$TTL}"
      if dry; then say "[dry-run] POST /2/zones/$zone/records $body"; continue; fi
      ik POST "/2/zones/$zone/records" "$body" >/dev/null && say "$fqdn A $QUESTHUB_IP created" || { echo "creating $fqdn failed" >&2; return 1; }
    done
  done
}

# ---------------------------------------------------------------- Caddy
# caddy_change TRANSFORM... : fetch the live Caddyfile, transform it locally, validate on questhub,
# install only if the live file is still the one fetched, reload, restore the backup on failure.
caddy_change() {
  local work; work="$(mktemp -d /tmp/tw-domains.XXXXXX)"
  rsh 'sudo cat /etc/caddy/Caddyfile' > "$work/live"
  local live_sha; live_sha="$(shasum -a 256 "$work/live" | cut -d' ' -f1)"
  local result; result="$(python3 -I "$REPO/scripts/trustweb_domains_caddy.py" --in "$work/live" --out "$work/new" "$@")"
  if [ "$result" = unchanged ]; then say "Caddyfile already has: $*"; rm -rf "$work"; return 0; fi
  say "Caddyfile change ($*):"
  diff -u "$work/live" "$work/new" | sed 's/^/    /' | head -n 400 || true
  if dry; then say "[dry-run] not installed"; rm -rf "$work"; return 0; fi
  "${SSHENV[@]}" scp -q "$work/new" "questhub:/tmp/Caddyfile.tw-domains.$TS"
  rm -rf "$work"
  rsh "TS=$TS LIVE_SHA=$live_sha bash -s" <<'REMOTE'
set -euo pipefail
CF=/etc/caddy/Caddyfile
NEW=/tmp/Caddyfile.tw-domains.$TS
cleanup() { rm -f "$NEW"; }
trap cleanup EXIT
now_sha=$(sudo sha256sum "$CF" | cut -d' ' -f1)
if [ "$now_sha" != "$LIVE_SHA" ]; then echo "the live Caddyfile changed while this ran: nothing installed, run again" >&2; exit 1; fi
if ! sudo caddy validate --config "$NEW" --adapter caddyfile >/tmp/tw-domains-validate.$TS 2>&1; then
  tail -n 5 /tmp/tw-domains-validate.$TS >&2; rm -f /tmp/tw-domains-validate.$TS
  echo "caddy validate FAILED: Caddyfile unchanged" >&2; exit 1
fi
rm -f /tmp/tw-domains-validate.$TS
BAK="$CF.bak.$TS"
sudo cp -p "$CF" "$BAK"
sudo cp "$NEW" "$CF"
if sudo systemctl reload caddy; then
  echo "  Caddy reloaded (backup $BAK)"
else
  echo "caddy reload FAILED: restoring $BAK" >&2
  sudo cp -p "$BAK" "$CF"
  sudo systemctl reload caddy || echo "reload of the restored file failed too: journalctl -u caddy" >&2
  exit 1
fi
REMOTE
}

cmd_caddy_sites() {
  echo "Caddy: site blocks for trustintheweb.org, app.trustintheweb.org, trustintheweb.com, trustweb.one (+ www)"
  if ! dry; then
    # Each root must exist with the served context before Caddy points at it (an absent root 404s, a
    # var_t one 403s). Empty dirs are created only; content comes from the build/deploy scripts.
    rsh "set -e; for d in $ORG_DIR $APP_DIR $COM_DIR; do sudo install -d -o almalinux -g almalinux -m 0755 \$d; sudo chcon --reference=$REF \$d; done; ls -dZ $ORG_DIR $APP_DIR $COM_DIR"
  fi
  caddy_change sites
}

# ---------------------------------------------------------------- trustweb-backup environment
# A systemd drop-in, not a rewrite of the unit: scripts/deploy_trustweb_backup.sh (another agent's
# file this wave) rewrites trustweb-backup.service on every --production run; a drop-in survives that,
# and its Environment= lines win over the unit's own (drop-ins are applied after the unit file).
cmd_backup_env() {
  echo "trustweb-backup: ALLOWED_HOSTS=$ALLOWED_HOSTS"
  echo "                 FEEDBACK_ORIGINS=$FEEDBACK_ORIGINS"
  local text="# TrustInTheWeb domains (wave 3, scripts/trustweb_domains.sh backup-env). Overrides the unit's own values.
[Service]
Environment=ALLOWED_HOSTS=$ALLOWED_HOSTS
Environment=FEEDBACK_ORIGINS=$FEEDBACK_ORIGINS"
  if dry; then say "[dry-run] $DROPIN:"; echo "$text" | sed 's/^/    /'; return 0; fi
  if [ "$(rsh "sudo cat $DROPIN 2>/dev/null || true")" = "$text" ]; then say "drop-in already in place"; return 0; fi
  echo "  backups before (fingerprint of /var/lib/private/trustweb-backup):"
  local before after
  before="$(backup_fingerprint)"; say "$before"
  rsh "set -e; sudo install -d -m 0755 $DROPIN_DIR; [ -e $DROPIN ] && sudo cp -p $DROPIN $DROPIN.bak.$TS || true"
  printf '%s\n' "$text" | rsh "sudo tee $DROPIN >/dev/null && sudo chcon -t systemd_unit_file_t $DROPIN_DIR $DROPIN"
  rsh "sudo systemctl daemon-reload && sudo systemctl restart trustweb-backup"
  sleep 2
  local ok=1 host
  for host in app.idea2.site app.trustintheweb.org; do
    if [ "$(rsh "curl -fsS -H 'Host: $host' http://127.0.0.1:8960/health" 2>/dev/null)" = ok ]; then say "health ok with Host: $host"; else say "health FAILED with Host: $host" >&2; ok=0; fi
  done
  after="$(backup_fingerprint)"; say "backups after: $after"
  [ "$before" = "$after" ] && say "backups byte-identical before/after" || { say "backup fingerprint CHANGED" >&2; ok=0; }
  if [ "$ok" = 0 ]; then
    echo "rolling the drop-in back" >&2
    rsh "if [ -e $DROPIN.bak.$TS ]; then sudo cp -p $DROPIN.bak.$TS $DROPIN; else sudo rm -f $DROPIN; fi; sudo systemctl daemon-reload && sudo systemctl restart trustweb-backup"
    return 1
  fi
  rsh "systemctl show trustweb-backup -p Environment | tr ' ' '\n' | grep -E '^(Environment=)?(ALLOWED_HOSTS|FEEDBACK_ORIGINS)='"
}

backup_fingerprint() {
  rsh "sudo find /var/lib/private/trustweb-backup -type f -printf '%P %s\n' | sort > /tmp/twfp.$TS; sudo find /var/lib/private/trustweb-backup -type f -exec sha256sum {} + | sort | sha256sum | cut -c1-16; echo \"files=\$(wc -l < /tmp/twfp.$TS)\"; rm -f /tmp/twfp.$TS" | tr '\n' ' '
}

# ---------------------------------------------------------------- placeholders
placeholder_html() { # title, line, link
  cat <<HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>$1</title>
<style>
  :root { color-scheme: light dark; --bg: #F2EBDC; --ink: #241B2E; --accent: #3B1163; }
  @media (prefers-color-scheme: dark) { :root { --bg: #120C1A; --ink: #EDE6F2; --accent: #C9A6F2; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--ink);
         font-family: "Seravek", "Avenir Next", "Segoe UI", system-ui, sans-serif; padding: 0 16px; }
  main { max-width: 34rem; text-align: center; line-height: 1.6; }
  h1 { font-family: Optima, Candara, "Gill Sans", sans-serif; font-weight: 600; font-size: 1.7rem; margin: 0 0 .5rem; }
  a { color: var(--accent); font-weight: 600; }
</style>
</head>
<body>
<main>
  <h1>$1</h1>
  <p>$2</p>
  <p><a href="$3">$3</a></p>
</main>
</body>
</html>
HTML
}

push_placeholder() { # dir, title, line, link, only_if (empty|absent)
  local dir="$1" state
  state="$(rsh "if [ ! -e $dir ]; then echo absent; elif [ -z \"\$(ls -A $dir)\" ]; then echo empty; else echo full; fi")"
  if [ "$state" = full ]; then say "$dir has content: left alone"; return 0; fi
  if [ "$5" = absent ] && [ "$state" != absent ]; then say "$dir exists: left alone"; return 0; fi
  if dry; then say "[dry-run] $dir/index.html: $2 / $3"; return 0; fi
  rsh "sudo install -d -o almalinux -g almalinux -m 0755 $dir"
  placeholder_html "$2" "$3" "$4" | rsh "cat > $dir/index.html && chmod 0644 $dir/index.html && sudo chcon -R --reference=$REF $dir"
  say "placeholder -> $dir/index.html"
}

cmd_placeholders() {
  echo "placeholders (never over existing content)"
  push_placeholder "$COM_DIR" "TrustInTheWeb.com" "Hosting for TrustWeb: page in the making." "https://trustintheweb.org" empty
  push_placeholder "$EVO_PAGE_DIR" "TrustWeb and EvoBioSys" "TrustWeb and EvoBioSys: page in the making, see" "https://trustintheweb.org" absent
}

# ---------------------------------------------------------------- redirects
cmd_redirects() {
  echo "redirects: idea2.site/trustweb + /tw -> trustintheweb.org; evobiosys.org /tw + /trustweb -> /trustintheweb/"
  local probe
  probe="$(rsh "curl -sS --max-time 15 https://trustintheweb.org/ -o /tmp/twprobe.$TS -w '%{http_code}'; grep -c 'trustintheweb.org' /tmp/twprobe.$TS || true; rm -f /tmp/twprobe.$TS" | tr '\n' ' ')"
  case "$probe" in
    "200 "[1-9]*) say "https://trustintheweb.org/ answers 200 with the migrated site ($probe)" ;;
    *) echo "https://trustintheweb.org/ is not serving the migrated site yet ($probe): redirects refused" >&2; return 1 ;;
  esac
  rsh "test -s $EVO_PAGE_DIR/index.html" || { echo "evobiosys.org/trustintheweb/ has no page yet: run placeholders first" >&2; return 1; }
  caddy_change idea2-redirect evobiosys-redirect
}

# ---------------------------------------------------------------- verify
# From questhub (this Mac's curl is LuLu-blocked): "url expected-code [expected-location]".
VERIFY=(
  "https://trustintheweb.org/ 200"
  "https://trustintheweb.org/faq.html 200"
  "https://www.trustintheweb.org/faq.html 301 https://trustintheweb.org/faq.html"
  "https://app.trustintheweb.org/ 200"
  "https://app.trustintheweb.org/demo/ 200"
  "https://app.trustintheweb.org/manifest.json 200"
  "https://app.trustintheweb.org/hosted/status 200"
  "https://app.trustintheweb.org/backup/health 200"
  "https://trustintheweb.com/ 200"
  "https://www.trustintheweb.com/ 301 https://trustintheweb.com/"
  "https://trustweb.one/ 301 https://trustintheweb.org/"
  "https://www.trustweb.one/faq.html 301 https://trustintheweb.org/faq.html"
  "https://app.idea2.site/trustweb/ 200"
  "https://app.idea2.site/hosted/status 200"
)
VERIFY_REDIRECTS=(
  "https://idea2.site/trustweb 301 https://trustintheweb.org/"
  "https://idea2.site/trustweb/ 301 https://trustintheweb.org/"
  "https://idea2.site/trustweb/faq.html 301 https://trustintheweb.org/faq.html"
  "https://idea2.site/tw 301 https://trustintheweb.org/"
  "https://idea2.site/trustweb/draft/ 200"
  "https://evobiosys.org/tw 301 https://evobiosys.org/trustintheweb/"
  "https://evobiosys.org/trustweb/ 301 https://evobiosys.org/trustintheweb/"
  "https://evobiosys.org/trustintheweb/ 200"
)

cmd_verify() {
  local fail=0 line url want loc got
  local checks=("${VERIFY[@]}")
  if rsh "sudo grep -q 'TrustInTheWeb migration' /etc/caddy/Caddyfile"; then checks+=("${VERIFY_REDIRECTS[@]}"); else say "(redirects not installed yet: their checks skipped)"; fi
  for line in "${checks[@]}"; do
    read -r url want loc <<<"$line"
    got="$(rsh "curl -sS -o /dev/null --max-time 20 -w '%{http_code} %{redirect_url}' '$url'" 2>/dev/null || echo "ERR")"
    local code="${got%% *}" target="${got#* }"
    if [ "$code" = "$want" ] && { [ -z "${loc:-}" ] || [ "$target" = "$loc" ]; }; then
      printf '  ok    %-50s %s %s\n' "$url" "$code" "${loc:+-> $target}"
    else
      printf '  FAIL  %-50s got %s, want %s %s\n' "$url" "$got" "$want" "${loc:-}"; fail=1
    fi
    loc=""
  done
  echo "TLS (issuer, notAfter):"
  local host
  for host in trustintheweb.org www.trustintheweb.org app.trustintheweb.org trustintheweb.com www.trustintheweb.com trustweb.one www.trustweb.one; do
    say "$host: $(rsh "echo | openssl s_client -connect $host:443 -servername $host 2>/dev/null | openssl x509 -noout -issuer -enddate 2>/dev/null | tr '\n' ' '" || echo none)"
  done
  return "$fail"
}

echo "... trustweb_domains script running ($CMD$(dry && echo ", dry-run")) ..."
echo "--------"
case "$CMD" in
  dns) cmd_dns ;;
  caddy-sites) cmd_caddy_sites ;;
  backup-env) cmd_backup_env ;;
  placeholders) cmd_placeholders ;;
  redirects) cmd_redirects ;;
  verify) cmd_verify ;;
  *) usage ;;
esac
echo "--------"
echo "done ($CMD)"
