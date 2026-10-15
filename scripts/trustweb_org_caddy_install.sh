#!/bin/bash
# Wave 8 (organizer): put the organizer routes /org and /org/* (with log_skip) into the app.idea2.site, app.trustintheweb.org and
# app.trustweb.one (wave 6c) blocks of the live Caddyfile on questhub. Same shape as trustweb_links_caddy_install.sh (wave 5). RUN BY THE ORCHESTRATOR, after the unit has the new code
# (the unit answers 404/405 for these paths before that, so the order is: services deploy, then this script).
#
#   EXPECT_SHA=<sha256 of the live Caddyfile> trustweb_org_caddy_install.sh            validate only: fetch the live file, edit a COPY, validate the copy
#                                                                                           on the server as user caddy; changes nothing
#   EXPECT_SHA=<sha256> trustweb_org_caddy_install.sh --apply                          the same, then: backup, install, validate the live file, reload;
#                                                                                           restores the backup if validate or reload fails
#   trustweb_org_caddy_install.sh --print-sha                                           print the sha256 of the live Caddyfile and stop (read it, then pass it as EXPECT_SHA)
#
# Guard: EXPECT_SHA is REQUIRED (no default). The live file changed after the wave 5 apply and after wave 6, so no hash is known when this was written:
# fetch it with --print-sha, read the diff this script prints, and only then pass the hash. The edit script refuses a block without exactly one
# wave-5 "handle /l/*" block, and one that has only some of the four new routes.
# Uses the open ControlMaster of `ssh questhub` (BatchMode: fails fast, never prompts; this script never runs the askpass recipe).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
EXPECT_SHA="${EXPECT_SHA:-}"
MODE=validate
case "${1:-}" in
  --apply) MODE=apply ;;
  --print-sha) MODE=sha ;;
  "") ;;
  *) echo "usage: EXPECT_SHA=<sha256> $0 [--apply]   |   $0 --print-sha" >&2; exit 2 ;;
esac
rsh() { ssh -o BatchMode=yes questhub "$@"; }
echo "... trustweb_org_caddy_install running ($MODE) ..."
echo "--------"
ssh -O check questhub 2>/dev/null || { echo "ssh ControlMaster to questhub is not open: stop" >&2; exit 2; }
LOCAL="$(mktemp -d)"; trap 'rm -rf "$LOCAL"' EXIT
rsh 'sudo cat /etc/caddy/Caddyfile' > "$LOCAL/live"
got="$(shasum -a 256 "$LOCAL/live" | cut -d' ' -f1)"
if [ "$MODE" = sha ]; then echo "$got"; exit 0; fi
[ -n "$EXPECT_SHA" ] || { echo "REFUSED: EXPECT_SHA is required. The live Caddyfile has sha256 $got : read the diff below, then re-run with EXPECT_SHA=$got" >&2; REQUIRE=1; }
[ "${REQUIRE:-0}" = 1 ] || [ "$got" = "$EXPECT_SHA" ] || { echo "REFUSED: the live Caddyfile changed since the review (sha256 $got, expected $EXPECT_SHA): re-run the diff first" >&2; exit 3; }
python3 -I "$HERE/trustweb_org_caddy_edit.py" "$LOCAL/live" "$LOCAL/edited"
diff -u --label /etc/caddy/Caddyfile --label Caddyfile.proposed "$LOCAL/live" "$LOCAL/edited" > "$LOCAL/diff" || true
# The reviewed diff was cut against a fixture (line numbers differ from the live file): compare the added and removed lines only.
changed() { grep -E '^[+-]' "$1" | grep -vE '^(\+\+\+|---) '; }
cat "$LOCAL/diff"
echo "--------"
[ "${REQUIRE:-0}" = 0 ] || exit 3
cmp -s "$LOCAL/live" "$LOCAL/edited" && { echo "nothing to change (all three blocks already have the organizer routes)"; exit 0; }
B64="$(base64 < "$LOCAL/edited" | tr -d '\n')"
rsh "set -euo pipefail
  D=\$(mktemp -d /tmp/twcaddyval.XXXXXX); trap 'rm -rf \"\$D\"' EXIT; chmod 755 \$D
  echo '$B64' | base64 -d > \$D/Caddyfile; chmod 644 \$D/Caddyfile
  sudo -u caddy env HOME=/var/lib/caddy caddy validate --config \$D/Caddyfile --adapter caddyfile 2>&1 | tail -n 1
  [ \"\${PIPESTATUS[0]}\" = 0 ] && echo '  PASS  caddy validate of the edited copy'"
[ "$MODE" = apply ] || { echo "validate-only: the live Caddyfile was not touched. Run with --apply to install."; exit 0; }
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
echo "rollback check before any restore: ssh -o BatchMode=yes questhub \"sudo diff $BAK /etc/caddy/Caddyfile\" | cut -c1 | sort | uniq -c   (expect only '>' lines and hunk headers)"
echo "installed. Next: smoke  POST https://app.trustweb.one/org with body {} -> 400; GET /org -> 405; POST /org/hit {\"event\":\"0000000000000000\",\"kind\":\"opened\"} -> 204"
