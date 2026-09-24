#!/usr/bin/env bash
#
# Rebuilds idea2.site/tw: a copy of idea2.site/web-of-trust/'s front door
# with only the product name swapped to TrustWeb. Display text only -- every
# href, every URL shown as its own label (e.g. "systems/web-of-trust"), the
# GitHub repo name and every commented-out card stay exactly as the source's.
#
# This is a deliberate hand-kept duplicate, not a template render: idea2.site
# already keeps three near-identical copies of this front door (see
# DEVLOG/result-report-trustweb-app.md's "Files changed" section), and this
# is now a fourth. It lives in its own directory, /srv/questhub-static/
# idea2-tw, with its own SELinux context -- separate from anything
# deploy_wot.sh pushes to, so a plain deploy run never touches it.
#
# Re-run this any time /srv/questhub-static/idea2-web-of-trust/index.html
# changes, to carry the edit over to the /tw copy. It always re-fetches the
# current source rather than assuming it still matches a previous run.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC=/srv/questhub-static/idea2-web-of-trust/index.html
DEST_DIR=/srv/questhub-static/idea2-tw
REF=/srv/questhub-static/wot-app   # a directory whose SELinux context is known good
SSHENV=(env SSH_ASKPASS="$HOME/.ssh/questhub-jump-askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0)
TMP="$(mktemp /tmp/tw-front-door.XXXXXX.html)"
trap 'rm -f "$TMP"' EXIT

echo "... build_tw_front_door script running ..."
echo "--------"

rsh() { "${SSHENV[@]}" ssh questhub "$@"; }

echo "fetching $SRC"
"${SSHENV[@]}" scp -q "questhub:$SRC" "$TMP"

python3 - "$TMP" <<'PY'
import sys

path = sys.argv[1]
html = open(path, encoding="utf-8").read()

# Exact literal replacements only -- no regex, so a source edit that moves
# this text (rather than just editing it) fails loudly (the warning below)
# instead of silently matching something else.
replacements = [
    ("<title>Web of Trust · idea2.site</title>", "<title>TrustWeb · idea2.site</title>"),
    ('<h1 class="wot">Web <span class="of">of</span> Trust</h1>', '<h1 class="wot">TrustWeb</h1>'),
    ("Join the Web of Trust", "Join TrustWeb"),
    (
        "The resource-sharing layer Web of Trust queries run against.",
        "The resource-sharing layer TrustWeb queries run against.",
    ),
    ("can reach through its own Web of Trust.", "can reach through its own TrustWeb."),
    ("<p>Web of Trust. Local-first, no analytics.</p>", "<p>TrustWeb. Local-first, no analytics.</p>"),
]

missing = []
for old, new in replacements:
    if old not in html:
        missing.append(old)
        continue
    html = html.replace(old, new)

open(path, "w", encoding="utf-8").write(html)

if missing:
    print("WARNING: expected text not found (source drifted since this script was written):", file=sys.stderr)
    for m in missing:
        print("  " + repr(m), file=sys.stderr)
    sys.exit(1)
PY

rsh "sudo mkdir -p $DEST_DIR && sudo chown -R almalinux:almalinux $DEST_DIR && rm -rf $DEST_DIR/*"
"${SSHENV[@]}" scp -q "$TMP" "questhub:$DEST_DIR/index.html"
rsh "chmod -R a+rX $DEST_DIR && sudo chcon -R --reference=$REF $DEST_DIR"

echo "  pushed -> $DEST_DIR/index.html"
echo "--------"
echo "remaining 'Web of Trust' text in the copy (expected: the repo name, real URLs, and the commented-out cards -- review this list, don't just check it's non-empty):"
rsh "grep -noiE 'web[- ]of[- ]trust' $DEST_DIR/index.html" || true
echo "--------"
code=$(curl -sSL -o /dev/null -w '%{http_code}' --max-time 15 https://idea2.site/tw/)
echo "  https://idea2.site/tw/  $code"
if [ "$code" = "200" ]; then echo "all good"; else echo "NOT 200 -- check the Caddy route" >&2; exit 1; fi
