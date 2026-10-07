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
WHICH IDENTITY BECOMES THE OWNER (2026-10-06): the claim link is https://app.idea2.site/trustweb/?connect=...&id=...
&name=... with no ?persona=. apps/trustweb/src/main.ts boots persona 'me' for any URL without ?persona= (a demo
account runs only under ?persona=demo-<id>), so the owner is the NORMAL TrustWeb ("me") of the browser that opened
the link; its connect-ack carries that persona's own name and DID. The claim script says so on screen.

WHAT THE OWNER'S PHONE SEES
A forwarded ask arrives as "<peer name> asks: <asker name>: <text>" (fromName is the peer, the asker's chosen
name leads the text; the app shows relayed asks like any ask today). The phone matches its OWN inventory for the
peer's ring, prompts the owner, and answers the peer; the peer relays the shared items to the asker (owner items
first, then preset hits, at most three). Decline, no match, phone off, over the rate limit: the same bytes to the
asker AND the same moment (review fix 2026-10-06): while an ask is forwarded, every answer the owner did not add to
is sent at the forward deadline (forwardWaitMs, 120 s, from the ask's arrival); only the owner's live share goes
early, because its content says so anyway. Without forwarding (no owner, forward off, a self-ask) the 30 s window
holds. Before this fix a decline arrived at the owner's tap and phone off at 120 s, so WHEN told them apart.

STATUS 2026-10-06: DEPLOYED on questhub (Swiss server) as trustweb-peer.service, demo instance, fictional inventory
only, forwarding ON, policy open. Built and tested locally (vitest: 14 tests incl. the whole owner flow against an
in-memory relay with two fake phones) and checked live with the app's e2e test (apps/trustweb/test/e2e/
demo_account.mjs, step 7 against https://app.idea2.site/trustweb/). The card is published at
https://app.idea2.site/trustweb/demo-peer.json, so every demo-account code made in the app now names the demo front
door as a second peer. Owner: bound 2026-10-06 (Jakob ran scripts/trustweb_peer_claim.sh; status owner:true, forward:true, 5 preset, 2
held). So asks from anyone trying the demo now also reach his phone as "Demo inventory asks: <name>: <text>" for a
live yes/no; nothing of his goes out without that tap.

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

TEST (2026-10-07, wave 1733: 57 tests in 4 files)
  cd services/trustweb-peer && TW_VITEST_CACHE=$(mktemp -d) ../../apps/demo/node_modules/.bin/vitest run --config test/vitest.config.mjs --root .
  ../../apps/demo/node_modules/.bin/tsc --noEmit -p tsconfig.json      (peer.ts, inventory_export.ts, the exporter CLI)
  test/peer.test.mjs             the peer (14): presets, claim, forward, granted policy, against an in-memory relay
  test/inventory_export.test.mjs the exporter (24): marks, Tana reader, the four outputs, property test "nothing unmarked
                                 leaves" over 400 random inventories, CLI dry run against a fake tana_mcp.sh
  test/personal.test.mjs         "without an app" end to end (6): exporter -> server file -> personal peer -> granted asker
  test/scripts.test.mjs          grant, claim and --republish-cards against a fake host; personal --host never defaulted (13)
  TW_VITEST_CACHE gives a run its own cache dir (node_modules are shared with the primary checkout).
  (The app's e2e test demo_account.mjs step 6 ran against the OLD auto-answering peer; it needs an owner phone
  or preset lines now. Not changed by this pass: apps/trustweb is another agent's.)

BUILD (one dependency-free file for a server with only Node >= 22)
  sh services/trustweb-peer/build.sh     -> services/trustweb-peer/dist/peer.mjs (about 140 KB)

DEPLOYMENT (done 2026-10-06; demo instance, Swiss server = questhub, Infomaniak CH)
  scripts/deploy_trustweb_peer.sh does all of it, idempotent (sh services/trustweb-peer/build.sh first):
  1. scp dist/peer.mjs and demo_inventory.json (both 0644) to /opt/trustweb-peer/ (node on questhub: v22.23.1).
  2. /etc/systemd/system/trustweb-peer.service: ExecStart=/usr/bin/node /opt/trustweb-peer/peer.mjs,
     TW_PEER_STATE=/var/lib/trustweb-peer TW_PEER_INVENTORY=/opt/trustweb-peer/demo_inventory.json
     TW_PEER_RELAY=https://app.idea2.site TW_PEER_HEALTH_PORT=8961 TW_PEER_NAME="Demo inventory" TW_PEER_FORWARD=1
     TW_PEER_POLICY=open, DynamicUser=yes, StateDirectory=trustweb-peer (0700), Restart=on-failure, MemoryMax=256M,
     the same hardening lines as trustweb-backup.service.
  3. Claim (owner binding): scripts/trustweb_peer_claim.sh. The peer reads <state>/claim-open ONLY at start, so the
     script touches the file, restarts the unit, removes the file again (so a later crash-restart or reboot cannot
     reopen the window), checks /status claimOpen:true, and prints the connect link (built with the app's own
     buildConnectLinkUrl from the published card) for Jakob's phone. Window: 10 minutes or the first claim.
     --status, --close (restart without the file), --reset (forget the owner) are in the same script.
     Opening, --close and --reset need --instance and a typed confirmation of the instance's name (or
     --confirm <instance>); deploy_trustweb_peer.sh needs the same for a full deploy and --off (review 2026-10-06).
     Never run the app's e2e test while a window is open: its test phone would become the owner.
  4. The card: /var/lib/trustweb-peer/demo-peer.json (root-readable only, DynamicUser) is copied to
     /srv/questhub-static/app-idea2-trustweb/demo-peer.json, chmod a+r and chcon --reference=wot-app.
     Removing that file switches the feature off in the app without touching the app.
     scripts/deploy_wot.sh clears that whole directory (rm -rf app-idea2-trustweb/*) and so deletes the card on
     every app deploy; since 2026-10-06 (wave 1733) it runs `scripts/deploy_trustweb_peer.sh --republish-cards`,
     which republishes the card of every ACTIVE trustweb-peer* instance (--card-only --instance <name>; the
     personal instance has no public card, so that is a no-op for it).
  5. The relay: the peer drains wss://app.idea2.site/relay/drain and POSTs to /relay/send like a phone;
     server-to-server there is no CORS. The relay sees one more DID, nothing else.
  Health (on questhub): curl -s -H "Host: 127.0.0.1:8961" http://127.0.0.1:8961/status
  Journal: sudo journalctl -u trustweb-peer -n 50 --no-pager (counts and outcomes only).
  Rollback: scripts/deploy_trustweb_peer.sh --instance demo --off  (= systemctl disable --now trustweb-peer; rm the card file).
  State survives a stop: re-enabling keeps the same DID. Forget everything: sudo rm -rf /var/lib/trustweb-peer.

PERSONAL INSTANCE (2026-10-06, wave 1733): BUILT, TESTED, NOT DEPLOYED (host = Jakob's decision)
  Same bundle, its own everything: unit trustweb-peer-personal, state /var/lib/trustweb-peer-personal (0700,
  DynamicUser), bundle /opt/trustweb-peer-personal/peer.mjs, loopback health port 8962, TW_PEER_POLICY=granted,
  TW_PEER_NAME=Jakob, forwarding on. Its inventory is /etc/trustweb-peer-personal/inventory.json (root 0600),
  handed to the service as a systemd credential (LoadCredential, TW_PEER_INVENTORY=%d/inventory); the first
  deploy creates it EMPTY ({"items":[]}) and never overwrites it. Only the exporter's --send fills it.
  No public card: the claim link and the links for granted people are built from GET /card over loopback, so
  Jakob's front-door DID is not on a public URL (a public card would only be needed for the demo-account
  shortcut, which is the demo instance's job).
    scripts/deploy_trustweb_peer.sh --instance personal --host sebra|questhub [--dry-run]   (--off stops it)
    scripts/trustweb_peer_claim.sh --instance personal --host ...     owner = the TrustWeb that opens the link
    scripts/trustweb_peer_grant.sh --instance personal --host ... --add <name> | --remove <name> | --list | --link
    node_modules/.bin/tsx scripts/trustweb_inventory_export.ts [--choices kimi-ticked.json] [--mac-folder dir]
        dry run by default (nothing leaves the Mac); --send --host ... after reading the review file
        --mac-folder reads ONLY regular .txt files (Jakob 2026-10-07: txt only for now); .md, other file types,
        symlinks and subfolders are skipped and named in the review file ("NOT READ in the Mac folder")
  Grants are display names (NFC, trimmed, whitespace collapsed, case-insensitive: grantKey in peer.ts, the same
  in the grant script); a name is not a secret, so the connect link is the other half: hand it only to the people
  granted. Since the review (2026-10-06): one granted name binds ONE phone (a second phone sending it is refused
  while the first holds it), and --remove takes effect at the SIGHUP reload: the person is forgotten and their
  asks get no answer. A grant list that cannot be read stops the grant script (it never rewrites the list).
  Dry runs 2026-10-06 against both hosts (read-only): node v22.23.1 (questhub) / v22.23.3 (sebra) at
  /usr/bin/node, port 8962 free, unit absent, inventory absent; the demo unit renders byte-identical to the live one.

PRIVACY
  Logs carry counts and outcomes only ("ask preset=1 owner=shared(1) -> shared (2)"), never an ask's text, never
  a DID. State files are 0600. The health server binds 127.0.0.1, checks the Host header and refuses any request
  with an Origin header (local-service rule). Per-asker rate limit 30 asks/hour (an over-limit ask gets a "no
  match" after the usual window). Peer list capped at 500 (oldest forgotten). The owner asking his own front
  door gets preset lines only and is never forwarded to himself.
