trustweb-peer: an always-on TrustWeb peer that holds an inventory and answers asks (2026-10-06)

WHAT IT IS
A phone without a person at it. It mints a did:peer:2 identity, drains the relay, accepts the one-scan
connect-ack, matches an ask against its inventory with the same matcher and audience rule a phone uses,
and sends the same sealed fixed-length answer after the same 30 s window. Reuses apps/demo and
apps/trustweb modules, copies nothing. Everything is documented at the top of peer.ts.

Owner's intent (Omi walk 2026-10-06): "the demo content should be on the Swiss server, a personal one
should be on the German server" and "people should be able to query my inventory".

WHAT IS DIFFERENT FROM A PHONE (read before deploying)
Nobody taps "Share". A line is shared when its audience admits the asker's ring (every peer of this
service sits in the acquaintance ring, so only "friends of friends" lines are ever shared). That makes
the service answer by itself. It therefore holds ONLY content its owner has already decided to share
with everyone who connects: fictional demo content (demo_inventory.json) for the demo instance. The
personal instance is designed (PeerPolicy.Granted, grants.json) but NOT deployed and NOT fed: it waits
on the owner's ruling on server-side consent (see the questions file of the omi-walk pass).

STATUS 2026-10-06: built and tested locally (vitest + the app's e2e test demo_account.mjs runs a real
TrustWeb phone against this peer over an in-memory relay). NOT DEPLOYED. The app only offers the peer
in a demo-account link when <app>/demo-peer.json exists; the live site has no such file.

RUN (local)
  cd <repo>
  TW_PEER_STATE=/tmp/twpeer TW_PEER_INVENTORY=services/trustweb-peer/demo_inventory.json \
  TW_PEER_RELAY=http://127.0.0.1:<relay port> TW_PEER_HEALTH_PORT=8961 node_modules/.bin/tsx services/trustweb-peer/peer.ts
  curl -s http://127.0.0.1:8961/health    # ok
  curl -s http://127.0.0.1:8961/status    # {"relay":"connected","peers":0}
  cat /tmp/twpeer/demo-peer.json          # the card the app reads
Env: TW_PEER_STATE (dir: state.json with identity + peers, demo-peer.json, grants.json), TW_PEER_INVENTORY
(json: {"items":[{"text","audience": "fof"|"friends"|"me"}]}), TW_PEER_RELAY (origin), TW_PEER_NAME
(default "Demo inventory"), TW_PEER_POLICY (open|granted), TW_PEER_HEALTH_PORT (0 = none; loopback only,
Host checked, any Origin refused), TW_PEER_ASKS_PER_HOUR (default 30 per asker). SIGHUP reloads the
inventory and the grants.

TEST
  cd services/trustweb-peer && ../../apps/demo/node_modules/.bin/vitest run --config test/vitest.config.mjs --root .
  cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/demo_account.mjs   (step 6)

BUILD (one dependency-free file for a server with only Node >= 22)
  sh services/trustweb-peer/build.sh     -> services/trustweb-peer/dist/peer.mjs (about 130 KB)

DEPLOYMENT DESIGN (demo instance, Swiss server = questhub, Infomaniak CH; NOT executed, ask first)
  Same shape as services/trustweb-backup (README.txt there):
  1. scp dist/peer.mjs and demo_inventory.json to /opt/trustweb-peer/.
  2. /etc/systemd/system/trustweb-peer.service: ExecStart=/usr/bin/node /opt/trustweb-peer/peer.mjs,
     Environment=TW_PEER_STATE=/var/lib/trustweb-peer TW_PEER_INVENTORY=/opt/trustweb-peer/demo_inventory.json
     TW_PEER_RELAY=https://app.idea2.site TW_PEER_HEALTH_PORT=8961 TW_PEER_NAME="Demo inventory",
     DynamicUser=yes, StateDirectory=trustweb-peer, Restart=on-failure, the same hardening lines as the
     backup unit. Node on questhub must be >= 22 (global WebSocket); check `node --version` first, else
     the bundle needs `ws` injected (relay.ts accepts a wsCtor).
  3. Publish the card: copy /var/lib/trustweb-peer/demo-peer.json to
     /srv/questhub-static/app-idea2-trustweb/demo-peer.json (same SELinux chcon as the deploy script does).
     From then on every demo-account code made in the app names the demo inventory as a second peer.
     Removing that file switches the feature off again without touching the app; existing test accounts
     keep their connection to the peer until the service forgets them.
  4. The relay: the peer drains wss://app.idea2.site/relay/drain and POSTs to /relay/send like a phone;
     server-to-server there is no CORS. The relay sees one more DID, nothing else.
  5. Caddy: nothing to add (the card is a static file; the health port stays loopback).
  Rollback: systemctl stop trustweb-peer; rm the card file.

PERSONAL INSTANCE (German server = sebra, Contabo DE): DESIGN ONLY
  Same bundle with TW_PEER_POLICY=granted and TW_PEER_NAME="<owner's name>". grants.json lists the test
  account names the owner allowed ("anna-test"); any other connect-ack is refused. Fed from a Tana export
  (the "Personal TrustWeb Inventory" node) plus a local folder, written as the same {items:[...]} file by
  a separate exporter (not written yet; it needs the Tana node and the owner's rules on what the export
  may contain). Open questions before this exists: consent model for a server with nobody to tap Share,
  which lines may ever be auto-shared, sebra's "no Tana writes" standing rule, export cadence. The
  owner's phone does not yet send grants over the wire; grants.json is edited on the server.

PRIVACY
  Logs carry counts and outcomes only ("ask shared (2)"), never an ask's text, never a DID. State files
  are 0600. The health server binds 127.0.0.1, checks the Host header and refuses any request with an
  Origin header (local-service rule). Per-asker rate limit 30 asks/hour (an over-limit ask gets a "no
  match" after the usual window). Peer list capped at 500 (oldest forgotten).
