# ALPHA.md — one-command LAN alpha

A single command boots six friend personas (agent-daemons) plus the mobile UI,
all reachable from phones on the same WiFi. This is for the hackathon
demo/playtest, not a deployment.

## Quickstart

Prereqs (host machine, the one running `pnpm alpha`):
- Same WiFi network as everyone testing on their phone.
- Node 20+, pnpm (already true if you've built this repo).
- `jq` (`brew1 install jq` if missing).

```
pnpm install   # once
pnpm alpha
```

Wait for `alpha environment ready.` in the terminal. It prints one join URL +
QR per persona (all six — Jakob, Mira, Theo, Nora, Lena, Finn — run the
`housing` app — see `alpha/personas.json`). Each friend:

1. Scans their QR with their phone's camera app (or opens the printed URL
   directly if the QR didn't render — see Troubleshooting).
2. That's it — the mobile UI opens already pointed at their own agent-daemon.

Everyone starts pairwise "friend"-trusted with everyone else (all-to-all,
seeded automatically), so there's no manual pairing needed to try the basics.

Press `Ctrl-C` in the terminal running `pnpm alpha` to stop everything —
all six agent-daemons and the mobile-ui dev server. It verifies (via `lsof`)
that no listener is left behind on the ports it used.

## What to try

- **Housing ask** — as any persona (all six run the `housing` app), post a
  housing request and watch it reach the others.
- **Gathering / offer publish** — from the Host screen, publish a gathering or
  an offer at the `trusted` tier; it should show up for everyone else as a
  received listing (everyone is mutually "friend"-trusted by default).
- **Meet ceremony** — the Meet screen's QR channel is a real camera-based flow
  on two phones; if scanning is awkward mid-demo, switch to the paste-code
  channel instead (same screen, code toggle) — no camera needed.
- **Borrow round trip** — from a received listing, request to borrow; the
  owner will see the request land, can approve/decline, and the loan state
  (requested → approved → lent → returned) updates on both sides.
- **DM** — once a room is open (post-consent or via a listing), send a direct
  message and watch it arrive on the other phone.

## ⚠️ Security — alpha only

- **No authentication by default.** Anyone who can reach a persona's
  `http://<ip>:410N` port can call its REST API directly — there is no
  login, token, or pairing check in front of it unless an operator opts in.
  `AGENT_DAEMON_AUTH_TOKEN` (bearer token) and `AGENT_DAEMON_CORS_ALLOWED_ORIGINS`
  (`localhost` or an explicit origin list, in place of the default wildcard
  CORS) are both opt-in env vars read by `startServer` in
  `packages/agent-daemon/src/api/server.ts` — leaving them unset keeps this
  alpha's `pnpm alpha` demo exactly as unauthenticated as before.
- **LAN-open by design.** `pnpm alpha` binds every agent-daemon and the
  mobile-ui dev server to `0.0.0.0` (all interfaces) so phones can reach them.
  Anyone else on the same WiFi can also reach them.
- **`?public=1` is client-cooperation only.** The guest/unauthenticated
  listings view (`GET /api/listings?public=1`) strips gated fields
  server-side for a *cooperating* client, but nothing stops a direct API call
  from asking for the full view — there is no auth boundary enforcing it.
- **Do not run this on an untrusted network** (a conference WiFi, a public
  hotspot) or leave it running unattended. It is scoped for a closed-room
  hackathon demo on a network you already trust everyone on.

This is on top of, not a replacement for, the protocol-level privacy limits in
[PRIVACY.md](PRIVACY.md) (v0 is honestly labeled **not** zero-knowledge).

## Matrix path — honest status

The transport used here is the peer-to-peer DIDComm-shaped transport
(`TRANSPORT=didcomm`, the default), which talks directly agent-to-agent over
plain LAN HTTP — no homeserver involved. A Matrix-based transport
(`MatrixTransport` in `packages/transport`) exists in the codebase and a local
Synapse homeserver container is defined in `docker-compose.yml` under the
`local` profile (`podman compose --profile local up` — this repo uses podman,
not docker, per `CLAUDE.md`/`DECISIONS.md` D3), but **`TRANSPORT=matrix` is
not wired into `packages/agent-daemon/src/main.ts` in this worktree** — the
transport factory throws a clear error if you set it. A hosted homeserver at
`matrix.myceli.al` is a later-milestone target, not something this alpha
environment uses. Don't set `TRANSPORT=matrix` for `pnpm alpha`; it will not
boot.

## Troubleshooting

- **Phones can't connect / ERR_EMPTY_RESPONSE** — `pnpm alpha` now runs a
  firewall/reachability preflight right before printing join URLs
  (`scripts/alpha_preflight.sh`): it curls the host's own LAN IP and warns
  (⚠️, non-fatal — URLs print regardless) if that path is blocked while
  `127.0.0.1` still works. That signature means the macOS Application
  Firewall (or LuLu) is resetting incoming connections to node on the LAN
  interface even though the server is genuinely up. The preflight prints the
  exact remediation commands (with your real node path substituted) when it
  fires — `sudo socketfilterfw --unblockapp "<node path>"`, turning off
  stealth mode, the GUI path (System Settings → Network → Firewall →
  Options…), or disabling the Firewall for the demo. It also flags LuLu if
  running, since LuLu can reset this same host-side self-test even when
  phones connect fine — if a phone already loads the app despite the
  warning, treat it as a LuLu false positive on the host, not a real block.
  Run `scripts/alpha_preflight.sh <HOST_IP> <PORT>` standalone to re-check
  without restarting the whole stack. Note the block is keyed to the exact
  node binary path including version, so a `brew upgrade node` re-blocks it.
- **macOS asks "Do you want the application node to accept incoming network
  connections?"** — click **Allow**. This is normal the first time each
  agent-daemon binds a listening socket; if you click Deny, that persona's
  daemon becomes unreachable from other phones.
- **A friend's QR/URL doesn't load on their phone** — confirm their phone is
  on the *same* WiFi subnet as the host machine (not a guest network that
  isolates clients, and not cellular data). Corporate/guest WiFi often blocks
  device-to-device traffic even on the "same" network.
- **QR code didn't print** — `pnpm alpha` tries `npx qrcode-terminal <url>`
  with a 5-second budget; if that package isn't cached locally and the
  network is slow/blocked, it silently falls back to printing the plain URL
  only. Use the URL — it works exactly the same as scanning.
- **LuLu (host's outbound firewall)** can block the app's calls to a remote
  Matrix homeserver or other external hosts — it does **not** block the LAN
  alpha environment described here, since all traffic is phone ↔ host over
  the local network, not to the internet.
- **Stale/unreachable join URLs after switching WiFi networks** — each
  persona's identity bakes in the host IP address at the time it was first
  created (`alpha/state/<key>/identity.json`, gitignored). If the host's IP
  changed (new network, new DHCP lease), delete `alpha/state/` and re-run
  `pnpm alpha` to remint fresh identities against the current IP. This does
  **not** happen on a normal re-run on the same network — `pnpm alpha` is
  idempotent (identities and trust edges are reused).
- **Port already in use** — a previous `pnpm alpha` run didn't shut down
  cleanly (crash, `kill -9` from outside). Check
  `lsof -nP -iTCP:4101-4106,5173 -sTCP:LISTEN` and kill any leftover
  processes, then re-run.
- **Override the detected host IP** — if auto-detection (`ipconfig getifaddr
  en0`/`en1`) picks the wrong interface, run `HOST_IP=<your.lan.ip> pnpm
  alpha` instead.
