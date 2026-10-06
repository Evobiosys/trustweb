# Runs ON questhub (sent by trustweb_transcribe_switch_on.sh through ssh -t). Not meant to be run by hand.
# $1 = production | staging. Prompts for the Infomaniak AI Tools product id and API token on the terminal
# (the token is read without echo), writes /etc/trustweb-backup[-staging].env (0600 root), restarts the unit,
# and checks that /hosted/status now says transcribe:true. The token never appears in an argument list,
# in shell history or in this script's output.
set -euo pipefail
target="${1:?target missing}"
case "$target" in
  production) suffix=""; port=8960 ;;
  staging) suffix="-staging"; port=8970 ;;
  *) echo "target must be production or staging" >&2; exit 2 ;;
esac
envfile="${TW_ENVFILE:-/etc/trustweb-backup${suffix}.env}"
unit="trustweb-backup${suffix}"
echo "… transcription switch-on ($target) running …"
echo "--------"
read -r -p "Infomaniak AI Tools product id (digits, from https://manager.infomaniak.com -> AI Tools): " pid </dev/tty
[[ "$pid" =~ ^[0-9]{1,12}$ ]] || { echo "the product id is digits only" >&2; exit 1; }
read -r -s -p "Infomaniak API token (hidden, not stored in history): " key </dev/tty
echo
[ -n "$key" ] || { echo "empty token, nothing changed" >&2; exit 1; }
case "$key" in *[[:space:]\'\"\\]*) echo "the token holds characters that do not belong in a token, nothing changed" >&2; exit 1 ;; esac
umask 077
[ ! -e "$envfile" ] || sudo cp -p "$envfile" "$envfile.bak.$(date +%Y%m%d_%H%M%S)"
# The token goes from the shell (printf is a builtin: no argument list) through a pipe straight into the root-only
# file: it never lands in a temp file, in /proc/<pid>/cmdline or in history.
printf 'TRANSCRIBE_URL=https://api.infomaniak.com/1/ai/%s/openai/audio/transcriptions\nTRANSCRIBE_MODEL=whisper\nTRANSCRIBE_KEY=%s\n' "$pid" "$key" |
  sudo sh -c 'umask 077 && cat > "$1.new" && chown root:root "$1.new" && chmod 0600 "$1.new" && mv -f "$1.new" "$1"' _ "$envfile"
unset key
echo "wrote $envfile (0600 root)"
sudo systemctl restart "$unit"
sleep 1
status="$(curl -fsS -H 'Host: app.idea2.site' "http://127.0.0.1:${port}/hosted/status" || true)"
case "$status" in
  *'"transcribe":true'*) echo "transcription is ON for $target" ;;
  *) echo "the unit restarted but /hosted/status does not say transcribe:true: check 'journalctl -u $unit'" >&2; exit 1 ;;
esac
echo "--------"
