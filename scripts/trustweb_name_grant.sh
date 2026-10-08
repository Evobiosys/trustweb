#!/bin/bash
# Grant (or remove) a reserved username on questhub: the operator side of the loopback-only admin routes of services/trustweb-backup (wave 6e).
#
#   ./scripts/trustweb_name_grant.sh --host questhub --list
#   ./scripts/trustweb_name_grant.sh --host questhub --code <22 chars> --name <name>              set <name> as the code's primary name
#   ./scripts/trustweb_name_grant.sh --host questhub --code <22 chars> --name <n> --alias <n2>    ... and add <n2> as an alias
#   ./scripts/trustweb_name_grant.sh --host questhub --code <22 chars> --alias <n2>               add <n2> as an alias
#   ./scripts/trustweb_name_grant.sh --host questhub --code <22 chars> --remove <name>            take a name off the code (a granted one too)
#   --yes   do not ask for the typed confirmation (the read-only list is still shown first)
#
# What it does: ssh to the host and, ON the host, curl http://127.0.0.1:8960/admin/... with `Host: 127.0.0.1:8960`. The admin token is read there
# from /etc/trustweb/admin.json (sudo) and handed to curl as a header file on stdin (`curl -H @-`): it never appears in an argument list, never in this
# terminal. The JSON body (it holds the code) travels on the ssh stdin into a 0600 temp file read by `curl --data @file`, never as an argument.
# The admin routes are not reachable from the internet (not in Caddy); this script is the way in.
#
# A write first shows the read-only list (who holds the reserved names), says what it will do, and asks "ENTER or y or n".
# Which code is whose? The person sends their /c/<code> link; the 22 characters after /c/ are the code.
#
# TESTS ONLY: TW_GRANT_TRANSPORT=local runs the same remote script on THIS machine against 127.0.0.1:$TW_GRANT_PORT, with the token read from the
# file $TW_GRANT_TOKEN_FILE (plain cat, no sudo). Never used against the real host.
set -euo pipefail
echo "... trustweb_name_grant running ..."
echo "--------"

SSHENV=(env SSH_ASKPASS="$HOME/.ssh/questhub-jump-askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0)
CODE_RE='^[A-Za-z0-9_-]{22}$'
NAME_RE='^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$'
HOST_ARG=""; CODE=""; NAME=""; ALIAS=""; REMOVE=""; LIST=0; YES=0
TRANSPORT="${TW_GRANT_TRANSPORT:-ssh}"
PORT=8960
TOKEN_FILE=/etc/trustweb/admin.json
TOKEN_READ="sudo cat $TOKEN_FILE"

usage() {
  echo "usage: $0 --host questhub --list" >&2
  echo "       $0 --host questhub --code <22 chars> [--name <name>] [--alias <name>] [--yes]" >&2
  echo "       $0 --host questhub --code <22 chars> --remove <name> [--yes]" >&2
  exit 2
}
die() { echo "$1" >&2; exit "${2:-1}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --host) [ $# -ge 2 ] || usage; HOST_ARG="$2"; shift 2 ;;
    --code) [ $# -ge 2 ] || usage; CODE="$2"; shift 2 ;;
    --name) [ $# -ge 2 ] || usage; NAME="$2"; shift 2 ;;
    --alias) [ $# -ge 2 ] || usage; ALIAS="$2"; shift 2 ;;
    --remove) [ $# -ge 2 ] || usage; REMOVE="$2"; shift 2 ;;
    --list) LIST=1; shift ;;
    --yes) YES=1; shift ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done

# ---- arguments: exactly one kind of job, every value of the shape the server accepts (so none can carry a quote or a newline into the JSON)
[ "$HOST_ARG" = questhub ] || die "--host questhub is required (the names live on questhub; no default on purpose)" 2
if [ "$LIST" = 1 ]; then
  [ -z "$CODE$NAME$ALIAS$REMOVE" ] || usage
else
  [[ "$CODE" =~ $CODE_RE ]] || die "--code must be the 22 characters after /c/ in the person's link" 2
  if [ -n "$REMOVE" ]; then
    [ -z "$NAME$ALIAS" ] || usage
  else
    [ -n "$NAME$ALIAS" ] || usage
  fi
  for n in "$NAME" "$ALIAS" "$REMOVE"; do
    if [ -n "$n" ] && ! [[ "$n" =~ $NAME_RE ]]; then die "a name is 3 to 30 characters of a-z 0-9 . _ - (first and last a letter or digit): $n" 2; fi
  done
  [ -z "$NAME" ] || [ -z "$ALIAS" ] || [ "$NAME" != "$ALIAS" ] || die "--name and --alias must differ" 2
fi

# ---- transport
case "$TRANSPORT" in
  ssh)
    ssh-add --apple-load-keychain >/dev/null 2>&1 || true ;;
  local)
    [[ "${TW_GRANT_PORT:-}" =~ ^[0-9]{2,5}$ ]] || die "TW_GRANT_TRANSPORT=local needs TW_GRANT_PORT" 2
    [ -n "${TW_GRANT_TOKEN_FILE:-}" ] || die "TW_GRANT_TRANSPORT=local needs TW_GRANT_TOKEN_FILE" 2
    PORT="$TW_GRANT_PORT"; TOKEN_FILE="$TW_GRANT_TOKEN_FILE"; TOKEN_READ="cat \"$TOKEN_FILE\"" ;;
  *) die "unknown TW_GRANT_TRANSPORT: $TRANSPORT" 2 ;;
esac

# Runs a script on the host (or here, for the local test transport): the script text is the only thing on stdin.
run_script() {
  if [ "$TRANSPORT" = local ]; then bash -s; else "${SSHENV[@]}" ssh questhub 'bash -s'; fi
}

# The script that runs ON the host for one admin call. $1 = HTTP method, $2 = path, $3 = JSON body ("" for none).
# Prints the response body, then a line "HTTP <status>". The token is parsed from the file into a shell variable and written with the printf builtin.
remote_script() {
  local method="$1" path="$2" body="${3:-}"
  cat <<SCRIPT
set -euo pipefail
umask 077
B=\$(mktemp)
trap 'rm -f "\$B"' EXIT
SCRIPT
  if [ -n "$body" ]; then
    printf "cat > \"\$B\" <<'TW_BODY_END'\n%s\nTW_BODY_END\n" "$body"
  fi
  cat <<SCRIPT
tok=\$($TOKEN_READ | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\\([0-9a-f]\\{64\\}\\)".*/\\1/p')
[ -n "\$tok" ] || { echo "no usable admin token in $TOKEN_FILE on this host" >&2; exit 3; }
args=(-sS --max-time 20 -H @- -H 'Host: 127.0.0.1:$PORT' -X $method -w '\nHTTP %{http_code}\n')
SCRIPT
  if [ -n "$body" ]; then
    echo "args+=(-H 'Content-Type: application/json' --data @\"\$B\")"
  fi
  cat <<SCRIPT
printf 'X-Admin-Token: %s\n' "\$tok" | curl "\${args[@]}" http://127.0.0.1:$PORT$path
SCRIPT
}

# One admin call. Prints the JSON answer; returns 0 on 2xx, 1 on any other status (the answer is printed either way), 3 when the host could not be reached.
admin_call() {
  local out status
  out="$(remote_script "$1" "$2" "${3:-}" | run_script)" || die "could not run the admin call on $HOST_ARG (ssh, sudo or the token file)" 3
  status="$(printf '%s\n' "$out" | sed -n 's/^HTTP \([0-9]*\)$/\1/p' | tail -n 1)"
  printf '%s\n' "$out" | sed '/^HTTP [0-9]*$/d'
  case "$status" in 2??) return 0 ;; *) echo "refused: HTTP ${status:-?}" >&2; return 1 ;; esac
}

masked() { printf '%s...%s' "${1:0:4}" "${1: -4}"; }

confirm() {
  [ "$YES" = 1 ] && return 0
  local reply
  while true; do
    printf 'Proceed? ENTER or y or n: '
    read -r reply || { echo; echo "no answer: nothing changed."; return 1; }
    case "$reply" in
      ""|y|Y) return 0 ;;
      n|N) echo "nothing changed."; return 1 ;;
      *) echo "please answer ENTER, y or n" ;;
    esac
  done
}

echo "reserved names and who holds them (read-only):"
admin_call GET /admin/names
if [ "$LIST" = 1 ]; then exit 0; fi
echo "--------"

echo "planned, on code $(masked "$CODE") (host $HOST_ARG):"
[ -z "$NAME" ] || echo "  grant \"$NAME\" as the primary name (a different current primary becomes an alias)"
[ -z "$ALIAS" ] || echo "  grant \"$ALIAS\" as an alias"
[ -z "$REMOVE" ] || echo "  remove \"$REMOVE\" (a granted name too; the first alias is promoted)"
confirm || exit 0
echo "--------"

if [ -n "$REMOVE" ]; then
  admin_call DELETE /admin/name "{\"code\":\"$CODE\",\"name\":\"$REMOVE\"}"
fi
if [ -n "$NAME" ]; then
  admin_call POST /admin/name "{\"code\":\"$CODE\",\"name\":\"$NAME\"}"
fi
if [ -n "$ALIAS" ]; then
  admin_call POST /admin/name "{\"code\":\"$CODE\",\"name\":\"$ALIAS\",\"alias\":true}"
fi
echo "--------"
echo "done. The person's TrustWeb learns the names the next time Meet opens (it reads them from the server)."
