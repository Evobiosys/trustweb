# Sourced by deploy_trustweb_peer.sh, trustweb_peer_claim.sh and
# trustweb_peer_grant.sh: the one table of front-door instances and hosts, and
# the SSH recipe (control master + askpass, see ~/.claude/CLAUDE.md).
#
#   demo      the demo front door, named Jakob: his ten public lines, policy open, card
#             published next to the app (app.idea2.site/trustweb/demo-peer.json).
#             questhub only (the card lives in questhub's static tree).
#   personal  Jakob's own front door: policy granted (grants.json), inventory
#             = ONLY the lines he allowed in advance, sent by
#             scripts/trustweb_inventory_export.ts --send. No public card: its
#             connect link goes only to Jakob (claim) and to people he grants.
#             Host: questhub or sebra (his decision; see services/trustweb-peer/README.txt).
#
# Paths below must match scripts/trustweb_inventory_export.ts (PERSONAL_*).

# shellcheck disable=SC2034  # the variables are read by the scripts that source this file
tw_peer_instance() {
  case "$1" in
    demo)
      UNIT=trustweb-peer; PORT=8961; STATE=/var/lib/trustweb-peer; OPT=/opt/trustweb-peer
      PEER_NAME="Jakob"; POLICY=open; PUBLIC_CARD=1; INV_PATH=/opt/trustweb-peer/demo_inventory.json; INV_ETC= ;;
    personal)
      UNIT=trustweb-peer-personal; PORT=8962; STATE=/var/lib/trustweb-peer-personal; OPT=/opt/trustweb-peer-personal
      PEER_NAME="Jakob"; POLICY=granted; PUBLIC_CARD=0; INV_ETC=/etc/trustweb-peer-personal; INV_PATH=/etc/trustweb-peer-personal/inventory.json ;;
    *) return 1 ;;
  esac
  INSTANCE="$1"
  HOSTHDR="Host: 127.0.0.1:$PORT"
}

tw_peer_host() {
  case "$1" in
    questhub|sebra) RHOST="$1" ;;
    *) return 1 ;;
  esac
}

# The personal front door's host is Jakob's decision: never a default. $1 = the --host value given ('' = none).
tw_peer_require_host() {
  if [ "$INSTANCE" = personal ] && [ -z "$1" ]; then
    echo "the personal front door's host is your decision: pass --host sebra or --host questhub" >&2
    exit 2
  fi
}

# A mode that changes a front door names its instance on the command line: no default. $1 = the --instance value given ('' = none).
tw_peer_require_instance() {
  if [ -z "$1" ]; then
    echo "this changes a front door: name it with --instance demo or --instance personal (there is no default for changes)" >&2
    exit 2
  fi
}

# Prints which front door a change acts on and has it confirmed BEFORE anything on the host changes:
# the instance's name typed on the terminal, or --confirm <instance> (non-interactive; must match).
# $1 = the --confirm value ('' = ask), $2 = what is about to happen.
tw_peer_confirm_instance() {
  local given="$1" what="$2" answer=""
  echo "THIS ACTS ON: the $INSTANCE front door ($UNIT on $RHOST): $what"
  if [ -n "$given" ]; then
    if [ "$given" != "$INSTANCE" ]; then
      echo "--confirm $given does not match --instance $INSTANCE: nothing done" >&2; exit 2
    fi
    return 0
  fi
  if [ ! -t 0 ]; then
    echo "no terminal to confirm on: pass --confirm $INSTANCE to say you mean the $INSTANCE front door" >&2; exit 2
  fi
  read -r -p "Type $INSTANCE to continue (anything else stops): " answer
  if [ "$answer" != "$INSTANCE" ]; then
    echo "not confirmed: nothing done" >&2; exit 1
  fi
}

# The remote command that creates the personal inventory EMPTY ({"items":[]}, root 0600, in a 0700 folder)
# ONLY when it is absent. An existing file is never touched: only the exporter's --send replaces it.
tw_peer_inventory_init_cmd() {
  printf '%s' "sudo install -d -m 0700 $INV_ETC && if ! sudo test -f $INV_PATH; then sudo install -m 0600 /dev/null $INV_PATH && printf '{\"items\":[]}\\n' | sudo tee $INV_PATH >/dev/null; fi"
}

# The unit name -> instance name (trustweb-peer -> demo, trustweb-peer-personal -> personal).
tw_peer_instance_of_unit() {
  local u="${1%.service}"
  case "$u" in
    trustweb-peer) echo demo ;;
    trustweb-peer-*) echo "${u#trustweb-peer-}" ;;
    *) return 1 ;;
  esac
}

SSHENV=(env SSH_ASKPASS="$HOME/.ssh/questhub-jump-askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0)
rsh() { "${SSHENV[@]}" ssh "$RHOST" "$@"; }
tw_peer_ssh_prepare() { ssh-add --apple-load-keychain >/dev/null 2>&1 || true; }

# /status over loopback with the Host header the peer checks.
tw_peer_status() { rsh "curl -fsS -H '$HOSTHDR' http://127.0.0.1:$PORT/status"; echo; }
# /card over loopback (the claim and grant links are built from it; nothing public needed).
tw_peer_card() { rsh "curl -fsS -H '$HOSTHDR' http://127.0.0.1:$PORT/card"; }

# The connect link a phone opens: the app's own buildConnectLinkUrl, fed the card on stdin.
tw_peer_link() {
  local repo="$1" card="$2"
  (cd "$repo/apps/demo" && CARD="$card" APP_URL=https://app.idea2.site/trustweb/ "$repo/node_modules/.bin/tsx" -e '
import { buildConnectLinkUrl } from "./src/connect_link"
const c = JSON.parse(process.env.CARD!)
if (typeof c.did !== "string" || !c.did.startsWith("did:peer:") || !c.id || !c.name) throw new Error("not a front-door card")
console.log(buildConnectLinkUrl(process.env.APP_URL!, c.did, { id: c.id, displayName: c.name }))
')
}
