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
#     with a "Learn more" link into why.html. The source's own subline and
#     herochips get dropped outright (owner: remove them).
#   - hero-cta.html: replaces the join form in the hero with a plain "Open
#     the live demo" button (owner: that's what belongs at the top; the
#     join form moves to a new section just above the footer, alongside a
#     newsletter entry -- both added by this script, not a fragment file,
#     since the join form is EXTRACTED from the source rather than written
#     fresh, and the newsletter script tag is one line).
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

# ---- 2b. drop the subline + herochips from the hero (owner: remove them) --
subline_old = (
    '  <p class="subline">Permission-gated information sharing among organizations and'
    ' in-person-verified communities.</p>\n'
    '  <div class="herochips">\n'
    '    <span class="chip strong">Connecting</span>\n'
    '    <span class="chip strong">Resource sharing through querying</span>\n'
    '  </div>\n'
)
if subline_old not in html:
    missing.append(subline_old)
else:
    html = html.replace(subline_old, '')

# ---- 2c. the join form moves to the very bottom of the page; the hero gets
#          a plain "Open the live demo" button in its place (owner: "the
#          button below should show open the live demo instead of join the
#          web, which should only be at the very bottom, in addition to a
#          newsletter entry"). Extracted AFTER replacement #1 has already
#          renamed its button text, so the literal below must match the
#          renamed text, not the source's original.
joinpanel_old = (
    '  <div class="joinpanel">\n'
    '    <form id="join-form" novalidate>\n'
    '      <div class="joinrow">\n'
    '        <label for="j-email" class="skip">Email</label>\n'
    '        <input type="email" id="j-email" name="email" placeholder="you@example.org" required autocomplete="email">\n'
    '        <button type="submit" class="joinbtn" id="j-submit">Join TrustWeb</button>\n'
    '      </div>\n'
    '      <p class="join-err" id="j-err">Please enter a valid email.</p>\n'
    '      <p class="joinnote">Puts you on the waitlist. No accounts, no tracking, one note when the web widens.</p>\n'
    '      <p class="join-msg" role="status" id="j-msg"></p>\n'
    '    </form>\n'
    '  </div>\n'
)
if joinpanel_old not in html:
    missing.append(joinpanel_old)
else:
    html = html.replace(joinpanel_old, read("hero-cta.html"))
    footer_marker = '<footer>'
    if footer_marker not in html:
        missing.append(footer_marker)
    else:
        bottom_join = (
            '<hr class="rule">\n\n'
            '<!-- ================= JOIN, AT THE BOTTOM ================= -->\n'
            '<section class="block joinbottom" id="join">\n'
            '  <div class="sechead">\n'
            '    <p class="chnum">Stay close</p>\n'
            '    <h2>Join TrustWeb</h2>\n'
            '    <p class="dek">Same waitlist as the button up top used to be -- moved down here so the\n'
            '    top of the page leads with the demo instead.</p>\n'
            '  </div>\n' + joinpanel_old + '</section>\n\n'
        )
        html = html.replace(footer_marker, bottom_join + footer_marker, 1)

# ---- 2d. a newsletter entry, in addition to the join form above (owner's
#          own words) -- reuse the SAME QuestHub widget other idea2.site
#          pages already embed (world-lore/index.html etc.), not a new one.
#          It self-mounts into the page's own <footer>, right before </footer>,
#          because that's what /assets/newsletter-widget.js's own doc comment
#          says it does when no #newsletter-slot exists on the page.
body_close = '</body>'
newsletter_tag = '<script src="/assets/newsletter-widget.js" defer data-project="questhub" data-source="trustweb"></script>\n'
if body_close not in html:
    missing.append(body_close)
else:
    html = html.replace(body_close, newsletter_tag + body_close, 1)

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
