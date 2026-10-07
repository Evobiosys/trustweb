#!/bin/bash
# Switch server-side transcription on (or off) for TrustWeb on questhub.
#
#   ./scripts/trustweb_transcribe_switch_on.sh production              # = openrouter: no key prompt, only enables the provider
#   ./scripts/trustweb_transcribe_switch_on.sh staging openrouter
#   ./scripts/trustweb_transcribe_switch_on.sh production off          # back to 503 not_configured
#   ./scripts/trustweb_transcribe_switch_on.sh production infomaniak   # the old provider: asks for product id + token on YOUR terminal
#
# openrouter (default): the OpenRouter key is already on questhub (/etc/unfold-news/orkey.json) and reaches the unit as a
#   systemd credential (scripts/deploy_trustweb_backup.sh writes the LoadCredential line). This mode only writes
#   TRANSCRIBE_PROVIDER=openrouter and TRANSCRIBE_ENABLED=1 into /etc/trustweb-backup[-staging].env and restarts the unit.
#   It reads no secret, prompts for nothing, and needs no terminal.
# infomaniak: needs an interactive terminal (ssh -t); the token is read hidden and never touches history or an argument list.
# Same SSH recipe as the deploy script (control master or askpass).
set -euo pipefail
target="${1:-}"
mode="${2:-openrouter}"
case "$target" in production|staging) ;; *) echo "usage: $0 production|staging [openrouter|off|infomaniak]" >&2; exit 2 ;; esac
case "$mode" in openrouter|off|infomaniak) ;; *) echo "usage: $0 production|staging [openrouter|off|infomaniak]" >&2; exit 2 ;; esac
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
