#!/bin/bash
# Install / update the TrustWeb encrypted-backup service on questhub and route
# app.idea2.site/backup/* to it. Idempotent: re-running updates server.mjs and
# leaves an existing Caddy block alone.
#
#   ./scripts/deploy_trustweb_backup.sh
#
# Same SSH recipe as deploy_wot.sh (questhub needs publickey + password; the
# askpass helper reads both from the login Keychain). Safety protocol:
# timestamped Caddyfile backup, `caddy validate` before reload, restore the
# backup if validation fails. The app hides its backup card until
# https://app.idea2.site/backup/health answers "ok", so the static app and this
# service can be deployed in either order.
set -euo pipefail
echo "… deploy_trustweb_backup running …"
echo "--------"

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../services/trustweb-backup/server.mjs"
SSHENV=(env SSH_ASKPASS="$HOME/.ssh/questhub-jump-askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0)
rsh() { "${SSHENV[@]}" ssh questhub "$@"; }

[ -f "$SRC" ] || { echo "missing $SRC" >&2; exit 1; }
ssh-add --apple-load-keychain >/dev/null 2>&1 || true

echo "1/4 server.mjs -> /opt/trustweb-backup/"
"${SSHENV[@]}" scp -q "$SRC" questhub:/tmp/trustweb-backup-server.mjs
rsh 'sudo install -d -m 0755 /opt/trustweb-backup && sudo install -m 0644 /tmp/trustweb-backup-server.mjs /opt/trustweb-backup/server.mjs && rm -f /tmp/trustweb-backup-server.mjs && sudo restorecon -R /opt/trustweb-backup'

echo "2/4 systemd unit"
rsh 'sudo tee /etc/systemd/system/trustweb-backup.service >/dev/null' <<'UNIT'
[Unit]
Description=TrustWeb encrypted backup store (ciphertext only; see web-of-trust services/trustweb-backup)
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/trustweb-backup/server.mjs
Environment=HOST=127.0.0.1
Environment=PORT=8960
Environment=BACKUP_DIR=/var/lib/trustweb-backup
Environment=ALLOWED_HOSTS=app.idea2.site
DynamicUser=yes
StateDirectory=trustweb-backup
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
MemoryMax=256M

[Install]
WantedBy=multi-user.target
UNIT
rsh 'sudo systemctl daemon-reload && sudo systemctl enable --now trustweb-backup && sudo systemctl restart trustweb-backup && sleep 1 && curl -fsS http://127.0.0.1:8960/health'
echo

echo "3/4 Caddy: handle /backup/* inside app.idea2.site, before the relay block"
rsh 'bash -s' <<'REMOTE'
set -euo pipefail
CF=/etc/caddy/Caddyfile
if sudo grep -q "handle /backup/\*" "$CF"; then
  echo "Caddy block already present, unchanged"
  exit 0
fi
BAK="$CF.bak.$(date +%Y%m%d_%H%M%S)"
sudo cp "$CF" "$BAK"
# Insert right before the first "handle /relay/* {" that follows "app.idea2.site {".
sudo awk '
  /^app\.idea2\.site \{/ { inapp = 1 }
  inapp && !done && /^\thandle \/relay\/\* \{/ {
    print "\t# --- TrustWeb encrypted backup (2026-10-05) ---"
    print "\t# Ciphertext only, made on the phone (apps/trustweb/src/backup.ts);"
    print "\t# trustweb-backup.service on 127.0.0.1:8960. The blob id in the path"
    print "\t# is a secret: keep /backup/ out of any access log."
    print "\thandle /backup/* {"
    print "\t\trequest_body {"
    print "\t\t\tmax_size 1100KB"
    print "\t\t}"
    print "\t\treverse_proxy 127.0.0.1:8960"
    print "\t}"
    done = 1
  }
  { print }
' "$BAK" | sudo tee "$CF.new" >/dev/null
if sudo caddy validate --config "$CF.new" --adapter caddyfile >/dev/null 2>&1; then
  sudo mv "$CF.new" "$CF" && sudo systemctl reload caddy && echo "Caddy reloaded (backup at $BAK)"
else
  sudo rm -f "$CF.new"; echo "caddy validate FAILED, Caddyfile unchanged (backup at $BAK)" >&2; exit 1
fi
REMOTE

echo "4/4 verify through the public origin"
sleep 1
curl -fsS https://app.idea2.site/backup/health && echo "  <- https://app.idea2.site/backup/health"
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Origin: https://evil.example.com' https://app.idea2.site/backup/health)
echo "foreign Origin -> $code (expect 403)"
echo "--------"
echo "all good"
