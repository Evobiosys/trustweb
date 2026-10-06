#!/bin/bash
# Open the claim window of a TrustWeb front door and print the connect link the
# owner opens on his phone. The first phone that opens it within 10 minutes
# becomes the owner (asks to the front door are then forwarded to that phone
# for a live yes/no); later phones are askers (demo) or need a grant (personal).
#
#   ./scripts/trustweb_peer_claim.sh [--instance demo|personal] [--host questhub|sebra] [MODE]
#   MODE: (none) open the window, print the link | --close | --status | --reset (forget the owner)
#   Defaults: --instance demo --host questhub.
#
# WHICH TRUSTWEB OPENS THE LINK DECIDES WHO OWNS THE FRONT DOOR. The link is
# https://app.idea2.site/trustweb/?connect=... with no ?persona=, so the app
# opens it in its normal persona ("me", your everyday TrustWeb, stored under
# trustweb.v1.me) in whatever browser opens it. A demo account only ever runs
# under ?persona=demo-<id>, which this link never carries. So: open it on YOUR
# phone, in the browser (or installed app) where your normal TrustWeb lives.
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
# shellcheck source=scripts/trustweb_peer_lib.sh
. "$HERE/trustweb_peer_lib.sh"

MODE=open; INST=demo; HOSTNAME_ARG=questhub
usage() { echo "usage: $0 [--instance demo|personal] [--host questhub|sebra] [--close|--status|--reset]" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --instance) [ $# -ge 2 ] || usage; INST="$2"; shift 2 ;;
    --host) [ $# -ge 2 ] || usage; HOSTNAME_ARG="$2"; shift 2 ;;
    --status) MODE=status; shift ;;
    --close) MODE=close; shift ;;
    --reset) MODE=reset; shift ;;
    *) usage ;;
  esac
done
tw_peer_instance "$INST" || { echo "unknown instance: $INST (demo|personal)" >&2; exit 2; }
tw_peer_host "$HOSTNAME_ARG" || { echo "unknown host: $HOSTNAME_ARG (questhub|sebra)" >&2; exit 2; }
tw_peer_ssh_prepare
echo "front door: $INSTANCE ($UNIT on $RHOST)"

restart_and_wait() {
  rsh "sudo systemctl restart $UNIT;
       for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do curl -fsS -H '$HOSTHDR' http://127.0.0.1:$PORT/health >/dev/null 2>&1 && break; sleep 1; done"
}

case "$MODE" in
  status) tw_peer_status; exit 0 ;;
  close)
    rsh "sudo rm -f $STATE/claim-open"; restart_and_wait; tw_peer_status; echo "window closed"; exit 0 ;;
  reset)
    # Removes the owner block from state.json (0600, root-readable via sudo) and restarts.
    rsh "sudo python3 - <<'PY'
import json
p = '$STATE/state.json'
s = json.load(open(p)); s.pop('owner', None)
json.dump(s, open(p, 'w'))
PY
sudo rm -f $STATE/claim-open"
    restart_and_wait; tw_peer_status; echo "owner forgotten"; exit 0 ;;
esac

CUR="$(tw_peer_status)"
if echo "$CUR" | grep -q '"owner":true'; then
  echo "an owner is already bound. To claim again: $0 --instance $INSTANCE --host $RHOST --reset, then $0 --instance $INSTANCE --host $RHOST" >&2
  exit 1
fi

# Build the link first (from the card over loopback): a failure here must not leave a window open.
LINK="$(tw_peer_link "$REPO" "$(tw_peer_card)")"
echo "opening the claim window"
rsh "sudo touch $STATE/claim-open"
restart_and_wait
rsh "sudo rm -f $STATE/claim-open"
sleep 1
OPEN="$(tw_peer_status)"
echo "$OPEN"
echo "$OPEN" | grep -q '"claimOpen":true' || { echo "claim window did not open" >&2; exit 1; }

echo "--------"
echo "Open this link within 10 minutes on YOUR phone, in YOUR NORMAL TrustWeb"
echo "(the browser or installed app where your own web lives), NOT in a demo account tab."
echo "The first phone to open it becomes the owner of this front door:"
echo
echo "$LINK"
echo
echo "Check it worked:   $0 --instance $INSTANCE --host $RHOST --status   (expect \"owner\":true, \"forward\":true, \"claimOpen\":false)"
echo "Window closes at the first claim or after 10 minutes; --close closes it now."
echo "Do not run the app's e2e test while the window is open."
