#!/bin/bash
# One real /transcribe call against the server on questhub (loopback, over ssh), with a fresh random account.
#
#   ./scripts/trustweb_transcribe_probe.sh staging  <audio-file> <mime> <seconds>
#   ./scripts/trustweb_transcribe_probe.sh production <audio-file> <mime> <seconds>
#   e.g. ./scripts/trustweb_transcribe_probe.sh staging /tmp/clip.webm 'audio/webm;codecs=opus' 5
#
# Prints the HTTP status, the answer (text, segments, approx, secondsCharged) and the server's own "transcribe ok" log line
# (provider, seconds, cost in USD). Use synthetic audio only: the audio goes to OpenRouter and its inference provider.
set -euo pipefail
target="${1:-}"; file="${2:-}"; mime="${3:-}"; seconds="${4:-}"
case "$target" in production) port=8960; unit=trustweb-backup ;; staging) port=8970; unit=trustweb-backup-staging ;; *) echo "usage: $0 staging|production <audio-file> <mime> <seconds>" >&2; exit 2 ;; esac
# The MIME type may carry parameters, as the phone sends it (audio/webm;codecs=opus): checked here, quoted below for the remote shell.
[ -f "$file" ] && [[ "$mime" =~ ^audio/[a-z0-9.+-]+(\;\ ?[a-z0-9=.+-]+)*$ ]] && [[ "$seconds" =~ ^[0-9]{1,4}$ ]] || { echo "usage: $0 staging|production <audio-file> <mime> <seconds>" >&2; exit 2; }
SSHENV=(env SSH_ASKPASS="$HOME/.ssh/questhub-jump-askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0)
ssh-add --apple-load-keychain >/dev/null 2>&1 || true
echo "… transcribe probe ($target) running …"
echo "--------"
remote="/tmp/tw_probe.$$"
"${SSHENV[@]}" scp -q "$file" "questhub:$remote"
"${SSHENV[@]}" ssh questhub "bash -s -- $(printf '%q ' "$port" "$unit" "$remote" "$mime" "$seconds")" <<'REMOTE'
set -euo pipefail
port="$1"; unit="$2"; f="$3"; mime="$4"; secs="$5"
trap 'rm -f "$f" "$f.out"' EXIT
ACC=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
TOK=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
curl -sS -m 300 -o "$f.out" -w 'HTTP %{http_code}, %{time_total}s\n' -X POST -H 'Host: app.idea2.site' \
  -H "X-Account: $ACC" -H "X-Write-Token: $TOK" -H "X-Audio-Seconds: $secs" -H "Content-Type: $mime" \
  --data-binary "@$f" "http://127.0.0.1:$port/transcribe" || true
[ -f "$f.out" ] && { cat "$f.out"; echo; }
echo "--- server log"
sudo journalctl -u "$unit" --since '-3 min' --no-pager -o cat | grep '^transcribe' | tail -n 5 || true
REMOTE
echo "--------"
