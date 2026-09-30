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
#     the live demo" button. The join form itself is EXTRACTED from the
#     source (not written fresh) and reinserted just above the footer, with
#     a newsletter checkbox spliced in by this script (not a fragment file,
#     since it's inserted into text extracted at build time) -- one email
#     box, not a second separate widget box (owner reverted that).
#   - The Live Demos section is REMOVED outright, not replaced (owner:
#     "take out this section completely"). The footer gets one more link
#     instead, to the existing overview of all live demos
#     (app.idea2.site/wot/demo/), added by this script.
#   - how-it-works.html: replaces the old 4-step ceremony description with
#     "two sides of one coin": taking notes, then querying -- notes have to
#     exist first.
#   - game-phases.html: a new section, early / mid / late game.
#   - specifically-useful.html: a new section, the 8 criteria for when this
#     kind of infrastructure is actually the right tool, same hover pattern.
#   - lineage.html: a new section, adapted from japossert.com's "Spine"
#     illustration -- EvoBioSys at the root (plain, no bloom treatment),
#     QuestHub as the point where the spreading toward other communities
#     happens, TrustWeb grounded at the bottom linking back to this same
#     page. Inserted right before the source's own pre-existing Ecosystem
#     (sibling tools) section. Plain SVG <a> anchors, not an HTML overlay --
#     avoids the div-in-p nesting trap already hit once on this page.
#   - about-us.html: a new section, the team and advisors, from the Manifund
#     application's own "Who is on your team?" answer, inserted just before
#     the join-at-the-bottom section this script also builds.
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

# ---- 2a2. code icon, top-right of the hero (owner: move the visible Code
#           section into an icon, top-right and in the footer). Inserted
#           right after <header class="hero">, before .knot-field, so it
#           sits above it in DOM order too, not just via z-index.
header_hero_old = '<header class="hero">\n  <div class="knot-field" aria-hidden="true">'
code_icon = (
    '<a class="hero-code-icon" href="https://github.com/evobiosys/web-of-trust" '
    'aria-label="View the code on GitHub" title="View the code on GitHub">\n'
    '  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<polyline points="16 18 22 12 16 6"></polyline>'
    '<polyline points="8 6 2 12 8 18"></polyline></svg>\n'
    '</a>\n'
)
if header_hero_old not in html:
    missing.append(header_hero_old)
else:
    html = html.replace(header_hero_old, '<header class="hero">\n' + code_icon + '  <div class="knot-field" aria-hidden="true">')

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
    # ---- 2d. one email box, not two (owner: reverted the separate
    #          newsletter-widget box). A single checkbox on the SAME form,
    #          unchecked by default, and a second, independent submit
    #          listener that -- only when it's checked -- fires a background
    #          subscribe call to the same QuestHub endpoint the widget used
    #          (subscriber.questhub.eco/subscribe, same payload shape), so
    #          checking it is still functionally wired, not just decorative.
    #          Coexists fine with the source's own #join-form submit
    #          listener already in the page (two listeners on one event).
    joinpanel_with_checkbox = joinpanel_old.replace(
        '      </div>\n'
        '      <p class="join-err" id="j-err">Please enter a valid email.</p>\n',
        '      </div>\n'
        '      <label class="nlcheck">'
        '<input type="checkbox" id="j-newsletter" name="newsletter"> '
        'Also put me on the newsletter</label>\n'
        '      <p class="join-msg" role="status" id="j-nl-status"></p>\n'
        '      <p class="join-err" id="j-err">Please enter a valid email.</p>\n',
    )
    if joinpanel_with_checkbox == joinpanel_old:
        missing.append("joinpanel checkbox insertion point")
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
            '  </div>\n' + joinpanel_with_checkbox + '</section>\n\n'
        )
        html = html.replace(footer_marker, read("about-us.html") + '\n' + bottom_join + footer_marker, 1)

# ---- 2e. the newsletter checkbox's own submit listener, right before </body>
body_close = '</body>'
newsletter_script = (
    '<script>\n'
    '(function () {\n'
    '  var form = document.getElementById("join-form");\n'
    '  var nl = document.getElementById("j-newsletter");\n'
    '  var status = document.getElementById("j-nl-status");\n'
    '  if (!form || !nl || !status) return;\n'
    '  function validEmail(v) { return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(v); }\n'
    '  form.addEventListener("submit", function () {\n'
    '    if (!nl.checked) return;\n'
    '    status.className = "join-msg";\n'
    '    status.textContent = "";\n'
    '    var emailEl = document.getElementById("j-email");\n'
    '    var email = emailEl && emailEl.value.trim();\n'
    '    if (!email || !validEmail(email)) return; // the form\'s own required-field/pattern error already covers this\n'
    '    fetch("https://subscriber.questhub.eco/subscribe", {\n'
    '      method: "POST",\n'
    '      headers: { "Content-Type": "application/json" },\n'
    '      body: JSON.stringify({ email: email, project: "questhub", source: "trustweb", gdpr: true })\n'
    '    }).then(function (r) {\n'
    '      if (!r.ok) throw new Error("http_" + r.status);\n'
    '      status.className = "join-msg ok";\n'
    '      status.textContent = "Check your inbox to confirm the newsletter.";\n'
    '    }).catch(function () {\n'
    '      status.className = "join-msg err";\n'
    '      status.textContent = "Newsletter signup failed, please try again.";\n'
    '    });\n'
    '  });\n'
    '})();\n'
    '</script>\n'
)
if body_close not in html:
    missing.append(body_close)
else:
    html = html.replace(body_close, newsletter_script + body_close, 1)

# ---- 2f. footer: one more link, to the existing overview of ALL live demos
#          (app.idea2.site/wot/demo/ -- built and TrustWeb-branded earlier
#          this project), since the on-page demos section is now gone
#          outright (owner: "take out this section completely... only at
#          the end make a link to see an overview of all live demos").
flinks_old = (
    '  <div class="flinks">\n'
    '    <a href="mailto:hello@evobiosys.org">Contact ↗</a>\n'
    '    <a href="https://evobiosys.org/systems/web-of-trust/">Deep dive: systems/web-of-trust ↗</a>\n'
    '  </div>\n'
)
if flinks_old not in html:
    missing.append(flinks_old)
else:
    flinks_new = (
        '  <div class="flinks">\n'
        '    <a href="mailto:hello@evobiosys.org">Contact ↗</a>\n'
        '    <a href="https://evobiosys.org/systems/web-of-trust/">Deep dive: systems/web-of-trust ↗</a>\n'
        '    <a href="https://app.idea2.site/wot/demo/">See an overview of all live demos ↗</a>\n'
        '    <a href="https://github.com/evobiosys/web-of-trust">Code on GitHub ↗</a>\n'
        '  </div>\n'
    )
    html = html.replace(flinks_old, flinks_new)

# ---- 2g. ecosystem cards: SenseMeet and TalkWeave get real links now that
#          both have a live page (sensemeet.org already existed; TalkWeave's
#          landing page already existed too, at evobiosys.org/talkweave/,
#          the more current of its two duplicate deployments -- see the
#          result report for the staleness finding on the idea2.site copy).
ecocard_old = (
    '    <div class="ecocard">\n'
    '      <h3>SenseMeet</h3>\n'
    "      <p>Meeting capture and QR share, so a room's decisions travel with the same consent-gated flow.</p>\n"
    '    </div>\n'
    '    <div class="ecocard">\n'
    '      <h3>TalkWeave</h3>\n'
    '      <p>Live conversation transcripts, local-first, feeding the same profile and resource graph.</p>\n'
    '    </div>\n'
)
if ecocard_old not in html:
    missing.append(ecocard_old)
else:
    ecocard_new = (
        '    <div class="ecocard">\n'
        '      <h3><a href="https://sensemeet.org">SenseMeet ↗</a></h3>\n'
        "      <p>Meeting capture and QR share, so a room's decisions travel with the same consent-gated flow.</p>\n"
        '    </div>\n'
        '    <div class="ecocard">\n'
        '      <h3><a href="https://evobiosys.org/talkweave/">TalkWeave ↗</a></h3>\n'
        '      <p>Live conversation transcripts, local-first, feeding the same profile and resource graph.</p>\n'
        '    </div>\n'
    )
    html = html.replace(ecocard_old, ecocard_new)

# ---- 2g2. ecosystem cards, second row: SovSwitch and SoTranscribe, both
#          live (sovswitch.com, sotranscribe.com, curl-verified 200). Placed
#          directly after the existing three cards, inside the same
#          .ecorow -- style-additions.css scopes #ecosystem .ecorow to
#          flex-wrap+justify-content:center, so this pair wraps to a
#          centered second row rather than left-aligning (standing
#          grid-overflow rule). Descriptions from each site's own live
#          <title>/meta description, not invented.
ecorow_close = (
    '    <div class="ecocard">\n'
    '      <h3><a href="https://evobiosys.org/talkweave/">TalkWeave ↗</a></h3>\n'
    '      <p>Live conversation transcripts, local-first, feeding the same profile and resource graph.</p>\n'
    '    </div>\n'
    '  </div>\n'
    '</section>\n'
    '\n'
    '<hr class="rule">\n'
    '\n'
    '<!-- ================= ABOUT US ================= -->'
)
if ecorow_close not in html:
    missing.append(ecorow_close)
else:
    ecorow_close_new = (
        '    <div class="ecocard">\n'
        '      <h3><a href="https://evobiosys.org/talkweave/">TalkWeave ↗</a></h3>\n'
        '      <p>Live conversation transcripts, local-first, feeding the same profile and resource graph.</p>\n'
        '    </div>\n'
        '    <div class="ecocard">\n'
        '      <h3><a href="https://sovswitch.com">SovSwitch ↗</a></h3>\n'
        "      <p>Sovereign Switch: the pragmatic path off Big Tech, privacy without giving up your devices.</p>\n"
        '    </div>\n'
        '    <div class="ecocard">\n'
        '      <h3><a href="https://sotranscribe.com">SoTranscribe ↗</a></h3>\n'
        '      <p>Sovereign transcription: self-host on your own GPU, or use the hosted tier colocated in Austria.</p>\n'
        '    </div>\n'
        '  </div>\n'
        '</section>\n'
        '\n'
        '<hr class="rule">\n'
        '\n'
        '<!-- ================= ABOUT US ================= -->'
    )
    html = html.replace(ecorow_close, ecorow_close_new, 1)

# ---- 2h. About Us heading (owner: "before my name write Main Builder: Jakob")
main_builder_old = '<h3 style="margin:0 0 6px;font:600 1.1rem var(--sans);color:var(--ink)">Jakob Possert-Bienzle</h3>'
if main_builder_old not in html:
    missing.append(main_builder_old)
else:
    html = html.replace(
        main_builder_old,
        '<h3 style="margin:0 0 6px;font:600 1.1rem var(--sans);color:var(--ink)">Main Builder: Jakob Possert-Bienzle</h3>',
    )

# ---- 2i. lineage diagram (owner: adapt the japossert.com "Spine" graphic --
#          EvoBioSys at the root without the bloom treatment, QuestHub as the
#          point where the spreading happens, TrustWeb grounded at the
#          bottom linking to this same page). Inserted right before the
#          source's own pre-existing "Ecosystem" (sibling tools) section, so
#          the page reads lineage (parent -> this page) then ecosystem
#          (siblings) then team.
ecosystem_marker = '<hr class="rule">\n\n<!-- ================= ECOSYSTEM ================= -->'
if ecosystem_marker not in html:
    missing.append(ecosystem_marker)
else:
    # lineage.html supplies its own leading <hr> (divider before Lineage);
    # the marker's own leading <hr> becomes the divider between Lineage and
    # the native Ecosystem section right after it -- exactly one <hr>
    # between every pair of sections, same convention as every other frag.
    html = html.replace(ecosystem_marker, read("lineage.html") + '\n' + ecosystem_marker, 1)

# ---- 3. CSS: append the new component styles before the source's </style>
style_marker = "</style>\n</head>"
if style_marker not in html:
    missing.append(style_marker)
else:
    html = html.replace(style_marker, read("style-additions.css") + "</style>\n</head>")

# ---- 4. whole-section replacements, by regex (robust to reformatting) --
sections = [
    # Owner: "take out this section completely" -- the whole Live Demos
    # section, its own <hr> included, so header.hero flows straight into the
    # <hr> before the Code section without a doubled-up empty divider.
    (r'<hr class="rule">\n\n<!-- ================= LIVE DEMOS ================= -->\n<section class="block" id="demos">.*?</section>\n\n',
     ''),
    # Owner: move the Code section into an icon (top-right + footer) instead
    # of a full visible section. Its own <hr> included, same reasoning as
    # the Live Demos removal above -- no doubled-up empty divider left behind.
    (r'<hr class="rule">\n\n<!-- ================= CODE ================= -->\n<section class="block" id="code">.*?</section>\n\n',
     ''),
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

# ---- 5. "For EA groups" section, right under the hero (added 2026-09-30).
#          A top-level <section> between two existing ones, never inside a
#          <p> or <span> (the div-in-p nesting trap).
header_close = '</header>\n'
if header_close not in html:
    missing.append(header_close)
else:
    html = html.replace(header_close, header_close + '\n' + read("for-ea-groups.html").rstrip("\n") + '\n', 1)

open(path, "w", encoding="utf-8").write(html)

if missing:
    print("WARNING: expected text/pattern not found (source drifted since this script was written):", file=sys.stderr)
    for m in missing:
        print("  " + repr(m), file=sys.stderr)
    sys.exit(1)
PY

# Build-only mode: TW_BUILD_ONLY=<dir> writes index.html and why.html there
# and stops before touching the server (the source is still fetched, read-only).
if [ -n "${TW_BUILD_ONLY:-}" ]; then
  mkdir -p "$TW_BUILD_ONLY"
  cp "$TMP_INDEX" "$TW_BUILD_ONLY/index.html"
  cp "$TMP_WHY" "$TW_BUILD_ONLY/why.html"
  echo "  build-only: wrote $TW_BUILD_ONLY/index.html and why.html (nothing deployed)"
  exit 0
fi

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
