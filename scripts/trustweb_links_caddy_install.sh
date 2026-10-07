#!/bin/bash
# Wave 5 (services): put the short-link routes /link and /l/* (with log_skip) into the app.idea2.site and app.trustintheweb.org blocks
# of the live Caddyfile on questhub. Same shape as wave 4's infra_caddy_install.sh. RUN BY THE ORCHESTRATOR, after the unit has the new code.
#
#   trustweb_links_caddy_install.sh            validate only (default): fetch the live file, edit a COPY, validate the copy on the server as user caddy; changes nothing
#   trustweb_links_caddy_install.sh --apply    the same, then: backup, install, validate the live file, reload; restore the backup if validate or reload fails
#
# Guard: the live file must still have the sha256 this edit was reviewed against (EXPECT_SHA; override with the env var after re-reading the new diff:
# another wave-5 worker may have edited the Caddyfile since). The edit script refuses to run on a block without its /websearch* anchor.
# Uses the open ControlMaster of `ssh questhub` (BatchMode: fails fast, never prompts; this script never runs the askpass recipe).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
EXPECT_SHA="${EXPECT_SHA:-f623e99aed644e645912d77e0b0f51fc69ea35ac3f9c8b684d095a04f1c13cf4}"
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
rsh() { ssh -o BatchMode=yes questhub "$@"; }
echo "... trustweb_links_caddy_install running ($([ $APPLY = 1 ] && echo apply || echo validate-only)) ..."
echo "--------"
ssh -O check questhub 2>/dev/null || { echo "ssh ControlMaster to questhub is not open: stop" >&2; exit 2; }
LOCAL="$(mktemp -d)"; trap 'rm -rf "$LOCAL"' EXIT
rsh 'sudo cat /etc/caddy/Caddyfile' > "$LOCAL/live"
got="$(shasum -a 256 "$LOCAL/live" | cut -d' ' -f1)"
[ "$got" = "$EXPECT_SHA" ] || { echo "REFUSED: the live Caddyfile changed since the review (sha256 $got, expected $EXPECT_SHA): re-run the diff first" >&2; exit 3; }
python3 -I "$HERE/trustweb_links_caddy_edit.py" "$LOCAL/live" "$LOCAL/edited"
diff -u --label /etc/caddy/Caddyfile --label Caddyfile.proposed "$LOCAL/live" "$LOCAL/edited" > "$LOCAL/diff" || true
if cmp -s "$LOCAL/diff" "$HERE/trustweb_links_caddy_proposed.diff"; then echo "edit == the reviewed trustweb_links_caddy_proposed.diff"; else echo "note: the edit differs from trustweb_links_caddy_proposed.diff: read it before --apply"; fi
cmp -s "$LOCAL/live" "$LOCAL/edited" && { echo "nothing to change (both blocks already have the short-link routes)"; exit 0; }
B64="$(base64 < "$LOCAL/edited" | tr -d '\n')"
rsh "set -euo pipefail
  D=\$(mktemp -d /tmp/twcaddyval.XXXXXX); trap 'rm -rf \"\$D\"' EXIT; chmod 755 \$D
  echo '$B64' | base64 -d > \$D/Caddyfile; chmod 644 \$D/Caddyfile
  sudo -u caddy env HOME=/var/lib/caddy caddy validate --config \$D/Caddyfile --adapter caddyfile 2>&1 | tail -n 1
  [ \"\${PIPESTATUS[0]}\" = 0 ] && echo '  PASS  caddy validate of the edited copy'"
[ $APPLY = 1 ] || { echo "validate-only: the live Caddyfile was not touched. Run with --apply to install."; exit 0; }
out="$(rsh "set -euo pipefail
  D=\$(mktemp -d /tmp/twcaddyapply.XXXXXX); trap 'rm -rf \"\$D\"' EXIT; chmod 755 \$D
  echo '$B64' | base64 -d > \$D/Caddyfile; chmod 644 \$D/Caddyfile
  CF=/etc/caddy/Caddyfile; BAK=\$CF.bak.\$(date +%Y%m%d_%H%M%S)
  [ \"\$(sudo sha256sum \$CF | cut -d' ' -f1)\" = '$EXPECT_SHA' ] || { echo 'live file changed meanwhile: stop' >&2; exit 3; }
  sudo cp -p \$CF \$BAK; echo \"  backup: \$BAK\"
  sudo cp \$D/Caddyfile \$CF
  if sudo -u caddy env HOME=/var/lib/caddy caddy validate --config \$CF --adapter caddyfile >/dev/null 2>&1 && sudo systemctl reload caddy; then
    echo '  PASS  live file validates, caddy reloaded'
  else
    echo '  FAIL  validate or reload failed: restoring the backup' >&2
    sudo cp -p \$BAK \$CF && sudo systemctl reload caddy && echo '  restored and reloaded' >&2
    exit 1
  fi")" || { printf '%s\n' "$out" >&2; echo "apply FAILED (the remote half restored the backup if it had made one)" >&2; exit 1; }
printf '%s\n' "$out"
BAK="$(printf '%s\n' "$out" | sed -n 's/^  backup: //p')"
[ -n "$BAK" ] && echo "backup on the server: $BAK"
echo "rollback check, run it before any restore (expect 30 '>' lines and no '<' line, plus the two hunk-header lines starting with a digit): ssh -o BatchMode=yes questhub \"sudo diff $BAK /etc/caddy/Caddyfile\" | cut -c1 | sort | uniq -c"
echo "installed. Next: smoke POST https://app.trustintheweb.org/link and GET /l/<id> (see the services report)."
