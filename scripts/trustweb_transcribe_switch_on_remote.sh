# Runs ON questhub (sent by trustweb_transcribe_switch_on.sh through ssh). Not meant to be run by hand.
# $1 = production | staging, $2 = berget | berget-only | openrouter | off | infomaniak.
#   berget      Berget (Sweden) first, OpenRouter (PAID, US) behind it as the fallback for a Berget outage (5xx, timeout):
#               writes TRANSCRIBE_PROVIDER=berget, TRANSCRIBE_FALLBACK=openrouter, TRANSCRIBE_ENABLED=1 into
#               /etc/trustweb-backup[-staging].env (0600 root), restarts, checks /hosted/status says transcribe:true.
#   berget-only the same with TRANSCRIBE_FALLBACK=none: audio never leaves Sweden, a Berget outage is a 502 for the person.
#   openrouter  OpenRouter alone (TRANSCRIBE_PROVIDER=openrouter): the pre-Berget route, US inference.
#   No secret is read, printed or prompted for in these modes.
#   off         removes TRANSCRIBE_ENABLED, restarts, checks transcribe:false.
#   infomaniak  prompts for the Infomaniak AI Tools product id and token (hidden), writes them plus TRANSCRIBE_PROVIDER=infomaniak.
# Other lines of the env file are kept. The old file is copied to <file>.bak.<timestamp> first.
set -euo pipefail
target="${1:?target missing}"
mode="${2:-berget}"
case "$target" in
  production) suffix=""; port=8960 ;;
  staging) suffix="-staging"; port=8970 ;;
  *) echo "target must be production or staging" >&2; exit 2 ;;
esac
envfile="${TW_ENVFILE:-/etc/trustweb-backup${suffix}.env}"
unit="trustweb-backup${suffix}"
cred="${TW_CRED:-/etc/trustweb/orkey.json}"          # OpenRouter key file
bcred="${TW_BERGET_CRED:-/etc/trustweb/berget.json}"   # Berget key file
echo "… transcription switch-on ($target, $mode) running …"
echo "--------"

# Rewrites the env file: keeps every line except the given variable names, then appends the new lines read from stdin.
# $1 = extended regex of variable names to drop. The old content only ever flows through pipes (it may hold an old token).
rewrite_envfile() {
  local drop="$1"
  umask 077
  if [ -e "$envfile" ]; then sudo cp -p "$envfile" "$envfile.bak.$(date +%Y%m%d_%H%M%S)"; fi
  { if [ -e "$envfile" ]; then sudo grep -v -E "^(${drop})=" "$envfile" || true; fi; cat; } |
    sudo sh -c 'umask 077 && cat > "$1.new" && chown root:root "$1.new" && chmod 0600 "$1.new" && mv -f "$1.new" "$1"' _ "$envfile"
}

check_status() { # $1 = expected transcribe value (true|false)
  sudo systemctl restart "$unit"
  sleep 1
  local status
  status="$(curl -fsS -H 'Host: app.idea2.site' "http://127.0.0.1:${port}/hosted/status" || true)"
  case "$status" in
    *"\"transcribe\":$1"*)
      echo "transcription is $([ "$1" = true ] && echo ON || echo OFF) for $target"
      echo "status provider block: $(printf '%s' "$status" | grep -o '"provider":{"transcribe":{[^}]*}[^}]*}' | head -n 1)" ;;
    *) echo "the unit restarted but /hosted/status does not say transcribe:$1: check 'journalctl -u $unit'" >&2; exit 1 ;;
  esac
}

# $1 = credential file on disk, $2 = the credential name the unit must load, $3 = what it is called in messages. Exits 1 when either is missing.
require_credential() {
  sudo test -e "$1" || { echo "$1 ($3 key) is missing on this server: nothing changed" >&2; exit 1; }
  sudo systemctl cat "$unit" 2>/dev/null | grep -q "^LoadCredential=$2:" ||
    { echo "the unit $unit has no LoadCredential=$2 line: run scripts/deploy_trustweb_backup.sh --$target again (the line is only written when the file exists at deploy time), nothing changed" >&2; exit 1; }
}

case "$mode" in
  berget|berget-only)
    require_credential "$bcred" berget Berget
    fallback=openrouter
    [ "$mode" = berget-only ] && fallback=none
    if [ "$fallback" = openrouter ]; then
      if sudo test -e "$cred" && sudo systemctl cat "$unit" 2>/dev/null | grep -q '^LoadCredential=orkey:'; then :; else
        echo "note: the OpenRouter credential is not loaded by the unit, so there is no fallback until it is (the Berget route still works)" >&2
      fi
    fi
    printf 'TRANSCRIBE_PROVIDER=berget\nTRANSCRIBE_FALLBACK=%s\nTRANSCRIBE_ENABLED=1\n' "$fallback" | rewrite_envfile 'TRANSCRIBE_PROVIDER|TRANSCRIBE_FALLBACK|TRANSCRIBE_ENABLED'
    echo "wrote $envfile (0600 root): provider berget, fallback $fallback, enabled"
    check_status true
    ;;
  openrouter)
    require_credential "$cred" orkey OpenRouter
    printf 'TRANSCRIBE_PROVIDER=openrouter\nTRANSCRIBE_ENABLED=1\n' | rewrite_envfile 'TRANSCRIBE_PROVIDER|TRANSCRIBE_FALLBACK|TRANSCRIBE_ENABLED'
    echo "wrote $envfile (0600 root): provider openrouter alone, enabled"
    check_status true
    ;;
  off)
    : | rewrite_envfile 'TRANSCRIBE_ENABLED'
    echo "wrote $envfile (0600 root): TRANSCRIBE_ENABLED removed"
    check_status false
    ;;
  infomaniak)
    read -r -p "Infomaniak AI Tools product id (digits, from https://manager.infomaniak.com -> AI Tools): " pid </dev/tty
    [[ "$pid" =~ ^[0-9]{1,12}$ ]] || { echo "the product id is digits only" >&2; exit 1; }
    read -r -s -p "Infomaniak API token (hidden, not stored in history): " key </dev/tty
    echo
    [ -n "$key" ] || { echo "empty token, nothing changed" >&2; exit 1; }
    case "$key" in *[[:space:]\'\"\\]*) echo "the token holds characters that do not belong in a token, nothing changed" >&2; exit 1 ;; esac
    # The token goes from the shell (printf is a builtin: no argument list) through pipes straight into the root-only file.
    printf 'TRANSCRIBE_PROVIDER=infomaniak\nTRANSCRIBE_URL=https://api.infomaniak.com/1/ai/%s/openai/audio/transcriptions\nTRANSCRIBE_MODEL=whisper\nTRANSCRIBE_KEY=%s\n' "$pid" "$key" |
      rewrite_envfile 'TRANSCRIBE_PROVIDER|TRANSCRIBE_FALLBACK|TRANSCRIBE_URL|TRANSCRIBE_MODEL|TRANSCRIBE_KEY'
    unset key
    echo "wrote $envfile (0600 root)"
    check_status true
    ;;
  *) echo "mode must be berget, berget-only, openrouter, off or infomaniak" >&2; exit 2 ;;
esac
echo "--------"
