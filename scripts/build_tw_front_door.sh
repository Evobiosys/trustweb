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
# WHERE (wave 3, 2026-10-07): TW_SITE_HOST picks the site's home, TW_APP_ORIGIN the app it links to.
#   TW_SITE_HOST=idea2.site (default)   idea2.site/trustweb/ (dir idea2-tw), app https://app.idea2.site/trustweb/.
#                                       Since the migration idea2.site/trustweb/* answers 301 to trustintheweb.org,
#                                       so a PRODUCTION run for idea2.site is refused once that redirect is live
#                                       (--draft still works: idea2.site/trustweb/draft/ is still served).
#   TW_SITE_HOST=trustintheweb.org      https://trustintheweb.org/ (dir trustintheweb-org, draft at /draft/),
#                                       app TW_APP_ORIGIN (default https://app.trustweb.one, the app at its root; wave 6c, Jakob 2026-10-08).
#                                       The pages are built exactly as for idea2, then scripts/tw_site_rehost.py
#                                       rewrites the app, feedback and site URLs and the site label, and fails if
#                                       any old idea2 TrustWeb URL is left.
#   TW_SITE_HOST=trustintheweb.com      the hosting site (dir trustintheweb-com, draft at /draft/), app TW_APP_ORIGIN
#                                       (default https://app.trustweb.one). Built by tw_site.py --site com from
#                                       scripts/tw-front-door/com/ alone: no source page is fetched.
#   tw_site.py is also handed --site-host and --app-base (the app's full base: <origin>/trustweb on app.idea2.site,
#   the bare origin elsewhere), so the pages come out right natively (canonical, the white paper anchor, Demo,
#   Install, the feedback endpoint); tw_site_rehost.py stays as the safety net that fails on any old URL.
#   The live production site: TW_SITE_HOST=trustintheweb.org TW_SERVICES_LIVE=1 ./scripts/build_tw_front_door.sh
#
# THREE FLAGS (wave 2: transcription got its own, because it stays off until a
# provider key is placed, whatever hosting does; wave 6: passing a question on through friends got its own):
#   SERVICES_LIVE (TW_SERVICES_LIVE=1 or --services-live): 0 = pricing and privacy
#     say hosting is "starting soon (experimental)"; 1 = switched on.
#   TRANSCRIBE_LIVE (TW_TRANSCRIBE_LIVE=1 or --transcribe-live): 0 = pricing,
#     privacy and FAQ say server transcription is coming and switched off today;
#     1 = switched on (through OpenRouter, see privacy).
#   HOPS_LIVE (TW_HOPS_LIVE=1 or --hops-live, default 0): 0 = the copy says passing a question on through friends is
#     not built yet and today a question reaches your direct connections; 1 = the copy says a question can travel on
#     through friends and you choose how far (one hop by default): the hero line, the "more scalable" popup, the
#     Introductions use case, why.html and the two FAQ answers (all <!--IF:hops-off--> / <!--IF:hops-on--> blocks in
#     scripts/tw-front-door/). Set it to 1 only after the app that relays a question through friends is live on both
#     app hosts. Handled exactly like TW_SERVICES_LIVE: an explicit build env, never inferred from the server.
# TW_TRANSCRIBE_PROVIDER=openrouter|berget|berget-only (default openrouter) says which provider the copy names for
#   server transcription: openrouter = OpenRouter only (no Berget wording anywhere); berget = Berget AI in Sweden
#   with OpenRouter in the US as the fallback; berget-only = Berget alone. Flip it to match the server's status
#   (GET /hosted/status, provider.transcribe) in the same step that switches Berget on. Details: tw-front-door/tw_site.py.
# The orchestrator flips each after the matching service and the app are live
# (GET https://app.idea2.site/hosted/status: hosted:true / transcribe:true).
# terms.html (both sites) is built for --draft, and on production only with
# --publish-terms (or TW_PUBLISH_TERMS=1), which also links it from the footer. Wave 5 (2026-10-07): Jakob asked for
# all legal pages written and published (privacy, data policy, terms, imprint, each marked "AI drafted, subject to
# review"), so the production runs pass TW_PUBLISH_TERMS=1. A production run WITHOUT it drops terms.html and its
# footer link. The script makes no server backup of its own: copy the live folders to ~/tw-backups/ first.
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
SITE_HOST="${TW_SITE_HOST:-idea2.site}"
case "$SITE_HOST" in
  idea2.site)
    PROD_DIR=/srv/questhub-static/idea2-tw
    SITE_URL="https://idea2.site/trustweb"
    APP_ORIGIN="${TW_APP_ORIGIN:-https://app.idea2.site}" ;;
  trustintheweb.org)
    PROD_DIR=/srv/questhub-static/trustintheweb-org
    SITE_URL="https://trustintheweb.org"
    APP_ORIGIN="${TW_APP_ORIGIN:-https://app.trustweb.one}" ;;
  trustintheweb.com)
    PROD_DIR=/srv/questhub-static/trustintheweb-com
    SITE_URL="https://trustintheweb.com"
    APP_ORIGIN="${TW_APP_ORIGIN:-https://app.trustweb.one}" ;;
  *) echo "unknown TW_SITE_HOST: $SITE_HOST (idea2.site, trustintheweb.org or trustintheweb.com)" >&2; exit 2 ;;
esac
if [ "$SITE_HOST" = idea2.site ] && [ "$APP_ORIGIN" != https://app.idea2.site ]; then
  echo "TW_APP_ORIGIN applies to TW_SITE_HOST=trustintheweb.org only (the idea2 build keeps app.idea2.site/trustweb/)" >&2; exit 2
fi
# the app's base URL as tw_site.py wants it: under /trustweb on app.idea2.site, the bare origin on every other host
if [ "$APP_ORIGIN" = https://app.idea2.site ]; then APP_BASE="$APP_ORIGIN/trustweb"; else APP_BASE="$APP_ORIGIN"; fi
if [ "$SITE_HOST" = trustintheweb.com ]; then SITE_KIND=com; else SITE_KIND=org; fi
DRAFT_DIR="$PROD_DIR/draft"
REF=/srv/questhub-static/wot-app   # a directory whose SELinux context is known good
SSHENV=(env SSH_ASKPASS="$HOME/.ssh/questhub-jump-askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0)

SERVICES_LIVE="${TW_SERVICES_LIVE:-0}"   # <- hosting flag, see the header
TRANSCRIBE_LIVE="${TW_TRANSCRIBE_LIVE:-0}"   # <- server transcription flag, see the header
HOPS_LIVE="${TW_HOPS_LIVE:-0}"   # <- passing a question on through friends flag, see the header
INPERSON_LIVE="${TW_INPERSON_LIVE:-0}"   # <- meeting in person flag, see the header
INPERSON_LOOKUP="${TW_INPERSON_LOOKUP:-0}"   # <- typing code/name/DID flag, see the header
INPERSON_ADVANCED="${TW_INPERSON_ADVANCED:-0}"   # <- advanced sharing choices flag, see the header
TRANSCRIBE_PROVIDER="${TW_TRANSCRIBE_PROVIDER:-openrouter}"   # <- which provider the transcription copy names, see the header
case "$TRANSCRIBE_PROVIDER" in
  openrouter|berget|berget-only) ;;
  *) echo "unknown TW_TRANSCRIBE_PROVIDER: $TRANSCRIBE_PROVIDER (openrouter, berget or berget-only)" >&2; exit 2 ;;
esac
PUBLISH_TERMS="${TW_PUBLISH_TERMS:-0}"
DRAFT=0
for arg in "$@"; do
  case "$arg" in
    --draft) DRAFT=1 ;;
    --services-live) SERVICES_LIVE=1 ;;
    --transcribe-live) TRANSCRIBE_LIVE=1 ;;
    --hops-live) HOPS_LIVE=1 ;;
    --inperson-live) INPERSON_LIVE=1 ;;
    --inperson-lookup) INPERSON_LOOKUP=1 ;;
    --inperson-advanced) INPERSON_ADVANCED=1 ;;
    --publish-terms) PUBLISH_TERMS=1 ;;
    *) echo "unknown option: $arg (use --draft, --services-live, --transcribe-live, --hops-live, --inperson-live, --inperson-lookup, --inperson-advanced, --publish-terms)" >&2; exit 2 ;;
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

ARGS=(--frag "$FRAG" --out "$OUT" --site "$SITE_KIND" --site-host "$SITE_HOST" --app-base "$APP_BASE" --transcribe-provider "$TRANSCRIBE_PROVIDER")
if [ "$SITE_KIND" = org ]; then  # the hosting site is built from fragments alone, no source page
  echo "fetching $SRC"
  "${SSHENV[@]}" scp -q "questhub:$SRC" "$WORK/source_index.html"
  ARGS+=(--src "$WORK/source_index.html")
fi
[ "$DRAFT" = 1 ] && ARGS+=(--draft)
[ "$SERVICES_LIVE" = 1 ] && ARGS+=(--services-live)
[ "$TRANSCRIBE_LIVE" = 1 ] && ARGS+=(--transcribe-live)
[ "$HOPS_LIVE" = 1 ] && ARGS+=(--hops-live)
[ "$INPERSON_LIVE" = 1 ] && ARGS+=(--inperson-live)
[ "$INPERSON_LOOKUP" = 1 ] && ARGS+=(--inperson-lookup)
[ "$INPERSON_ADVANCED" = 1 ] && ARGS+=(--inperson-advanced)
[ "$PUBLISH_TERMS" = 1 ] && ARGS+=(--publish-terms)
python3 -I "$FRAG/tw_site.py" "${ARGS[@]}"
if [ "$SITE_HOST" != idea2.site ]; then
  python3 -I "$REPO/scripts/tw_site_rehost.py" --dir "$OUT" --site-host "$SITE_HOST" --app-origin "$APP_ORIGIN"
fi

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

if [ "$DRAFT" = 0 ] && [ "$SITE_HOST" = idea2.site ] && [ "$(http_code https://idea2.site/trustweb/)" = 301 ]; then
  echo "idea2.site/trustweb/ now redirects to https://trustintheweb.org/ (wave 3): a production build there would not be seen." >&2
  echo "Build the live site with TW_SITE_HOST=trustintheweb.org (drafts on idea2.site still work with --draft)." >&2
  exit 2
fi

if [ "$DRAFT" = 1 ]; then
  BASE_URL="$SITE_URL/draft"
  # only ever touches the draft folder, never the production files next to it
  rsh "mkdir -p $DRAFT_DIR && find $DRAFT_DIR -mindepth 1 -maxdepth 1 -exec rm -rf {} +"
  push_pages "$DRAFT_DIR"
  echo "  pushed draft -> $DRAFT_DIR"
else
  BASE_URL="$SITE_URL"
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
if [ "$DRAFT" = 0 ] && [ "$SITE_HOST" = idea2.site ]; then
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
