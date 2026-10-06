#!/bin/bash
# Switch server-side transcription on for TrustWeb: asks for the Infomaniak AI Tools product id and API token
# on YOUR terminal (token hidden, never in shell history or an argument list), writes the root-only
# EnvironmentFile on questhub and restarts the unit.
#
#   ./scripts/trustweb_transcribe_switch_on.sh production
#   ./scripts/trustweb_transcribe_switch_on.sh staging
#
# Needs an interactive terminal (ssh -t). Same SSH recipe as the deploy script (control master or askpass).
set -euo pipefail
target="${1:-}"
case "$target" in production|staging) ;; *) echo "usage: $0 production|staging" >&2; exit 2 ;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -t 0 ] || { echo "run this in an interactive terminal (it prompts for the token)" >&2; exit 1; }
SSHENV=(env SSH_ASKPASS="$HOME/.ssh/questhub-jump-askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0)
ssh-add --apple-load-keychain >/dev/null 2>&1 || true
REMOTE="$(cat "$HERE/trustweb_transcribe_switch_on_remote.sh")"
"${SSHENV[@]}" ssh -t questhub "bash -c $(printf '%q' "$REMOTE") _ $target"
