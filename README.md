# TrustWeb

Find what you are looking for through people you trust. Ask the people you have actually met, and the
people they trust. What you know stays on your phone; a question travels, the data stays.

- **The app:** https://app.trustweb.one/ (works in any modern browser, installable as a PWA)
- **Your address:** `trustweb.one/<your-name>` reaches you, for example https://trustweb.one/japossert
- **The project:** https://trustintheweb.org/ (what TrustWeb is, why, and how it is governed)
- **Hosting for organisations:** https://trustintheweb.com/ (paid hosting and support)

## Products and entities

- **trustintheweb.org** is the steward of both products, conceptually under EvoBioSys. We intend to turn it into a foundation.
- **trustintheweb.com** is a commercial public-benefit company and the hosting provider for both products (at least querying). Users meet it only as the hosting company named in About.
- **trustweb.one** is the querying app. It uses the Web Curator under the hood.
- **Web Curator** (`apps/crm`, was TrustWeb CRM) is its own open-source product, stewarded by trustintheweb.org like the rest.

## What it is

TrustWeb is a local-first web app. Every person's record (the people they know, the notes they keep, what
they offer and look for) lives in their own browser. A question is sent to the people you choose; each of
them answers on their own phone; a "no" and a "no match" look exactly the same on the wire. Nothing is
indexed centrally and nothing is sold.

The server side is deliberately thin:

- a **relay** that carries encrypted messages between phones (it cannot read them),
- optional **services** with a free allowance: encrypted backups, hosted recordings, transcription,
  short links and usernames, website feedback,
- the **organizer service** for events: an organizer keeps their own event and invitee list on the server
  and sees three counters (opened, joined, tagged). Attendees stay anonymous to it.

### Events

An organizer sends one link to everyone. Each attendee who opens it gets the event in their own web, tags
the people they met, and keeps those people as a resource afterwards. The organizer sees how many opened,
joined and tagged, never who. Organizers manage this at https://app.trustweb.one/organizer.html.

### Your address

`trustweb.one/<name>` answers with your connect link. Someone who opens it creates their own web in one
step and appears on your "intending to connect" ring as *reached out*; you decide what happens next.
Claim your name in the app (Settings). If the website ever has a page with that name, the explicit form
`app.trustweb.one/<name>` always works.

## Two homes: TrustInTheWeb.org and TrustInTheWeb.com

- **TrustInTheWeb.org** is the project's home and its steward in spe: the public explanation, the
  principles (local sovereignty, asker blindness, an indistinguishable no, contextual consent), the
  roadmap and the place where governance will live once the project has a legal body. The app at
  https://app.trustintheweb.org/ is the same build as app.trustweb.one.
- **TrustInTheWeb.com** is the professional side: hosting and support for organisations that want
  TrustWeb run for them (an organizer plan with higher limits, a dedicated relay, backups with an SLA,
  a named contact). Pricing lives there and nowhere else. The code stays the same; what you pay for is
  capacity, operations and a person who answers.
- **trustweb.one** is the short address people share: the app and `trustweb.one/<name>`.

## Repository

| Path | What it is |
|---|---|
| `apps/trustweb` | The app (vanilla TypeScript, Vite). Built with `apps/demo`'s toolchain. `organizer.html` is the organizer page. |
| `apps/crm` | The Web Curator (Svelte 5): sorting people into rings, Tana import and sync. Opened from the app. |
| `apps/demo` | Shared modules the app imports (relay client, matcher, gates) and the earlier demos |
| `packages/*` | Protocol, transport, relay crypto, network access, inventory store, person fields, policies |
| `services/trustweb-backup` | The server: relay-adjacent services (backups, hosting, transcription, links, usernames, organizers) |
| `services/trustweb-peer` | Front doors |
| `scripts/` | Dev server, deploys, Caddy edits (each anchored, validated, with backup and restore) |
| `docs/`, `DECISIONS.md` | Design notes and the decision log; `CLAUDE.md` carries the invariants I1 to I9 |

Older work (the Ecstatic World design surface, the mobile UI, OpenVTC experiments) lives in git history
and in unmerged branches.

## Run it locally

```
pnpm install
scripts/tw_dev.sh            # dev server on 127.0.0.1:5190 with live reload, opens a phone-sized window
```

Checks (the same ones CI runs on every push):

```
cd apps/trustweb && ../demo/node_modules/.bin/tsc --noEmit -p tsconfig.json
cd apps/demo && node_modules/.bin/vitest run --config ../trustweb/test/unit/vitest.config.mjs --root ../trustweb
cd apps/demo && node_modules/.bin/vitest run
cd services/trustweb-backup && node --test test/*.test.mjs
```

The server runs locally with `BACKUP_DIR=/tmp/twbackup PORT=8960 node services/trustweb-backup/server.mjs`;
the API is documented in `services/trustweb-backup/README.txt`.

## How a change ships

1. Work on a short-lived branch, never directly on `main`.
2. Look at it first: locally (`scripts/tw_dev.sh`), or for a pushed branch on its quick preview
   (`pre` / `pre2` / `pre3` .trustweb.one, about a minute after the push).
3. CI (`.github/workflows/ci.yml`) builds the bundle and runs the checks. Once they pass, the same bundle
   appears on the verified preview (`dev` / `dev2` / `dev3` .trustweb.one).
4. A human approves the exact candidate there (passkey or Touch ID). `main` moves forward to it and that
   same bundle goes live, tagged with its preview id, with a rollback point.

Previews are password-protected and use demo data only. Every build carries `release.json` with its
commit, so https://app.trustweb.one/release.json shows what is live.

## Privacy, in one paragraph

Your record never leaves your device unless you back it up (encrypted on your phone before upload) or
answer a question (only the answer travels, to the asker, after your consent). The relay sees ciphertext
and timing. The services keep what you hand them for their job and nothing more; the organizer service
keeps the organizer's own data and three counters. `PRIVACY.md` has the long version and the honest list
of what v0 does not yet guarantee.

## Licence

**AGPL-3.0-or-later**, because this project is led by its author. See [`LICENSE`](LICENSE) for the
full text and [`NOTICE`](NOTICE) for what that means when you run it as a network service.

The rule behind that choice, so it does not have to be re-decided each time:

- A project the author leads himself ships **AGPL-3.0-or-later**. He is the one carrying it, so it
  can be fully open, and anyone who needs terms outside copyleft can just ask him.
- A project he does not lead defaults to **AMPL 1.0** instead. That text is kept at
  [`LICENSE-AMPL-1.0`](LICENSE-AMPL-1.0) and no longer governs this repository.

Need terms outside AGPL copyleft, such as [AMPL 1.0](https://evobiosys.org/evobiosys/AMPL)? Write to
Jakob at **connect@japossert.com**. Nothing is granted automatically: the ask goes through direct
contact, web of trust style, so he knows who builds on this outside a copyleft or commons frame and
why, before other terms are agreed. See [`NOTICE`](NOTICE).

## Where this lives

Published under the **evobiosys** organisation for now. Not because the project belongs to
EvoBioSys in the long run, and not under a personal account either: it is waiting on a name of its
own. Once that name exists, it gets its own organisation and moves there. Treat the current
location as a placeholder, not as the project identity.
