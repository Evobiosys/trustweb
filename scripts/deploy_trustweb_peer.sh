#!/bin/bash
# Install / update the TrustWeb DEMO front-door peer on questhub (Swiss server)
# and publish its card next to the app. Idempotent.
#
#   ./scripts/deploy_trustweb_peer.sh              full deploy (bundle, unit, restart, card)
#   ./scripts/deploy_trustweb_peer.sh --card-only  republish only demo-peer.json
#   ./scripts/deploy_trustweb_peer.sh --off        stop the service and remove the card (rollback)
#
# Why --card-only exists: scripts/deploy_wot.sh clears the whole app directory
# (rm -rf app-idea2-trustweb/*), which also deletes demo-peer.json. Run
# --card-only after every app deploy, or the app stops offering the demo peer.
#
# The service (services/trustweb-peer, README.txt there): fictional demo
# inventory only, forwarding ON (an ask reaches the owner's phone once an owner
# has claimed the peer; see scripts/trustweb_peer_claim.sh), policy open.
# Same SSH recipe and unit hardening as deploy_trustweb_backup.sh.
set -euo pipefail
echo "... deploy_trustweb_peer running ..."
echo "--------"

MODE=full
case "${1:-}" in
  "") ;;
  --card-only) MODE=card ;;
  --off) MODE=off ;;
  *) echo "usage: $0 [--card-only|--off]" >&2; exit 2 ;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
PEER_DIR="$HERE/../services/trustweb-peer"
CARD_DIR=/srv/questhub-static/app-idea2-trustweb
REF=/srv/questhub-static/wot-app   # a directory whose SELinux context is known good (see deploy_wot.sh)
STATE=/var/lib/trustweb-peer
HOSTHDR='Host: 127.0.0.1:8961'
SSHENV=(env SSH_ASKPASS="$HOME/.ssh/questhub-jump-askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0)
rsh() { "${SSHENV[@]}" ssh questhub "$@"; }
ssh-add --apple-load-keychain >/dev/null 2>&1 || true

publish_card() {
  # The unit runs as a DynamicUser: its state dir is root-readable only.
  rsh "for i in 1 2 3 4 5 6 7 8 9 10; do curl -fsS -H '$HOSTHDR' http://127.0.0.1:8961/health >/dev/null 2>&1 && break; sleep 1; done;
       sudo cat $STATE/demo-peer.json | sudo tee $CARD_DIR/demo-peer.json >/dev/null &&
       sudo chmod a+r $CARD_DIR/demo-peer.json && sudo chcon --reference=$REF $CARD_DIR/demo-peer.json"
}

if [ "$MODE" = off ]; then
  echo "rollback: stop the peer, remove the card"
  rsh "sudo rm -f $CARD_DIR/demo-peer.json; sudo systemctl disable --now trustweb-peer"
  echo "card gone:  $(curl -s -o /dev/null -w '%{http_code}' https://app.idea2.site/trustweb/demo-peer.json) (expect 404 or the app's fallback page, no JSON)"
  echo "--------"; echo "peer off"; exit 0
fi

if [ "$MODE" = card ]; then
  echo "republish the card only"
  publish_card
else
  BUNDLE="$PEER_DIR/dist/peer.mjs"
  INV="$PEER_DIR/demo_inventory.json"
  [ -f "$BUNDLE" ] || { echo "missing $BUNDLE (run: sh services/trustweb-peer/build.sh)" >&2; exit 1; }
  [ -f "$INV" ] || { echo "missing $INV" >&2; exit 1; }

  echo "1/5 node on questhub (needs >= 22 for the global WebSocket)"
  rsh 'node -e "if (parseInt(process.versions.node) < 22 || typeof WebSocket !== \"function\") { console.error(\"node too old\"); process.exit(1) } console.log(process.version)"'

  echo "2/5 peer.mjs + demo_inventory.json -> /opt/trustweb-peer/"
  "${SSHENV[@]}" scp -q "$BUNDLE" questhub:/tmp/trustweb-peer.mjs
  "${SSHENV[@]}" scp -q "$INV" questhub:/tmp/trustweb-peer-inventory.json
  rsh 'sudo install -d -m 0755 /opt/trustweb-peer &&
       sudo install -m 0644 /tmp/trustweb-peer.mjs /opt/trustweb-peer/peer.mjs &&
       sudo install -m 0644 /tmp/trustweb-peer-inventory.json /opt/trustweb-peer/demo_inventory.json &&
       rm -f /tmp/trustweb-peer.mjs /tmp/trustweb-peer-inventory.json && sudo restorecon -R /opt/trustweb-peer'

  echo "3/5 systemd unit"
  rsh 'sudo tee /etc/systemd/system/trustweb-peer.service >/dev/null' <<'UNIT'
[Unit]
Description=TrustWeb demo front-door peer (fictional inventory; forwards asks to its owner; see web-of-trust services/trustweb-peer)
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/trustweb-peer/peer.mjs
Environment=TW_PEER_STATE=/var/lib/trustweb-peer
Environment=TW_PEER_INVENTORY=/opt/trustweb-peer/demo_inventory.json
Environment=TW_PEER_RELAY=https://app.idea2.site
Environment=TW_PEER_HEALTH_PORT=8961
Environment="TW_PEER_NAME=Demo inventory"
Environment=TW_PEER_FORWARD=1
Environment=TW_PEER_POLICY=open
DynamicUser=yes
StateDirectory=trustweb-peer
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

  echo "4/5 enable, restart, wait for health"
  rsh "sudo systemctl daemon-reload && sudo systemctl enable --now trustweb-peer && sudo systemctl restart trustweb-peer &&
       for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do curl -fsS -H '$HOSTHDR' http://127.0.0.1:8961/health >/dev/null 2>&1 && break; sleep 1; done;
       sleep 3; systemctl is-active trustweb-peer; curl -fsS -H '$HOSTHDR' http://127.0.0.1:8961/status"
  echo

  echo "5/5 publish the card next to the app"
  publish_card
fi

echo "verify through the public origin"
sleep 1
CARD="$(curl -fsS https://app.idea2.site/trustweb/demo-peer.json)"
echo "$CARD"
echo "$CARD" | python3 -c 'import json,sys; c=json.load(sys.stdin); assert c["did"].startswith("did:peer:") and c["id"] and c["name"]; print("card ok:", c["name"])'
echo "status:"
rsh "curl -fsS -H '$HOSTHDR' http://127.0.0.1:8961/status"
echo
echo "--------"
echo "all good (an owner is NOT bound yet: scripts/trustweb_peer_claim.sh)"
