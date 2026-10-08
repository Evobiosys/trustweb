#!/bin/bash
# Install / update a TrustWeb front-door peer (services/trustweb-peer) and, for
# the demo instance, publish its card next to the app. Idempotent.
#
#   ./scripts/deploy_trustweb_peer.sh [--instance demo|personal] [--host questhub|sebra] [--dry-run] [MODE]
#   MODE (one of):
#     (none)             full deploy: bundle, unit, restart, card (demo) / no card (personal)
#     --card-only        republish only the instance's public card (demo); personal: nothing to do
#     --republish-cards  the card of EVERY active trustweb-peer* instance on the host (deploy_wot.sh calls this)
#     --off              stop and disable the instance (demo: also remove its card); state is kept
#   Defaults (read-only modes only: --dry-run, --card-only, --republish-cards): --instance demo --host questhub
#   (the demo instance runs on questhub only). A full deploy and --off CHANGE a front door: they need
#   --instance, print which front door they act on and ask you to type its name (or pass --confirm <instance>).
#   --instance personal REQUIRES --host (where it runs is Jakob's decision, never a default).
#   --dry-run          prints the plan and the rendered unit, runs READ-ONLY checks on the host, changes nothing.
#
# Why --card-only / --republish-cards exist: scripts/deploy_wot.sh clears the
# whole app directory (rm -rf app-idea2-trustweb/*), which also deletes the
# demo card. deploy_wot.sh runs --republish-cards after every app deploy.
#
# demo:     named Jakob, his ten public lines, forwarding ON, policy open (README.txt).
# personal: Jakob's own front door. Policy granted (grants.json, see
#           trustweb_peer_grant.sh), forwarding ON, its inventory starts EMPTY
#           (zero lines) and only ever holds what scripts/trustweb_inventory_export.ts
#           --send puts there: the lines Jakob allowed in advance. The inventory is
#           a root-only file in /etc handed to the service as a systemd credential.
#           It publishes NO card: its connect link goes only to Jakob (claim) and to
#           the people he grants, so his front door's DID is not on a public URL.
# Same SSH recipe and unit hardening as deploy_trustweb_backup.sh.
set -euo pipefail
echo "... deploy_trustweb_peer running ..."
echo "--------"

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/trustweb_peer_lib.sh
. "$HERE/trustweb_peer_lib.sh"
PEER_DIR="$HERE/../services/trustweb-peer"
CARD_DIR=/srv/questhub-static/app-idea2-trustweb
# Wave 3: the same app also runs at app.trustintheweb.org (its own folder, scripts/deploy_wot.sh TW_APP_TARGET=trustintheweb).
# The demo card goes into every app folder that exists on the host, so a card republished later is never stale on one host.
CARD_DIR_TRUSTINTHEWEB=/srv/questhub-static/app-trustintheweb
CARD_DIR_TRUSTWEB_ONE=/srv/questhub-static/app-trustweb-one
CARD_DIRS="$CARD_DIR $CARD_DIR_TRUSTINTHEWEB $CARD_DIR_TRUSTWEB_ONE"
REF=/srv/questhub-static/wot-app   # a directory whose SELinux context is known good (see deploy_wot.sh)
RELAY=https://app.idea2.site

MODE=full; DRY=0; INST=demo; INST_GIVEN=""; HOSTNAME_ARG=""; CONFIRM=""
usage() { echo "usage: $0 [--instance demo|personal] [--host questhub|sebra] [--dry-run] [--confirm <instance>] [--card-only|--republish-cards|--off]" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --instance) [ $# -ge 2 ] || usage; INST="$2"; INST_GIVEN="$2"; shift 2 ;;
    --confirm) [ $# -ge 2 ] || usage; CONFIRM="$2"; shift 2 ;;
    --host) [ $# -ge 2 ] || usage; HOSTNAME_ARG="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --card-only) MODE=card; shift ;;
    --republish-cards) MODE=republish; shift ;;
    --off) MODE=off; shift ;;
    *) usage ;;
  esac
done
tw_peer_instance "$INST" || { echo "unknown instance: $INST (demo|personal)" >&2; exit 2; }
[ "$MODE" = republish ] || tw_peer_require_host "$HOSTNAME_ARG"
tw_peer_host "${HOSTNAME_ARG:-questhub}" || { echo "unknown host: $HOSTNAME_ARG (questhub|sebra)" >&2; exit 2; }
if [ "$INSTANCE" = demo ] && [ "$RHOST" != questhub ]; then
  echo "the demo instance runs on questhub only (its card is published from questhub's static tree)" >&2; exit 2
fi
# A change to a front door: named explicitly and confirmed before anything on the host is touched.
if [ "$DRY" = 0 ] && { [ "$MODE" = full ] || [ "$MODE" = off ]; }; then
  tw_peer_require_instance "$INST_GIVEN"
  if [ "$MODE" = off ]; then tw_peer_confirm_instance "$CONFIRM" "stop and disable it"
  else tw_peer_confirm_instance "$CONFIRM" "install or update it and restart it"; fi
fi
tw_peer_ssh_prepare
say() { if [ "$DRY" = 1 ]; then echo "[dry-run] would: $*"; else echo "$*"; fi; }

# ---------------------------------------------------------------- units
# The demo unit is byte-identical to the one deployed on 2026-10-06.
render_unit() {
  local node="$1"
  if [ "$INSTANCE" = demo ]; then
    cat <<'UNIT'
[Unit]
Description=TrustWeb demo front-door peer (named Jakob, his ten public lines; forwards asks to its owner; see web-of-trust services/trustweb-peer)
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/trustweb-peer/peer.mjs
Environment=TW_PEER_STATE=/var/lib/trustweb-peer
Environment=TW_PEER_INVENTORY=/opt/trustweb-peer/demo_inventory.json
Environment=TW_PEER_RELAY=https://app.idea2.site
Environment=TW_PEER_HEALTH_PORT=8961
Environment="TW_PEER_NAME=Jakob"
Environment=TW_PEER_FORWARD=1
# Every answer the owner did not add to goes out at the forward deadline (same moment for decline,
# no match and phone off). 45 s keeps a demo answer close to the 30 s floor while the owner can still tap.
Environment=TW_PEER_FORWARD_WAIT_MS=45000
Environment=TW_PEER_POLICY=open
DynamicUser=yes
StateDirectory=trustweb-peer
StateDirectoryMode=0700
Restart=on-failure
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
MemoryMax=256M

[Install]
WantedBy=multi-user.target
UNIT
    return
  fi
  cat <<UNIT
[Unit]
Description=TrustWeb personal front door (answers only lines its owner allowed in advance; forwards every ask to his phone; see web-of-trust services/trustweb-peer)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$node $OPT/peer.mjs
Environment=TW_PEER_STATE=$STATE
# The inventory is a root-only file handed over as a credential: %d is \$CREDENTIALS_DIRECTORY.
LoadCredential=inventory:$INV_PATH
Environment=TW_PEER_INVENTORY=%d/inventory
Environment=TW_PEER_RELAY=$RELAY
Environment=TW_PEER_HEALTH_PORT=$PORT
Environment="TW_PEER_NAME=$PEER_NAME"
Environment=TW_PEER_FORWARD=1
Environment=TW_PEER_POLICY=$POLICY
DynamicUser=yes
StateDirectory=${STATE#/var/lib/}
StateDirectoryMode=0700
Restart=on-failure
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
MemoryMax=256M

[Install]
WantedBy=multi-user.target
UNIT
}

# ---------------------------------------------------------------- cards
publish_card() {
  if [ "$PUBLIC_CARD" != 1 ]; then
    echo "$INSTANCE: no public card by design (its connect link goes only to its owner and the people granted; trustweb_peer_grant.sh --link)"
    return 0
  fi
  local d
  if [ "$DRY" = 1 ]; then
    for d in $CARD_DIRS; do
      say "copy $STATE/demo-peer.json to $d/demo-peer.json (a+r, SELinux context of $REF) if $d exists"
    done
    echo "[dry-run] card source today: $(rsh "sudo test -f $STATE/demo-peer.json && echo present || echo missing")"
    echo "[dry-run] app folders today: $(rsh "for d in $CARD_DIRS; do [ -d \$d ] && printf '%s ' \$d; done; echo")"
    return 0
  fi
  # The unit runs as a DynamicUser: its state dir is root-readable only. The first folder (app.idea2.site) must exist and get the
  # card (deploy_wot.sh relies on the failure); any further app folder gets it when it exists.
  rsh "set -eo pipefail
       for i in 1 2 3 4 5 6 7 8 9 10; do curl -fsS -H '$HOSTHDR' http://127.0.0.1:$PORT/health >/dev/null 2>&1 && break; sleep 1; done
       first=1
       for d in $CARD_DIRS; do
         if [ \$first = 0 ] && [ ! -d \$d ]; then echo \"  \$d absent: no card there\"; continue; fi
         first=0
         sudo cat $STATE/demo-peer.json | sudo tee \$d/demo-peer.json >/dev/null
         sudo chmod a+r \$d/demo-peer.json && sudo chcon --reference=$REF \$d/demo-peer.json
         echo \"  card -> \$d/demo-peer.json\"
       done"
}

republish_cards() {
  local units u inst n=0
  units="$(rsh "systemctl list-units --type=service --state=active --no-legend --plain 'trustweb-peer*' | awk '{print \$1}'")"
  if [ -z "$units" ]; then echo "no active front door on $RHOST: no card to republish"; return 0; fi
  for u in $units; do
    inst="$(tw_peer_instance_of_unit "$u")" || continue
    if ! (tw_peer_instance "$inst") 2>/dev/null; then echo "skipping $u: unknown instance '$inst'"; continue; fi
    echo "active: $u -> --card-only --instance $inst"
    local args=(--card-only --instance "$inst" --host "$RHOST") out
    [ "$DRY" = 1 ] && args+=(--dry-run)
    # Capture first, filter after: a failed card publish must fail this run (deploy_wot.sh relies on it).
    if ! out="$("$HERE/deploy_trustweb_peer.sh" "${args[@]}" 2>&1)"; then
      printf '%s\n' "$out" >&2
      echo "card republish FAILED for $u ($inst). The app itself is deployed; once the cause is fixed, rerun: $HERE/deploy_trustweb_peer.sh --republish-cards" >&2
      return 1
    fi
    printf '%s\n' "$out" | grep -v -e '^\.\.\. deploy_trustweb_peer running' -e '^--------$' || true
    n=$((n + 1))
  done
  echo "republish: $n instance(s) handled"
}

# ---------------------------------------------------------------- modes
if [ "$MODE" = republish ]; then
  republish_cards
  echo "--------"; echo "done"; exit 0
fi

if [ "$MODE" = off ]; then
  say "stop and disable $UNIT on $RHOST (state in $STATE is kept: same DID and owner on re-enable)"
  if [ "$DRY" = 0 ]; then
    if [ "$PUBLIC_CARD" = 1 ]; then rsh "for d in $CARD_DIRS; do sudo rm -f \$d/demo-peer.json; done"; fi
    rsh "sudo systemctl disable --now $UNIT"
    if [ "$PUBLIC_CARD" = 1 ]; then
      echo "card gone:  $(curl -s -o /dev/null -w '%{http_code}' https://app.idea2.site/trustweb/demo-peer.json) (expect 404 or the app's fallback page, no JSON)"
    fi
  fi
  echo "--------"; echo "$UNIT off"; exit 0
fi

if [ "$MODE" = card ]; then
  echo "republish the card only ($INSTANCE on $RHOST)"
  publish_card
  echo "--------"; echo "done"; exit 0
fi

# full deploy
BUNDLE="$PEER_DIR/dist/peer.mjs"
[ -f "$BUNDLE" ] || { echo "missing $BUNDLE (run: sh services/trustweb-peer/build.sh)" >&2; exit 1; }
if [ "$INSTANCE" = demo ]; then
  INV="$PEER_DIR/demo_inventory.json"
  [ -f "$INV" ] || { echo "missing $INV" >&2; exit 1; }
fi

echo "1/6 preflight on $RHOST (read-only): node >= 22 at a system path, port $PORT, current state"
NODE="$(rsh 'command -v node')"
case "$NODE" in
  /usr/bin/node|/usr/local/bin/node) ;;
  *) echo "node at '$NODE': the unit needs a system path (ProtectHome hides /root and /home)" >&2; exit 1 ;;
esac
rsh 'node -e "if (parseInt(process.versions.node) < 22 || typeof WebSocket !== \"function\") { console.error(\"node too old\"); process.exit(1) } console.log(\"node \" + process.version)"'
PORT_STATE="$(rsh "ss -ltnH 'sport = :$PORT' | grep -q . && echo in use || echo free")"
UNIT_STATE="$(rsh "systemctl is-active $UNIT 2>/dev/null || true")"
echo "port $PORT: $PORT_STATE"
echo "unit $UNIT: $UNIT_STATE"
# The port in use by anything but this very unit = another service: never start over it.
if [ "$PORT_STATE" = "in use" ] && [ "$UNIT_STATE" != active ]; then
  echo "port $PORT is taken by another service on $RHOST and $UNIT is not running: stopping here, nothing was changed" >&2; exit 1
fi
if [ "$INSTANCE" = personal ]; then
  echo "inventory $INV_PATH: $(rsh "sudo test -f $INV_PATH && echo present, kept as it is || echo absent, will be created EMPTY")"
fi
if rsh "systemctl is-active --quiet trustweb-peer" 2>/dev/null; then
  echo "demo front door before: $(rsh "curl -fsS -H 'Host: 127.0.0.1:8961' http://127.0.0.1:8961/status")"
fi
if [ "$DRY" = 1 ]; then
  echo "[dry-run] unit /etc/systemd/system/$UNIT.service would be:"
  echo "----8<----"; render_unit "$NODE"; echo "----8<----"
fi

say "2/6 peer.mjs -> $OPT/peer.mjs (0644)$([ "$INSTANCE" = demo ] && echo ', demo_inventory.json -> /opt/trustweb-peer/')"
if [ "$DRY" = 0 ]; then
  "${SSHENV[@]}" scp -q "$BUNDLE" "$RHOST:/tmp/$UNIT.mjs"
  rsh "sudo install -d -m 0755 $OPT && sudo install -m 0644 /tmp/$UNIT.mjs $OPT/peer.mjs && rm -f /tmp/$UNIT.mjs &&
       if command -v restorecon >/dev/null; then sudo restorecon -R $OPT; fi"
  if [ "$INSTANCE" = demo ]; then
    "${SSHENV[@]}" scp -q "$INV" "$RHOST:/tmp/trustweb-peer-inventory.json"
    rsh 'sudo install -m 0644 /tmp/trustweb-peer-inventory.json /opt/trustweb-peer/demo_inventory.json && rm -f /tmp/trustweb-peer-inventory.json &&
         sudo restorecon -R /opt/trustweb-peer'
  fi
fi

if [ "$INSTANCE" = personal ]; then
  say "3/6 $INV_PATH: create EMPTY ({\"items\":[]}, root 0600) only if absent; an existing one is never overwritten here"
  if [ "$DRY" = 0 ]; then
    rsh "$(tw_peer_inventory_init_cmd)"
  fi
else
  say "3/6 (demo: inventory shipped with the bundle)"
fi

say "4/6 systemd unit /etc/systemd/system/$UNIT.service"
if [ "$DRY" = 0 ]; then
  render_unit "$NODE" | rsh "sudo tee /etc/systemd/system/$UNIT.service >/dev/null"
fi

say "5/6 enable, restart, wait for health"
if [ "$DRY" = 0 ]; then
  rsh "sudo systemctl daemon-reload && sudo systemctl enable --now $UNIT && sudo systemctl restart $UNIT &&
       for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do curl -fsS -H '$HOSTHDR' http://127.0.0.1:$PORT/health >/dev/null 2>&1 && break; sleep 1; done;
       sleep 3; systemctl is-active $UNIT; curl -fsS -H '$HOSTHDR' http://127.0.0.1:$PORT/status"
  echo
fi

say "6/6 card"
publish_card

if [ "$DRY" = 1 ]; then
  echo "--------"
  echo "dry run: nothing was changed on $RHOST"
  exit 0
fi

if [ "$PUBLIC_CARD" = 1 ]; then
  echo "verify through the public origin"
  sleep 1
  CARD="$(curl -fsS https://app.idea2.site/trustweb/demo-peer.json)"
  echo "$CARD"
  echo "$CARD" | python3 -c 'import json,sys; c=json.load(sys.stdin); assert c["did"].startswith("did:peer:") and c["id"] and c["name"]; print("card ok:", c["name"])'
fi
echo "status:"
tw_peer_status
echo "journal (last 5 lines; counts and outcomes only):"
rsh "sudo journalctl -u $UNIT -n 5 --no-pager -o cat"
echo "--------"
echo "all good. Owner: scripts/trustweb_peer_claim.sh --instance $INSTANCE --host $RHOST --status"
