#!/usr/bin/env bash
#
# Deploy the whole Vertrauensnetz surface to its canonical homes.
#
#   idea2.site/web-of-trust/   the project's front door (server-side content)
#   idea2.site/wot             302 -> /web-of-trust/
#   app.idea2.site/wot/demo/   front door + demo overview    (apps/hub)
#   app.idea2.site/wot/demo1/  chat-group query, QR only     (apps/demo)
#   app.idea2.site/wot/demo2/  same, but over the relay       (apps/demo, VITE_WOT_MODE=relay)
#   app.idea2.site/wot/demo3/  device to device, no server   (apps/demo, VITE_WOT_MODE=webrtc)
#   app.idea2.site/wot/demo6/  the ladder, visible           (apps/demo, VITE_WOT_MODE=ladder)
#   app.idea2.site/wot/demo20/ Jakob's own flat, opt-in only (apps/demo, VITE_WOT_MODE=relay,
#                              VITE_WOT_SCENARIO=geologengasse -- see below, NOT built or
#                              pushed by a plain run of this script)
#   app.idea2.site/wot/demo21/ a question travels one hop further, with    (apps/demo,
#                              consent at each hop                         VITE_WOT_MODE=relay,
#                                                                          VITE_WOT_SCENARIO=secondHop)
#                              A PLAIN run builds and pushes this address-free (VITE_WOT_ADDRESS
#                              unset here, same as demo1/2/3/6): its own seed content (a ladder,
#                              data/second_hop.ts) is generic. Since demo 21 now ALSO carries
#                              demo 20's accommodation query (scenario A -- the flat, the private
#                              calendar, the real address, reused from data/geologengasse.ts /
#                              match/accommodation.ts, not copied), it gets a SECOND, opt-in-only
#                              rebuild inside the SAME DEPLOY_DEMO20 gate below, WITH the address --
#                              a plain run never includes it, exactly like demo 20 itself.
#                              DEVLOG/handover-demo21-two-hop.md.
#   app.idea2.site/wot/demo4/  full app mockup               (demos/app-mockup.html)
#   app.idea2.site/wot/demo5/  gating prototype              (demos/gating-prototype.html)
#   app.idea2.site/wot/app/    mobile-UI LAN alpha client    (apps/mobile-ui)
#   app.idea2.site/trustweb/   TrustWeb, the one merged demo (apps/trustweb; built with
#                              apps/demo's toolchain). Reachable directly, or via the
#                              "Live demo" card on idea2.site/trustweb/ below. Deploy it
#                              ALONE with ONLY_TRUSTWEB=1 ./scripts/deploy_wot.sh --
#                              leaves every /wot/* demo untouched.
#   .../trustweb/demo/           generic seeded demo, no real people (2026-09-27).
#   .../trustweb/emergent-demo/  Emergent Ventures grantee personas, plus Tyler Cowen
#                                at "Intending to connect" -- no other real person.
#   .../trustweb/ea-demo/        effective-giving/EA conference personas, plus William
#                                MacAskill at "Intending to connect" (ea-demo ONLY,
#                                2026-09-27 demo-edit-3) -- no other real person.
#                              One build (apps/trustweb/vite.config.mjs has all three
#                              as extra rollupOptions.input entries alongside index.html
#                              and solo.html), context chosen by path at runtime
#                              (src/solo.ts detectContext()). solo.html itself is
#                              unchanged and stays the generic demo too.
#   app.trustintheweb.org/     the SAME TrustWeb app at its domain's root (wave 3,
#                              2026-10-07), built with base "/" and linking to the
#                              website at https://trustintheweb.org/. Deploy it ALONE
#                              (never touches app.idea2.site) with
#                                TW_APP_TARGET=trustintheweb ./scripts/deploy_wot.sh
#                              Its own directory /srv/questhub-static/app-trustintheweb,
#                              its own Caddy site block (scripts/trustweb_domains.sh).
#                              Storage is per origin: a phone's TrustWeb data stays on
#                              the origin it was made on (app.idea2.site for everyone
#                              before 2026-10-07); moving = Backup there, Restore here.
#   idea2.site/trustweb/       NOT the app (reversed 2026-09-25, owner: "/tw should
#                              redirect to /trustweb and /trustweb should show what /tw
#                              shows, instead of directing to the app"). A TrustWeb-
#                              branded copy of the idea2.site/web-of-trust/ front door,
#                              its own directory (/srv/questhub-static/idea2-tw),
#                              rebuilt by scripts/build_tw_front_door.sh -- this script
#                              never touches it. /tw, /trust-web and their case
#                              spellings redirect here (Caddy).
#
# questhub.eco stays under the hood: it hosts the relay process and nothing
# user-facing. app.idea2.site proxies /relay/* to it so the demo pages talk to
# one origin only.
#
# Two things this script exists to get right, both learned by breaking them:
#
#   1. Each app is built with an ABSOLUTE base matching its deploy path. With a
#      relative base, opening the page without its trailing slash resolves the
#      assets against the site root, everything 404s, and the page renders as a
#      silent black rectangle. See apps/demo/vite.config.ts.
#
#   2. A new directory under /srv/questhub-static gets SELinux context var_t,
#      and Caddy then serves 404 for everything inside it. restorecon does NOT
#      fix this -- the context has to be copied from a working sibling with
#      chcon --reference. This costs ten minutes every single time it is
#      forgotten.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_APP=/srv/questhub-static/app-idea2-wot
REMOTE_TRUSTWEB=/srv/questhub-static/app-idea2-trustweb
REF=/srv/questhub-static/wot-app   # a directory whose SELinux context is known good
SSHENV=(env SSH_ASKPASS="$HOME/.ssh/questhub-jump-askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0)

echo "... deploy_wot script running ..."
echo "--------"

rsh() { "${SSHENV[@]}" ssh questhub "$@"; }

# Take the demo-20 address OUT of the environment immediately, and keep it in a
# plain shell variable only this script's demo-20 build reads.
#
# Vite inlines any VITE_* variable it finds in the environment into EVERY build
# it runs. Exporting VITE_WOT_ADDRESS for the whole script therefore baked the
# flat's address into demo 1, 2, 3 and 6 as well, which is exactly the leak
# geologengasse.ts was written to prevent. Caught by grepping the deployed
# bundles rather than by reasoning about it. Unsetting it here makes the script
# correct no matter how carelessly it is invoked.
DEMO20_ADDRESS="${VITE_WOT_ADDRESS:-}"
unset VITE_WOT_ADDRESS
unset VITE_WOT_SCENARIO
# Same reason: the website address is set per build (deploy_trustweb_trustintheweb below), never inherited.
unset VITE_TW_SITE_URL

# Push one local directory to one remote directory, then repair its context.
push_dir() {
  local src="$1" dest="$2"
  [ -d "$src" ] || { echo "missing source dir: $src" >&2; exit 1; }
  rsh "sudo mkdir -p $dest && sudo chown -R almalinux:almalinux $dest && rm -rf $dest/*"
  "${SSHENV[@]}" scp -q -r "$src"/* "questhub:$dest/"
  rsh "chmod -R a+rX $dest && sudo chcon -R --reference=$REF $dest"
  echo "  pushed  $(basename "$src") -> $dest"
}

# Push one local file as a directory's index.html.
push_page() {
  local src="$1" dest="$2"
  [ -f "$src" ] || { echo "missing source file: $src" >&2; exit 1; }
  rsh "sudo mkdir -p $dest && sudo chown -R almalinux:almalinux $dest && rm -rf $dest/*"
  "${SSHENV[@]}" scp -q "$src" "questhub:$dest/index.html"
  rsh "chmod -R a+rX $dest && sudo chcon -R --reference=$REF $dest"
  echo "  pushed  $(basename "$src") -> $dest/index.html"
}

# TrustWeb (apps/trustweb) has no node_modules of its own: it imports apps/demo's
# relay, gate and matcher modules directly and is built with apps/demo's tsc/vite.
deploy_trustweb() {
  echo "typechecking, building and pushing trustweb (base /trustweb/)"
  ( cd "$REPO/apps/trustweb" \
    && "$REPO/apps/demo/node_modules/.bin/tsc" --noEmit -p tsconfig.json \
    && TW_BASE=/trustweb/ "$REPO/apps/demo/node_modules/.bin/vite" build >/dev/null )
  push_dir  "$REPO/apps/trustweb/dist"           "$REMOTE_TRUSTWEB"
  # push_dir clears the directory, which takes the front doors' cards
  # (demo-peer.json, published by scripts/deploy_trustweb_peer.sh) with it.
  # Put back the card of every ACTIVE trustweb-peer* instance on questhub
  # (2026-10-06; each runs --card-only --instance <name>; an instance without a
  # public card, like the personal one, is a no-op; none active = nothing to do).
  echo "republishing the front doors' cards (every active trustweb-peer* instance)"
  "$REPO/scripts/deploy_trustweb_peer.sh" --republish-cards
}

# app.trustintheweb.org (wave 3): the same app, base "/", linking to https://trustintheweb.org/.
# Built into its own outDir so apps/trustweb/dist (the app.idea2.site build) is never touched, and
# pushed to its own directory only. The demo inventory card (demo-peer.json) is copied over from the
# app.idea2.site directory on the server: one demo peer, one relay (its card names app.idea2.site/relay;
# both hosts proxy /relay/* to the same relay process, which routes on the recipient DID only).
REMOTE_TRUSTINTHEWEB=/srv/questhub-static/app-trustintheweb
TRUSTINTHEWEB_SITE_URL=https://trustintheweb.org/
deploy_trustweb_trustintheweb() {
  local out; out="$(mktemp -d /tmp/tw-app-trustintheweb.XXXXXX)"
  echo "typechecking, building and pushing trustweb for app.trustintheweb.org (base /, site $TRUSTINTHEWEB_SITE_URL)"
  ( cd "$REPO/apps/trustweb" \
    && "$REPO/apps/demo/node_modules/.bin/tsc" --noEmit -p tsconfig.json \
    && TW_BASE=/ VITE_TW_SITE_URL="$TRUSTINTHEWEB_SITE_URL" "$REPO/apps/demo/node_modules/.bin/vite" build --outDir "$out" --emptyOutDir >/dev/null )
  grep -q "$TRUSTINTHEWEB_SITE_URL" "$out"/assets/*.js || { echo "the build does not link to $TRUSTINTHEWEB_SITE_URL: not pushed" >&2; exit 1; }
  if grep -q '"/trustweb/assets/' "$out/index.html"; then echo "the build still has base /trustweb/: not pushed" >&2; exit 1; fi
  push_dir "$out" "$REMOTE_TRUSTINTHEWEB"
  rm -rf "$out"
  echo "copying the demo inventory card from $REMOTE_TRUSTWEB (if published)"
  rsh "if [ -f $REMOTE_TRUSTWEB/demo-peer.json ]; then cp $REMOTE_TRUSTWEB/demo-peer.json $REMOTE_TRUSTINTHEWEB/ && chmod 0644 $REMOTE_TRUSTINTHEWEB/demo-peer.json && sudo chcon --reference=$REF $REMOTE_TRUSTINTHEWEB/demo-peer.json && echo '  demo-peer.json copied'; else echo '  no card published: nothing to copy'; fi"
}

TRUSTINTHEWEB_URLS=(
  "https://app.trustintheweb.org/"
  "https://app.trustintheweb.org/solo.html"
  "https://app.trustintheweb.org/demo"
  "https://app.trustintheweb.org/emergent-demo"
  "https://app.trustintheweb.org/ea-demo"
  "https://app.trustintheweb.org/manifest.json"
  "https://app.trustintheweb.org/hosted/status"
  "https://app.trustintheweb.org/backup/health"
)

TRUSTWEB_URLS=(
  "https://app.idea2.site/trustweb/"
  "https://app.idea2.site/trustweb"
  "https://app.idea2.site/trustweb/solo.html"
  # Three demo-context entries (2026-09-27, demo-edit-2): one build, one
  # dist/, context chosen by path (apps/trustweb/src/solo.ts detectContext()
  # + apps/trustweb/{demo,emergent-demo,ea-demo}/index.html, listed as
  # separate rollupOptions.input entries in apps/trustweb/vite.config.mjs).
  # Bare paths 308 to their trailing-slash form (Caddy file_server
  # canonical_uris, same as /wot/demo1) -- curl -L above follows that
  # automatically, so checking the bare URL is enough.
  "https://app.idea2.site/trustweb/demo"
  "https://app.idea2.site/trustweb/emergent-demo"
  "https://app.idea2.site/trustweb/ea-demo"
)
# idea2.site/trustweb, /tw, /TrustWeb, /trust-web deliberately NOT in this
# list: since 2026-09-25 idea2.site/trustweb serves a TrustWeb-branded copy
# of the front door (scripts/build_tw_front_door.sh, not this script), and
# every other spelling just redirects there. A 200 (or 308) on any of them
# says nothing about whether THIS deploy, of the app, actually succeeded.

case "${TW_APP_TARGET:-}" in
  ""|idea2) ;;
  trustintheweb) ;;
  *) echo "unknown TW_APP_TARGET: ${TW_APP_TARGET} (idea2 or trustintheweb)" >&2; exit 2 ;;
esac

if [ "${TW_APP_TARGET:-}" = "trustintheweb" ]; then
  deploy_trustweb_trustintheweb
elif [ "${ONLY_TRUSTWEB:-}" = "1" ]; then
  deploy_trustweb
else
echo "building and pushing demo1 (base /wot/demo1/, QR only)"
( cd "$REPO/apps/demo" && WOT_BASE=/wot/demo1/ npx vite build >/dev/null )
push_dir  "$REPO/apps/demo/dist"               "$REMOTE_APP/demo1"

# Demo 2 is the SAME app with the transport switched at build time, so it
# reuses dist/. Each build is pushed immediately, before the next overwrites it.
echo "building and pushing demo2 (base /wot/demo2/, over the relay)"
( cd "$REPO/apps/demo" && WOT_BASE=/wot/demo2/ VITE_WOT_MODE=relay npx vite build >/dev/null )
push_dir  "$REPO/apps/demo/dist"               "$REMOTE_APP/demo2"

# mobile-ui takes its base on the CLI (no base in its vite.config). It used to
# be built with --base=/wot-app/ and served from questhub.eco; those absolute
# asset paths are why it could not simply be re-routed onto idea2.
echo "building and pushing demo3 (base /wot/demo3/, direct device to device)"
( cd "$REPO/apps/demo" && WOT_BASE=/wot/demo3/ VITE_WOT_MODE=webrtc npx vite build >/dev/null )
push_dir  "$REPO/apps/demo/dist"               "$REMOTE_APP/demo3"

echo "building and pushing demo6 (base /wot/demo6/, the ladder)"
( cd "$REPO/apps/demo" && WOT_BASE=/wot/demo6/ VITE_WOT_MODE=ladder npx vite build >/dev/null )
push_dir  "$REPO/apps/demo/dist"               "$REMOTE_APP/demo6"

echo "building and pushing demo21 (base /wot/demo21/, a question travels one hop further, ADDRESS-FREE)"
( cd "$REPO/apps/demo" && WOT_BASE=/wot/demo21/ VITE_WOT_MODE=relay VITE_WOT_SCENARIO=secondHop npx vite build >/dev/null )
push_dir  "$REPO/apps/demo/dist"               "$REMOTE_APP/demo21"

# Demo 20 (Jakob's own flat, his own web of trust) is DELIBERATELY opt-in:
# a plain `./scripts/deploy_wot.sh` run never touches it, never requires
# VITE_WOT_ADDRESS, and never risks publishing the owner's real address
# by accident. Demo 21 now ALSO carries the accommodation query (scenario A,
# reused from demo 20's own modules -- see data/second_hop.ts's own doc
# comment), so it gets the SAME opt-in treatment: the unconditional build
# just above never sets VITE_WOT_ADDRESS, and this block rebuilds+repushes
# demo 21 a SECOND time, WITH the real address, only when opted in --
# overwriting the address-free push above. Build and push both only with:
#
#   DEPLOY_DEMO20=1 VITE_WOT_ADDRESS="Geologengasse <Hausnummer>, 1030 Wien" \
#     ./scripts/deploy_wot.sh
#
# See apps/demo/src/data/geologengasse.ts's module doc for why the address
# is a build-time env var and never a literal in this repo -- and read this
# script's own header comment ("don't publish this") before ever running
# this block against the public app.idea2.site host: that host is reachable
# by anyone with the URL, and demo 20's AND demo 21's built bundles
# necessarily contain the address in cleartext once VITE_WOT_ADDRESS is
# supplied (a fully client-side app has no other way to answer with it
# locally).
# RETIRED 2026-10-05 (owner: "this should be deleted"): demo20 exposed a real
# street address; app.idea2.site/wot/demo20/ is now a redirect to /trustweb/.
# The opt-in build below is refused so no run can ever republish it.
if [ "${DEPLOY_DEMO20:-}" = "1" ]; then
  echo "demo20 is retired (2026-10-05) and must not be republished; its URL redirects to /trustweb/." >&2
  exit 1
fi
if false; then
  if [ -z "$DEMO20_ADDRESS" ]; then
    echo "DEPLOY_DEMO20=1 but VITE_WOT_ADDRESS is not set -- refusing to build a demo whose whole point is answering with a real address it does not have. See this block's own comment." >&2
    exit 1
  fi
  echo "building and pushing demo20 (base /wot/demo20/, Jakob's own flat)"
  ( cd "$REPO/apps/demo" && WOT_BASE=/wot/demo20/ VITE_WOT_MODE=relay VITE_WOT_SCENARIO=geologengasse VITE_WOT_ADDRESS="$DEMO20_ADDRESS" npx vite build >/dev/null )
  push_dir  "$REPO/apps/demo/dist"             "$REMOTE_APP/demo20"
  echo "rebuilding and re-pushing demo21 WITH the address (base /wot/demo21/, opt-in only -- overwrites the address-free push above)"
  ( cd "$REPO/apps/demo" && WOT_BASE=/wot/demo21/ VITE_WOT_MODE=relay VITE_WOT_SCENARIO=secondHop VITE_WOT_ADDRESS="$DEMO20_ADDRESS" npx vite build >/dev/null )
  push_dir  "$REPO/apps/demo/dist"             "$REMOTE_APP/demo21"
else
  echo "skipping demo20, and demo21 stays address-free (opt-in only -- set DEPLOY_DEMO20=1 and VITE_WOT_ADDRESS to include both)"
fi

# mobile-ui imports @resource-web/app-profiles as a workspace package and
# resolves it through that package's dist/, not its source. Skipping this build
# silently ships whatever strings dist/ happened to hold: the first deploy after
# the copy rewrite still served "Wer hat ein Dach frei?" from a stale dist while
# the source said otherwise, and nothing anywhere reported an error.
echo "building the app-profiles package (mobile-ui reads its dist, not its source)"
( cd "$REPO/packages/app-profiles" && npx tsc -p tsconfig.json >/dev/null )

echo "building and pushing the mobile-ui app (base /wot/app/)"
( cd "$REPO/apps/mobile-ui" && npx vite build --base=/wot/app/ >/dev/null )
push_dir  "$REPO/apps/mobile-ui/dist"          "$REMOTE_APP/app"

echo "pushing the static pages"
push_dir  "$REPO/apps/hub"                     "$REMOTE_APP/demo"
# demo4 (app mockup) and demo5 (gating prototype) retired 2026-10-05: their
# URLs are redirect pages to /trustweb/, so they are no longer pushed here.

deploy_trustweb
fi

echo "--------"
echo "verifying (a 200 for each, with AND without the trailing slash)"
fail=0
verify_urls=(
  "https://idea2.site/wot"
  "https://app.idea2.site/wot/demo/"
  "https://app.idea2.site/wot/demo"
  "https://app.idea2.site/wot/demo1/"
  "https://app.idea2.site/wot/demo1"
  "https://app.idea2.site/wot/demo1/nachweis/"
  "https://app.idea2.site/wot/demo2/"
  "https://app.idea2.site/wot/demo2"
  "https://app.idea2.site/wot/demo3/"
  "https://app.idea2.site/wot/demo6/"
  "https://app.idea2.site/wot/demo21/"
  "https://app.idea2.site/wot/app/"
  "https://app.idea2.site/wot/app"
  "https://evobiosys.org/rebiosys/"
)
if [ "${TW_APP_TARGET:-}" = "trustintheweb" ]; then
  verify_urls=("${TRUSTINTHEWEB_URLS[@]}")
elif [ "${ONLY_TRUSTWEB:-}" = "1" ]; then
  verify_urls=("${TRUSTWEB_URLS[@]}")
else
  verify_urls+=("${TRUSTWEB_URLS[@]}")
fi
# Only checked when demo20 was actually built and pushed this run -- a plain
# run never pushed it, so checking for it unconditionally would report a
# false failure every single time.
if [ "${DEPLOY_DEMO20:-}" = "1" ]; then
  verify_urls+=("https://app.idea2.site/wot/demo20/")
fi
for u in "${verify_urls[@]}"; do
  # curl prints "000" for %{http_code} on a connection failure AND exits
  # non-zero, so a naive `|| echo 000` yields "000000". Take the last three
  # characters and be done with it.
  code=$(curl -sSL -o /dev/null -w '%{http_code}' --max-time 20 "$u" 2>/dev/null || true)
  code=${code: -3}
  via=""
  # A local outbound block (LuLu on this laptop refuses :443 in ~15ms) is not
  # the same thing as a broken deploy, and must not be reported as one. Retry
  # from the server, which reaches the public URL over its own loopback, and
  # label the row so nobody mistakes it for a client-side check.
  if [ "$code" != "200" ]; then
    server_code=$(rsh "curl -sSL -o /dev/null -w '%{http_code}' --max-time 15 '$u'" 2>/dev/null || true)
    server_code=${server_code: -3}
    if [ "$server_code" = "200" ]; then
      code="$server_code"
      via="  (from the server; this laptop's outbound to :443 is blocked)"
    fi
  fi
  printf '  %-46s %s%s\n' "$u" "$code" "$via"
  [ "$code" = "200" ] || fail=1
done

relay_host=app.idea2.site
[ "${TW_APP_TARGET:-}" = "trustintheweb" ] && relay_host=app.trustintheweb.org
relay=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -X POST \
  "https://$relay_host/relay/send" -H 'content-type: application/json' \
  -d '{"to":"did:peer:2.deploycheck"}' 2>/dev/null || true)
relay=${relay: -3}
if [ "$relay" != "202" ]; then
  relay=$(rsh "curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -X POST https://$relay_host/relay/send -H 'content-type: application/json' -d '{\"to\":\"did:peer:2.deploycheck\"}'" 2>/dev/null || true)
  relay=${relay: -3}
fi
printf '  %-46s %s\n' "POST $relay_host/relay/send" "$relay"
[ "$relay" = "202" ] || fail=1

echo "--------"
if [ "$fail" = "0" ]; then
  echo "all good"
  if [ "${TW_APP_TARGET:-}" = "trustintheweb" ]; then echo "live: https://app.trustintheweb.org/"; else echo "live: https://app.idea2.site/wot/demo/"; fi
else
  echo "SOMETHING IS NOT 200 -- read the table above before demoing" >&2
  exit 1
fi
