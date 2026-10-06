trustweb-peer: an always-on TrustWeb front door that never decides an answer by itself (reshaped 2026-10-06)

THE RULE IT SERVES
Jakob, 2026-10-06 10:00: "not the server answers asks, I do." A server only carries out what he decided:
  (1) his live yes/no per ask: the peer FORWARDS every ask to his phone and relays back what the phone shared;
  (2) a permission he set in advance: an inventory line with a `preset` block may be shared without a live tap,
      and the asker sees it marked "Allowed in advance by Jakob (date): note".
A line without a preset is never shared by this service, whatever its audience says. The app's sentence "only a
person can say yes" stays true: the person said yes live or in advance and visibly. When the phone is off, (1)
yields nothing, honestly; (2) still answers. The earlier build (c9d4e47) answered by audience alone; that was
wrong and is gone.

WHAT IT IS
A phone without a person at it, minus the deciding. It mints a did:peer:2 identity, drains the relay, accepts the
one-scan connect-ack, matches an ask against its PRESET lines with the same matcher and audience rule a phone
uses, forwards the ask to the owner's phone as a 'query' with relayed: true (the wire that already exists), and
sends the same sealed fixed-length answer after the same 30 s window. Reuses apps/demo and apps/trustweb modules,
copies nothing. Everything is documented at the top of peer.ts; the inventory design is in
INVENTORY_ARCHITECTURE.txt next to this file.

OWNER BINDING (the claim ceremony)
Start the peer with TW_PEER_CLAIM=1 (or touch <state>/claim-open), then open its connect link on the owner's
phone within TW_PEER_CLAIM_MINUTES (default 10). The first phone to do so becomes the owner; the window closes;
later phones are askers. The owner's DID is kept in state.json (0600) and never logged. The owner's phone sees
the peer as an ordinary peer (acquaintance by default; change the ring on its card). Re-claim = delete the
`owner` block from state.json (or the whole state dir) and claim again.

WHAT THE OWNER'S PHONE SEES
A forwarded ask arrives as "<peer name> asks: <asker name>: <text>" (fromName is the peer, the asker's chosen
name leads the text; the app shows relayed asks like any ask today). The phone matches its OWN inventory for the
peer's ring, prompts the owner, and answers the peer; the peer relays the shared items to the asker (owner items
first, then preset hits, at most three). Decline, no match, phone off: the same bytes to the asker.

STATUS 2026-10-06: built and tested locally (vitest: 14 tests incl. the whole owner flow against an in-memory
relay with two fake phones). NOT DEPLOYED. The app only offers the peer in a demo-account link when
<app>/demo-peer.json exists; the live site has no such file.

RUN (local)
  cd <repo>
  TW_PEER_STATE=/tmp/twpeer TW_PEER_INVENTORY=services/trustweb-peer/demo_inventory.json \
  TW_PEER_RELAY=http://127.0.0.1:<relay port> TW_PEER_HEALTH_PORT=8961 TW_PEER_CLAIM=1 node_modules/.bin/tsx services/trustweb-peer/peer.ts
  curl -s http://127.0.0.1:8961/health    # ok
  curl -s http://127.0.0.1:8961/status    # {"relay":"connected","peers":0,"owner":false,"forward":false,"claimOpen":true,"presetLines":5,"heldLines":2}
  cat /tmp/twpeer/demo-peer.json          # the card the app reads
Env: TW_PEER_STATE (dir: state.json with identity, peers and owner; demo-peer.json; grants.json; claim-open),
TW_PEER_INVENTORY (json: {"items":[{"text","audience": "fof"|"friends"|"me","preset"?: {"by","at","note"?}}]}),
TW_PEER_RELAY (origin), TW_PEER_NAME (default "Demo inventory"), TW_PEER_POLICY (open|granted),
TW_PEER_HEALTH_PORT (0 = none; loopback only, Host checked, any Origin refused), TW_PEER_ASKS_PER_HOUR (default 30
per asker), TW_PEER_FORWARD (1|0, default 1), TW_PEER_FORWARD_WAIT_MS (default 120000; the asker's app waits
180 s), TW_PEER_CLAIM (1 opens a claim window at start), TW_PEER_CLAIM_MINUTES (default 10). SIGHUP reloads the
inventory and the grants.

TEST
  cd services/trustweb-peer && ../../apps/demo/node_modules/.bin/vitest run --config test/vitest.config.mjs --root .
  ../../apps/demo/node_modules/.bin/tsc --noEmit -p tsconfig.json
  (The app's e2e test demo_account.mjs step 6 ran against the OLD auto-answering peer; it needs an owner phone
  or preset lines now. Not changed by this pass: apps/trustweb is another agent's.)

BUILD (one dependency-free file for a server with only Node >= 22)
  sh services/trustweb-peer/build.sh     -> services/trustweb-peer/dist/peer.mjs (about 140 KB)

DEPLOYMENT DESIGN (demo instance, Swiss server = questhub, Infomaniak CH; NOT executed, ask first)
  Same shape as services/trustweb-backup (README.txt there):
  1. scp dist/peer.mjs and demo_inventory.json to /opt/trustweb-peer/.
  2. /etc/systemd/system/trustweb-peer.service: ExecStart=/usr/bin/node /opt/trustweb-peer/peer.mjs,
     Environment=TW_PEER_STATE=/var/lib/trustweb-peer TW_PEER_INVENTORY=/opt/trustweb-peer/demo_inventory.json
     TW_PEER_RELAY=https://app.idea2.site TW_PEER_HEALTH_PORT=8961 TW_PEER_NAME="Demo inventory",
     DynamicUser=yes, StateDirectory=trustweb-peer, Restart=on-failure, the same hardening lines as the
     backup unit. Node on questhub must be >= 22 (global WebSocket); check `node --version` first, else
     the bundle needs `ws` injected (relay.ts accepts a wsCtor).
  3. Claim: start once with TW_PEER_CLAIM=1, Jakob opens the connect link (health /card gives the DID; the link
     is the app's connect URL with that DID) on his phone within 10 minutes; /status shows owner:true.
  4. Publish the card: copy /var/lib/trustweb-peer/demo-peer.json to
     /srv/questhub-static/app-idea2-trustweb/demo-peer.json (same SELinux chcon as the deploy script does).
     From then on every demo-account code made in the app names the demo front door as a second peer.
     Removing that file switches the feature off again without touching the app.
  5. The relay: the peer drains wss://app.idea2.site/relay/drain and POSTs to /relay/send like a phone;
     server-to-server there is no CORS. The relay sees one more DID, nothing else.
  Rollback: systemctl stop trustweb-peer; rm the card file.

PERSONAL INSTANCE (German server = sebra, Contabo DE): DESIGN ONLY, see INVENTORY_ARCHITECTURE.txt
  Same bundle with TW_PEER_POLICY=granted and TW_PEER_NAME="Jakob (front door)". grants.json lists the demo
  account names the owner allowed ("anna-demo"); any other connect-ack is refused. Its inventory file holds ONLY
  lines Jakob exported with a preset; everything else stays on his phone and answers through the forward.

PRIVACY
  Logs carry counts and outcomes only ("ask preset=1 owner=shared(1) -> shared (2)"), never an ask's text, never
  a DID. State files are 0600. The health server binds 127.0.0.1, checks the Host header and refuses any request
  with an Origin header (local-service rule). Per-asker rate limit 30 asks/hour (an over-limit ask gets a "no
  match" after the usual window). Peer list capped at 500 (oldest forgotten). The owner asking his own front
  door gets preset lines only and is never forwarded to himself.
