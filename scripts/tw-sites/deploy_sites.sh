#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
#
# Pushes the three built sites (scripts/tw-sites/build_sites.py) to questhub. Static files only: Caddy and DNS are
# NOT touched here (see DEPLOY.txt for those steps, which wait for Jakob's yes).
#
#   scripts/tw-sites/deploy_sites.sh --dry                      print every step, change nothing
#   TW_SITES_APPROVED=1 scripts/tw-sites/deploy_sites.sh        build into /tmp, rsync the three folders (additive only), fix modes
#
# Without --dry the script refuses unless TW_SITES_APPROVED=1 is set: the orchestrator sets it only after Jakob's yes.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATIC=/srv/questhub-static
REF=$STATIC/wot-app   # a directory whose SELinux context is known good (same as build_tw_front_door.sh)
SITES=(trustintheweb-org trustintheweb-com trustweb-one)
SSHENV=(env SSH_ASKPASS="$HOME/.ssh/questhub-jump-askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0)

DRY=0
for arg in "$@"; do
  case "$arg" in
    --dry) DRY=1 ;;
    *) echo "unknown option: $arg (use --dry)" >&2; exit 2 ;;
  esac
done

echo "... deploy_sites script running ..."
echo "--------"
if [ "$DRY" = 0 ] && [ "${TW_SITES_APPROVED:-}" != 1 ]; then
  echo "refused: not approved. Run with --dry to see the plan; TW_SITES_APPROVED=1 only after Jakob's yes." >&2
  exit 3
fi

run() {  # prints the command; runs it only outside --dry
  echo "  \$ $*"
  [ "$DRY" = 1 ] || "$@"
}

OUT="/tmp/tw-sites-deploy.$$"
echo "build into $OUT"
run python3 -I "$REPO/scripts/tw-sites/build_sites.py" --out "$OUT" --indexable

for dir in "${SITES[@]}"; do
  echo "--------"
  echo "site $dir -> questhub:$STATIC/$dir (rsync -a: files are added or replaced, none removed on the server)"
  run "${SSHENV[@]}" ssh questhub "mkdir -p $STATIC/$dir"
  run "${SSHENV[@]}" rsync -a -e ssh "$OUT/$dir/" "questhub:$STATIC/$dir/"
  run "${SSHENV[@]}" ssh questhub "chmod -R a+rX $STATIC/$dir && sudo chcon -R --reference=$REF $STATIC/$dir"
done
echo "--------"
if [ "$DRY" = 1 ]; then
  echo "dry run: nothing built, nothing copied. Caddy and DNS steps: scripts/tw-sites/DEPLOY.txt"
else
  echo "files pushed. The Caddy change for trustweb.one is a separate step (DEPLOY.txt, step 3)."
  echo "scratch left in $OUT (under /tmp)"
fi
