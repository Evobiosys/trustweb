#!/usr/bin/env bash
#
# Rebuilds idea2.site/trustweb: a copy of idea2.site/web-of-trust/'s front
# door, retitled TrustWeb, with several sections replaced outright (see
# scripts/tw-front-door/*.html, each a committed, reviewable fragment, not a
# hand edit). Was idea2.site/tw until 2026-09-25; /tw, /trust-web and their
# case spellings now redirect to this canonical /trustweb/ (Caddy, not this
# script); the app lives at app.idea2.site/trustweb/, a separate site block.
#
# 2026-10-06 (wave 1733): the page assembly moved out of this file into
# scripts/tw-front-door/tw_site.py (same exact-text / regex replacements, same
# fragments, plus the site bar with [Demo] [Install], the wide footer, the
# features, use cases and source code sections, and the subpages why /
# pricing / feedback / faq / imprint / privacy / terms). This script fetches
# the source, runs it, and deploys.
#
#   ./scripts/build_tw_front_door.sh --draft     publish to idea2.site/trustweb/draft/ (noindex, terms page included)
#   ./scripts/build_tw_front_door.sh             PRODUCTION: idea2.site/trustweb/ (keeps the draft/ folder)
#   TW_BUILD_ONLY=<dir> ./scripts/build_tw_front_door.sh [--draft]   build into <dir>, touch nothing on the server
#
# THE ONE FLAG: SERVICES_LIVE below (or TW_SERVICES_LIVE=1, or --services-live).
# 0 = pricing and privacy say hosting and server transcription are "starting
# soon (experimental)"; 1 = they say it is switched on. The orchestrator flips
# it after the services and the app are live.
# terms.html is built for --draft only (Jakob has not approved it);
# --publish-terms (or TW_PUBLISH_TERMS=1) publishes it on production and links
# it from the footer.
#
# What the fragments do (the lessons that cost real time, kept here):
#   - hero-explainer.html: the "scalable / discreet / targeted" sentence, as
#     focusable-span terms that reveal their reasoning and an example on hover,
#     tap or keyboard focus, each with a "Learn more" link into why.html.
#   - the .term hover component is a plain focusable <span> (tabindex="0"),
#     not <details>: a closed <details> suppresses its own non-summary content
#     at the layout level, so no CSS on a descendant can make it render.
#   - a <div> inside a <p> or a <span> silently ejects content to an unrelated
#     place in the DOM (HTML5 implied end tags, no parse error). Verify the
#     structure in a real browser (closest / parentElement), never with
#     Python's html.parser.
#   - overflow:hidden on an ancestor clips descendants AND hides the clipping
#     from a naive scrollWidth check.
#
# This is a deliberate hand-kept duplicate, not a template render: idea2.site
# keeps several near-identical copies of the plain front door. It lives in its
# own directory, /srv/questhub-static/idea2-tw, with its own SELinux context,
# separate from anything deploy_wot.sh pushes to.
#
# Re-run this any time /srv/questhub-static/idea2-web-of-trust/index.html
# changes, to carry a source edit over -- or any time a file under
# scripts/tw-front-door/ changes, to push a copy-only edit. It always
# re-fetches the current source rather than assuming it still matches a
# previous run. If the source drifted, tw_site.py exits non-zero and lists
# what it could not find.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRAG="$REPO/scripts/tw-front-door"
SRC=/srv/questhub-static/idea2-web-of-trust/index.html
PROD_DIR=/srv/questhub-static/idea2-tw
DRAFT_DIR="$PROD_DIR/draft"
REF=/srv/questhub-static/wot-app   # a directory whose SELinux context is known good
SSHENV=(env SSH_ASKPASS="$HOME/.ssh/questhub-jump-askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0)

SERVICES_LIVE="${TW_SERVICES_LIVE:-0}"   # <- the one flag, see the header
PUBLISH_TERMS="${TW_PUBLISH_TERMS:-0}"
DRAFT=0
for arg in "$@"; do
  case "$arg" in
    --draft) DRAFT=1 ;;
    --services-live) SERVICES_LIVE=1 ;;
    --publish-terms) PUBLISH_TERMS=1 ;;
    *) echo "unknown option: $arg (use --draft, --services-live, --publish-terms)" >&2; exit 2 ;;
  esac
done

WORK="$(mktemp -d /tmp/tw-front-door.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
OUT="$WORK/out"

echo "... build_tw_front_door script running ..."
echo "--------"

rsh() { "${SSHENV[@]}" ssh questhub "$@"; }

# node has its own network allow rule on this Mac (python3 and curl are blocked by LuLu);
# redirects are not followed, so a 302 reads as 302.
http_code() {
  node -e 'fetch(process.argv[1], { redirect: "manual", signal: AbortSignal.timeout(20000) }).then((r) => console.log(r.status), () => console.log("ERR"))' "$1"
}

echo "fetching $SRC"
"${SSHENV[@]}" scp -q "questhub:$SRC" "$WORK/source_index.html"

ARGS=(--src "$WORK/source_index.html" --frag "$FRAG" --out "$OUT")
[ "$DRAFT" = 1 ] && ARGS+=(--draft)
[ "$SERVICES_LIVE" = 1 ] && ARGS+=(--services-live)
[ "$PUBLISH_TERMS" = 1 ] && ARGS+=(--publish-terms)
python3 -I "$FRAG/tw_site.py" "${ARGS[@]}"

# Build-only mode: write the pages to TW_BUILD_ONLY and stop before touching the server.
if [ -n "${TW_BUILD_ONLY:-}" ]; then
  mkdir -p "$TW_BUILD_ONLY"
  cp "$OUT"/*.html "$TW_BUILD_ONLY/"
  echo "  build-only: wrote $(ls "$OUT" | tr '\n' ' ')to $TW_BUILD_ONLY (nothing deployed)"
  exit 0
fi

push_pages() {  # $1 = destination directory on the server
  local dest="$1" f
  rsh "mkdir -p $dest"
  for f in "$OUT"/*.html; do
    "${SSHENV[@]}" scp -q "$f" "questhub:$dest/$(basename "$f")"
  done
  rsh "chmod -R a+rX $dest && sudo chcon -R --reference=$REF $dest"
}

if [ "$DRAFT" = 1 ]; then
  BASE_URL="https://idea2.site/trustweb/draft"
  # only ever touches the draft folder, never the production files next to it
  rsh "mkdir -p $DRAFT_DIR && find $DRAFT_DIR -mindepth 1 -maxdepth 1 -exec rm -rf {} +"
  push_pages "$DRAFT_DIR"
  echo "  pushed draft -> $DRAFT_DIR"
else
  BASE_URL="https://idea2.site/trustweb"
  # everything except the draft folder is replaced
  rsh "sudo mkdir -p $PROD_DIR && sudo chown almalinux:almalinux $PROD_DIR && find $PROD_DIR -mindepth 1 -maxdepth 1 ! -name draft -exec rm -rf {} +"
  push_pages "$PROD_DIR"
  echo "  pushed production -> $PROD_DIR (draft/ kept)"
fi

echo "--------"
echo "pages (expect 200):"
status=0
for f in "$OUT"/*.html; do
  name="$(basename "$f")"
  if [ "$name" = "index.html" ]; then url="$BASE_URL/"; else url="$BASE_URL/$name"; fi
  code="$(http_code "$url")"
  echo "  $url  $code"
  [ "$code" = "200" ] || status=1
done
if [ "$DRAFT" = 0 ]; then
  # Caddy's `redir ... temporary` answers 302; only /trustweb -> /trustweb/ is a 308.
  tw_alias_code="$(http_code https://idea2.site/tw)"
  echo "  https://idea2.site/tw (alias, expect 302)  $tw_alias_code"
  [ "$tw_alias_code" = "302" ] || status=1
fi
if [ "$status" = 0 ]; then
  echo "all good"
else
  echo "NOT all 200 -- check the Caddy route" >&2
  exit 1
fi
