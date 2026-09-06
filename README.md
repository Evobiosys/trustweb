# Ecstatic World — Web of Trust (combined branch)

A web-of-trust for real, in-person community: people meet face to face, confirm each other, and a
trust graph gates what each person can see and share — events, offers, housing, people. This branch
unites the two halves of the project:

- **Design surface (design collaborator):** a clickable mobile mockup + the authoritative UX/data contracts and
  architecture decisions (`mockup/`, `docs/00`–`70`). It shows the intended experience and specifies
  the contracts behind it.
- **Implementation (Jakob):** a working TypeScript monorepo — a local-first **agent-daemon** backend,
  an **OpenVTC/DIDComm** peer-to-peer transport with a store-and-forward mediator, **self-sovereign
  browser identity** (generate your keys in the browser, connect by scanning an origin's QR), app
  **skins** (ecstatic / housing / family / business), and the designer's React app wired to the real
  backend.

the designer's React app is imported at `apps/web` (+ `packages/ew-contract`); the sprint's vanilla client is
`apps/mobile-ui`; the backend lives in `packages/{protocol,transport,agent-daemon,app-profiles}` and
`packages/browser-agent`.

## Live demos

- App mockup (phone UI, clickable): https://idea2.site/web-of-trust/ — file copy: [`demos/app-mockup.html`](demos/app-mockup.html)
- Interactive permission-gating prototype: https://evobiosys.org/web-of-trust/draft-prototype/ — file copy: [`demos/gating-prototype.html`](demos/gating-prototype.html)
- Project site: https://evobiosys.org/web-of-trust/ · deep dive: https://evobiosys.org/systems/web-of-trust/
- Query infrastructure incl. the 60-second scripted demo: branch [`rebiosys`](../../tree/rebiosys) — `pnpm --filter @resource-web/network-access demo:query-infra`
- Credential-provider seam (issue/verify/revoke/present): branch [`cred-provider`](../../tree/cred-provider)


---

## Part 1 — Design surface (the mockup + docs)

Open `mockup/index.html` in any modern browser — one self-contained HTML file, no build. On a phone
it renders full-screen; on desktop it shows a phone frame with a collaborators panel.

**Golden demo path** — tabs are **Discover · Chat · Meet · Web · You**: browse logged-out → **Join** →
**Quick start** → **Meet** shutter (share composer, *Scan theirs instead*) → meet Maria as **Friend**
(the Moon Ceremony opens; as **Contact** it stays closed — levels gate depth) → request a loan in
**Discover → Offers**, walk the loop in **Chat** (lent → returned → "Do you feel complete?") → see the
rings, labeled asymmetry, and anonymous via-node in **Web** → **＋ Host** a gathering by tier.

**Spec mode:** append `#spec` to the mockup URL (or the toggle beside the phone). Every specified
surface gets an ID badge (e.g. `CER-4`); tap it for its contract + doc section. Registry:
[`docs/60-anchors.md`](docs/60-anchors.md).

| Doc | What it is |
|---|---|
| [00-overview](docs/00-overview.md) | Thesis, trust ladder, tiers, glossary — start here |
| [10-ux-decisions](docs/10-ux-decisions.md) | Workshop decision log |
| [20-data-contract](docs/20-data-contract.md) | UX→backend contract, keyed by anchor IDs |
| [30-architecture-decisions](docs/30-architecture-decisions.md) | Open ADRs |
| [40-infra](docs/40-infra.md) · [50-community-explainer](docs/50-community-explainer.md) · [70-placeholders](docs/70-placeholders.md) | Infra · public explainer · future circles |

See [CONTRIBUTING.md](CONTRIBUTING.md) before changing the mockup/docs.

---

## Part 2 — Implementation (the working backend + apps)

**Run the alpha (one-command LAN demo):** boots six friend personas (each a full agent-daemon) + the
mobile UI, reachable from phones on the same WiFi. Each persona's identity, tiered listings, loans,
DM threads, and the store-and-forward mediator run for real.

```bash
pnpm install && pnpm -r build
pnpm alpha        # prints a join URL + QR per persona (with a firewall preflight); Ctrl-C stops all
```

Full runbook + the self-sovereign QR-connect flow: [ALPHA.md](ALPHA.md). Transport internals:
[docs/TRANSPORT.md](docs/TRANSPORT.md). Daemon HTTP/WS contract: [docs/API.md](docs/API.md).
Decisions log: [DECISIONS.md](DECISIONS.md).

**Self-sovereign onboarding (origin-node):** an origin shows a QR that encodes a connect URL; a new
device's *native camera* opens it, the browser **generates its own keypair** (in IndexedDB — the keys
never leave the device), sends a consent-gated CONNECT over the mediator, and — once the origin owner
approves — becomes its own node connected to them.

### Privacy Honesty Box

> This prototype protects the owner from social exposure by **protocol design** (indistinguishable No,
> consent-gated identity). It does **not** yet protect against: an asker inspecting their own agent's
> raw traffic (privacy rung 1 fixes this), peers reading request texts (rung 2), or metadata analysis
> by the delivery-rung **mediator** (which sees recipient DID + submitter address + timing, never the
> payload — never-decrypt — and no outer `from`). Claiming "zero-knowledge" for v0 would be false.
>
> v0.1 surfaces obey the same posture: **listings** are owner-*published* to tier-eligible edges (a
> `private` listing is never sent; `close` reaches only `close` edges; the guest `?public=1` view
> strips `where_gated` server-side). **Loans** and **DMs** are connected-only; a loan's "not yet" note
> stays local. **Second-brain relays** ping the noted person only at first relay, consent every hop,
> and reveal no more than a direct request (I8). The alpha REST API has **no authentication** — LAN
> exposure is a deliberate closed-room opt-in ([ALPHA.md](ALPHA.md)).
>
> **v1 commitment:** actual zero-knowledge properties (asker learns only the aggregate, provably;
> non-matching peers learn nothing). See [PRIVACY.md](PRIVACY.md).

## Licence

**AGPL-3.0-or-later**, because this project is led by its author. See [`LICENSE`](LICENSE) for the
full text and [`NOTICE`](NOTICE) for what that means when you run it as a network service.

The rule behind that choice, so it does not have to be re-decided each time:

- A project the author leads himself ships **AGPL-3.0-or-later**. He is the one carrying it, so it
  can be fully open, and anyone who needs terms outside copyleft can just ask him.
- A project he does not lead defaults to **AMPL 1.0** instead. That text is kept at
  [`LICENSE-AMPL-1.0`](LICENSE-AMPL-1.0) and no longer governs this repository.

This repository is licensed under **AGPL-3.0-or-later**. An AMPL 1.0 license for this code is
available on request from Jakob directly, at **connect@japossert.com**; it is not granted
automatically. That reach-out is meant to happen in a web of trust manner, through direct
contact, so he knows who is asking and why before terms outside AGPL copyleft are agreed.

Need terms outside AGPL copyleft? Write to **connect@japossert.com**. That route is deliberate: the
point is to know who is building on this outside a copyleft or commons frame, and to have that
conversation directly. See [`NOTICE`](NOTICE).

## Where this lives

Published under the **evobiosys** organisation for now. Not because the project belongs to
EvoBioSys in the long run, and not under a personal account either: it is waiting on a name of its
own. Once that name exists, it gets its own organisation and moves there. Treat the current
location as a placeholder, not as the project identity.
