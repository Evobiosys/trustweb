#!/usr/bin/env bash
#
# Rebuilds idea2.site/trustweb: a copy of idea2.site/web-of-trust/'s front
# door, retitled TrustWeb, with several sections replaced outright (not
# just display text -- see scripts/tw-front-door/*.html, each a committed,
# reviewable fragment, not a hand edit). Was idea2.site/tw until 2026-09-25;
# /trustweb used to redirect to the app instead (owner reversed it: "/tw
# should redirect to /trustweb and /trustweb should show what /tw shows,
# instead of directing to the app"). /tw, /trust-web and their case
# spellings now all redirect to this canonical /trustweb/ (Caddy, not this
# script); the app is still one click away via this page's own "Live demo"
# card, which points at app.idea2.site/trustweb/, a separate site block.
#
#   - hero-explainer.html: inserted right under the h1. The "targeted /
#     discreet / scalable" sentence, as focusable-span terms that reveal
#     their reasoning and an example on hover, tap, or keyboard focus, each
#     with a "Learn more" link into why.html.
#   - live-demos.html: replaces the demos section outright. Exactly ONE
#     live-demo card (TrustWeb); the gating prototype gets a plain text
#     link instead of a card, per the owner's "only one live demo" call.
#   - how-it-works.html: replaces the old 4-step ceremony description with
#     "two sides of one coin": taking notes, then querying -- notes have to
#     exist first.
#   - game-phases.html: a new section, early / mid / late game.
#   - specifically-useful.html: a new section, the 8 criteria for when this
#     kind of infrastructure is actually the right tool, same hover pattern.
#   - why.html: a second page, pushed alongside index.html, with the fuller
#     reasoning behind every "Learn more" link above.
#   - style-additions.css: the CSS all of the above needs. The .term hover
#     component is a plain focusable <span> (tabindex="0"), not <details>: a
#     closed <details> suppresses its own non-summary content at the layout
#     level internally, so no CSS on a descendant (not display:block, not a
#     JS-toggled class) can make it actually render without the real [open]
#     attribute -- tried first, dropped after verifying live that computed
#     style said display:block while the real box was 0x0. A plain span has
#     none of that, so :hover/:focus-within alone reveal it correctly, no
#     script needed at all.
#
# This is a deliberate hand-kept duplicate, not a template render: idea2.site
# already keeps three near-identical copies of the plain front door (see
# DEVLOG/result-report-trustweb-app.md's "Files changed" section), and this
# is now a fourth, with real content differences on top of the rename. It
# lives in its own directory, /srv/questhub-static/idea2-tw, with its own
# SELinux context -- separate from anything deploy_wot.sh pushes to, so a
# plain deploy run never touches it.
#
# Re-run this any time /srv/questhub-static/idea2-web-of-trust/index.html
# changes, to carry a source edit over -- or any time a file under
# scripts/tw-front-door/ changes, to push a copy-only edit. It always
# re-fetches the current source rather than assuming it still matches a
# previous run.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRAG="$REPO/scripts/tw-front-door"
SRC=/srv/questhub-static/idea2-web-of-trust/index.html
DEST_DIR=/srv/questhub-static/idea2-tw
REF=/srv/questhub-static/wot-app   # a directory whose SELinux context is known good
SSHENV=(env SSH_ASKPASS="$HOME/.ssh/questhub-jump-askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0)
TMPDIR="$(mktemp -d /tmp/tw-front-door.XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT
TMP_INDEX="$TMPDIR/index.html"
TMP_WHY="$TMPDIR/why.html"

echo "... build_tw_front_door script running ..."
echo "--------"

rsh() { "${SSHENV[@]}" ssh questhub "$@"; }

echo "fetching $SRC"
"${SSHENV[@]}" scp -q "questhub:$SRC" "$TMP_INDEX"
cp "$FRAG/why.html" "$TMP_WHY"

python3 - "$TMP_INDEX" "$FRAG" <<'PY'
import re
import sys

path, frag_dir = sys.argv[1], sys.argv[2]
html = open(path, encoding="utf-8").read()

def read(name):
    with open(f"{frag_dir}/{name}", encoding="utf-8") as f:
        return f.read()

# ---- 1. small, exact literal display-text replacements ----------------
# No regex here, so a source edit that MOVES this text (rather than just
# sitting still) fails loudly (the warning below) instead of silently
# matching something else. The old demos-section ReBioSys line ("The
# resource-sharing layer Web of Trust queries run against.") is deliberately
# NOT in this list: it lives inside the block the regex replacement below
# removes outright, so a literal replace here would always report "missing".
replacements = [
    ("<title>Web of Trust · idea2.site</title>", "<title>TrustWeb · idea2.site</title>"),
    ("Join the Web of Trust", "Join TrustWeb"),
    ("can reach through its own Web of Trust.", "can reach through its own TrustWeb."),
    ("<p>Web of Trust. Local-first, no analytics.</p>", "<p>TrustWeb. Local-first, no analytics.</p>"),
]
missing = []
for old, new in replacements:
    if old not in html:
        missing.append(old)
        continue
    html = html.replace(old, new)

# ---- 2. hero: rename the h1, then inject the explainer right under it --
h1_old = '<h1 class="wot">Web <span class="of">of</span> Trust</h1>'
h1_new = '<h1 class="wot">TrustWeb</h1>\n' + read("hero-explainer.html")
if h1_old not in html:
    missing.append(h1_old)
else:
    html = html.replace(h1_old, h1_new)

# ---- 3. CSS: append the new component styles before the source's </style>
style_marker = "</style>\n</head>"
if style_marker not in html:
    missing.append(style_marker)
else:
    html = html.replace(style_marker, read("style-additions.css") + "</style>\n</head>")

# ---- 4. whole-section replacements, by regex (robust to reformatting) --
sections = [
    (r'<!-- ================= LIVE DEMOS ================= -->\n<section class="block" id="demos">.*?</section>',
     '<!-- ================= LIVE DEMOS ================= -->\n<section class="block" id="demos">\n'
     + read("live-demos.html") + '\n</section>'),
    (r'<!-- ================= HOW IT WORKS ================= -->\n<section class="block" id="how">.*?</section>',
     '<!-- ================= HOW IT WORKS ================= -->\n<section class="block" id="how">\n'
     + read("how-it-works.html") + '\n</section>\n'
     + read("game-phases.html") + '\n'
     + read("specifically-useful.html")),
]
for pattern, new in sections:
    if not re.search(pattern, html, flags=re.DOTALL):
        missing.append(f"section pattern: {pattern[:60]}...")
        continue
    html = re.sub(pattern, lambda _m, new=new: new, html, count=1, flags=re.DOTALL)

open(path, "w", encoding="utf-8").write(html)

if missing:
    print("WARNING: expected text/pattern not found (source drifted since this script was written):", file=sys.stderr)
    for m in missing:
        print("  " + repr(m), file=sys.stderr)
    sys.exit(1)
PY

rsh "sudo mkdir -p $DEST_DIR && sudo chown -R almalinux:almalinux $DEST_DIR && rm -rf $DEST_DIR/*"
"${SSHENV[@]}" scp -q "$TMP_INDEX" "questhub:$DEST_DIR/index.html"
"${SSHENV[@]}" scp -q "$TMP_WHY" "questhub:$DEST_DIR/why.html"
rsh "chmod -R a+rX $DEST_DIR && sudo chcon -R --reference=$REF $DEST_DIR"

echo "  pushed -> $DEST_DIR/index.html and why.html"
echo "--------"
echo "remaining 'Web of Trust' text in the copy (expected: the repo name, real URLs, and the commented-out cards -- review this list, don't just check it's non-empty):"
rsh "grep -noiE 'web[- ]of[- ]trust' $DEST_DIR/index.html" || true
echo "--------"
code=$(curl -sSL -o /dev/null -w '%{http_code}' --max-time 15 https://idea2.site/trustweb/)
why_code=$(curl -sSL -o /dev/null -w '%{http_code}' --max-time 15 https://idea2.site/trustweb/why.html)
# The @trustweb_alias block (/tw, /trust-web, case spellings) redirects with
# Caddy's `redir ... temporary`, which is a 302 -- matching this Caddyfile's
# established convention for every other cross-path alias in it. Only the
# bare-path-to-trailing-slash canonicalization (/trustweb -> /trustweb/) is
# a 308.
tw_alias_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://idea2.site/tw)
echo "  https://idea2.site/trustweb/           $code"
echo "  https://idea2.site/trustweb/why.html   $why_code"
echo "  https://idea2.site/tw (alias, expect 302) $tw_alias_code"
if [ "$code" = "200" ] && [ "$why_code" = "200" ] && [ "$tw_alias_code" = "302" ]; then
  echo "all good"
else
  echo "NOT 200 -- check the Caddy route" >&2
  exit 1
fi
