#!/bin/bash
# Open the claim window of the TrustWeb demo peer on questhub and print the
# connect link the owner opens on his phone. The first phone that opens it
# within 10 minutes becomes the owner (asks to the peer are then forwarded to
# that phone for a live yes/no); later phones are askers.
#
#   ./scripts/trustweb_peer_claim.sh           open the window, print the link
#   ./scripts/trustweb_peer_claim.sh --close   close the window (restart, no claim file)
#   ./scripts/trustweb_peer_claim.sh --status  print /status
#   ./scripts/trustweb_peer_claim.sh --reset   forget the owner (re-claim afterwards)
#
# How: the peer reads <state>/claim-open ONLY at start, so opening = touch the
# file + restart the unit. The file is removed again right after the restart:
# the window then lives in the peer's memory for 10 minutes and a later crash
# restart or reboot cannot reopen it for the next stranger. Do not run the
# app's e2e test while a window is open: its test phone would become the owner.
set -euo pipefail
echo "... trustweb_peer_claim running ..."
echo "--------"

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
STATE=/var/lib/trustweb-peer
HOSTHDR='Host: 127.0.0.1:8961'
APP_URL=https://app.idea2.site/trustweb/
CARD_URL=https://app.idea2.site/trustweb/demo-peer.json
SSHENV=(env SSH_ASKPASS="$HOME/.ssh/questhub-jump-askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0)
rsh() { "${SSHENV[@]}" ssh questhub "$@"; }
ssh-add --apple-load-keychain >/dev/null 2>&1 || true
status() { rsh "curl -fsS -H '$HOSTHDR' http://127.0.0.1:8961/status"; echo; }
restart_and_wait() {
  rsh "sudo systemctl restart trustweb-peer;
       for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do curl -fsS -H '$HOSTHDR' http://127.0.0.1:8961/health >/dev/null 2>&1 && break; sleep 1; done"
}

case "${1:-}" in
  --status) status; exit 0 ;;
  --close)
    rsh "sudo rm -f $STATE/claim-open"; restart_and_wait; status; echo "window closed"; exit 0 ;;
  --reset)
    # Removes the owner block from state.json (0600, root-readable via sudo) and restarts.
    rsh "sudo python3 - <<'PY'
import json
p = '$STATE/state.json'
s = json.load(open(p)); s.pop('owner', None)
json.dump(s, open(p, 'w'))
PY
sudo rm -f $STATE/claim-open"
    restart_and_wait; status; echo "owner forgotten"; exit 0 ;;
  "") ;;
  *) echo "usage: $0 [--close|--status|--reset]" >&2; exit 2 ;;
esac

CUR="$(status)"
if echo "$CUR" | grep -q '"owner":true'; then
  echo "an owner is already bound. To claim again: $0 --reset, then $0" >&2
  exit 1
fi

CARD="$(curl -fsS "$CARD_URL")"
# Build the link first: a failure here must not leave a window open.
LINK="$(cd "$REPO/apps/demo" && CARD="$CARD" APP_URL="$APP_URL" "$REPO/node_modules/.bin/tsx" -e '
import { buildConnectLinkUrl } from "./src/connect_link"
const c = JSON.parse(process.env.CARD!)
console.log(buildConnectLinkUrl(process.env.APP_URL!, c.did, { id: c.id, displayName: c.name }))
')"
echo "opening the claim window"
rsh "sudo touch $STATE/claim-open"
restart_and_wait
rsh "sudo rm -f $STATE/claim-open"
sleep 1
OPEN="$(status)"
echo "$OPEN"
echo "$OPEN" | grep -q '"claimOpen":true' || { echo "claim window did not open" >&2; exit 1; }

echo "--------"
echo "Open this link on YOUR phone within 10 minutes (the first phone to open it becomes the owner):"
echo
echo "$LINK"
echo
echo "Check it worked:   $0 --status      (expect \"owner\":true, \"forward\":true, \"claimOpen\":false)"
echo "Window closes at the first claim or after 10 minutes; $0 --close closes it now."
echo "Do not run the app's e2e test while the window is open."
