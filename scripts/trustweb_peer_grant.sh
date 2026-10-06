#!/bin/bash
# Who may connect to Jakob's personal front door (policy granted). So nobody
# edits JSON on a server by hand: grants.json lives in the instance's state dir
# (root-only), this script reads it, changes it here on the Mac, writes it back
# (0600, owned by the service) and sends the peer SIGHUP (it reloads grants
# without a restart, so an open claim window and pending asks survive).
#
#   ./scripts/trustweb_peer_grant.sh --instance personal --host questhub|sebra --list
#   ./scripts/trustweb_peer_grant.sh --instance personal --host ... --add "Anna"
#   ./scripts/trustweb_peer_grant.sh --instance personal --host ... --remove "Anna"
#   ./scripts/trustweb_peer_grant.sh --instance personal --host ... --link     the connect link to hand to a granted person
#   --host is required for the personal instance: the host where you deployed it (your decision, never a default).
#
# What a grant is TODAY: the display name the other person's TrustWeb sends
# when it opens the connect link (compared case-insensitively). A name is not
# a secret, so the connect link is the second half of the lock: hand it only to
# the people you grant. A connected person stays connected after --remove
# (removing stops NEW connections); owner-sent grants over the encrypted
# channel are on the roadmap (they need a new control envelope in the app).
set -euo pipefail
echo "... trustweb_peer_grant running ..."
echo "--------"

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
# shellcheck source=scripts/trustweb_peer_lib.sh
. "$HERE/trustweb_peer_lib.sh"

INST=; HOSTNAME_ARG=; ACTION=; NAME=
usage() { echo "usage: $0 --instance personal --host questhub|sebra --list | --add <name> | --remove <name> | --link" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --instance) [ $# -ge 2 ] || usage; INST="$2"; shift 2 ;;
    --host) [ $# -ge 2 ] || usage; HOSTNAME_ARG="$2"; shift 2 ;;
    --list) ACTION=list; shift ;;
    --link) ACTION=link; shift ;;
    --add|--remove) [ $# -ge 2 ] || usage; ACTION="${1#--}"; NAME="$2"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$INST" ] && [ -n "$ACTION" ] || usage
tw_peer_instance "$INST" || { echo "unknown instance: $INST" >&2; exit 2; }
if [ "$POLICY" = granted ]; then tw_peer_require_host "$HOSTNAME_ARG"; fi
tw_peer_host "${HOSTNAME_ARG:-questhub}" || { echo "unknown host: $HOSTNAME_ARG (questhub|sebra)" >&2; exit 2; }
if [ "$POLICY" != granted ]; then
  echo "the $INSTANCE front door is open to anyone with its link: it has no grant list" >&2; exit 2
fi
tw_peer_ssh_prepare
echo "front door: $INSTANCE ($UNIT on $RHOST)"
rsh "systemctl cat $UNIT >/dev/null 2>&1" || { echo "$UNIT is not deployed on $RHOST (scripts/deploy_trustweb_peer.sh --instance $INSTANCE --host $RHOST)" >&2; exit 1; }

# grants.json -> names, one per line; edits are done in node on this Mac (no python or jq needed on the host).
current() { rsh "sudo cat $STATE/grants.json 2>/dev/null || true"; }
edit_names() {
  CURRENT="$1" ACTION="$ACTION" NAME="$NAME" node -e '
const raw = process.env.CURRENT.trim()
let names = []
if (raw) {
  const o = JSON.parse(raw)
  names = Array.isArray(o.names) ? o.names.filter((n) => typeof n === "string") : []
}
const name = process.env.NAME.trim().replace(/\s+/g, " ")
if (process.env.ACTION !== "list") {
  if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) { console.error("a name is 1 to 40 printable characters"); process.exit(2) }
}
const lower = name.toLowerCase()
const has = names.some((n) => n.toLowerCase() === lower)
if (process.env.ACTION === "add" && !has) names.push(name)
if (process.env.ACTION === "remove") names = names.filter((n) => n.toLowerCase() !== lower)
if (process.env.ACTION === "remove" && !has) console.error("not on the list: " + name)
process.stdout.write(JSON.stringify({ names }) + "\n")
'
}

case "$ACTION" in
  list)
    edit_names "$(current)" | node -e 'const o = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(o.names.length ? o.names.map((n) => "  " + n).join("\n") : "  (nobody granted yet)")'
    exit 0 ;;
  link)
    echo "Hand this link ONLY to a person you granted; they open it in their TrustWeb under the granted name:"
    echo
    tw_peer_link "$REPO" "$(tw_peer_card)"
    exit 0 ;;
esac

NEXT="$(edit_names "$(current)")"
echo "$NEXT" | rsh "set -e; umask 077; t=\$(mktemp); cat > \"\$t\"; sudo install -m 0600 \"\$t\" $STATE/grants.json; rm -f \"\$t\";
  sudo chown --reference=$STATE/. $STATE/grants.json; sudo systemctl kill -s HUP $UNIT"
echo "granted now:"
echo "$NEXT" | node -e 'const o = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(o.names.length ? o.names.map((n) => "  " + n).join("\n") : "  (nobody)")'
if [ "$ACTION" = add ]; then
  echo "--------"
  echo "Next: $0 --instance $INSTANCE --host $RHOST --link   and hand that link to \"$NAME\" (they must use exactly this name in their TrustWeb)."
fi
