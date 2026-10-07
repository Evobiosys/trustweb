#!/bin/bash
# Switch server-side transcription on (or off) for TrustWeb on questhub.
#
#   ./scripts/trustweb_transcribe_switch_on.sh production berget        # Berget (Sweden) first, OpenRouter (paid, US) as the fallback for an outage
#   ./scripts/trustweb_transcribe_switch_on.sh production berget-only   # Berget alone: audio never leaves Sweden, an outage is a 502
#   ./scripts/trustweb_transcribe_switch_on.sh production openrouter    # OpenRouter alone (the pre-Berget route, US inference)
#   ./scripts/trustweb_transcribe_switch_on.sh staging openrouter
#   ./scripts/trustweb_transcribe_switch_on.sh production off           # back to 503 not_configured
#   ./scripts/trustweb_transcribe_switch_on.sh production infomaniak    # the old provider: asks for product id + token on YOUR terminal
#
# berget / berget-only / openrouter: the keys are already on questhub (/etc/trustweb/berget.json, /etc/trustweb/orkey.json) and reach the
#   unit as systemd credentials (scripts/deploy_trustweb_backup.sh writes each LoadCredential line only when its file exists, so deploy
#   AGAIN after creating a key file). These modes only write TRANSCRIBE_PROVIDER, TRANSCRIBE_FALLBACK and TRANSCRIBE_ENABLED=1 into
#   /etc/trustweb-backup[-staging].env and restart the unit. They read no secret, prompt for nothing, and need no terminal.
# infomaniak: needs an interactive terminal (ssh -t); the token is read hidden and never touches history or an argument list.
# Same SSH recipe as the deploy script (control master or askpass).
set -euo pipefail
target="${1:-}"
mode="${2:-berget}"
case "$target" in production|staging) ;; *) echo "usage: $0 production|staging [berget|berget-only|openrouter|off|infomaniak]" >&2; exit 2 ;; esac
case "$mode" in berget|berget-only|openrouter|off|infomaniak) ;; *) echo "usage: $0 production|staging [berget|berget-only|openrouter|off|infomaniak]" >&2; exit 2 ;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"
SSHENV=(env SSH_ASKPASS="$HOME/.ssh/questhub-jump-askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0)
ssh-add --apple-load-keychain >/dev/null 2>&1 || true
REMOTE="$(cat "$HERE/trustweb_transcribe_switch_on_remote.sh")"
if [ "$mode" = infomaniak ]; then
  [ -t 0 ] || { echo "the infomaniak mode needs an interactive terminal (it prompts for the token)" >&2; exit 1; }
  "${SSHENV[@]}" ssh -t questhub "bash -c $(printf '%q' "$REMOTE") _ $target $mode"
else
  "${SSHENV[@]}" ssh questhub "bash -c $(printf '%q' "$REMOTE") _ $target $mode"
fi
