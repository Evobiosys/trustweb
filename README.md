# TrustWeb

Find what you are looking for through people you trust. Ask the people you have actually met, and the people
they trust. What you know stays on your phone; a question travels, the data stays.

- The app: https://app.trustweb.one/
- The foundation (in spe): https://trustintheweb.org/ · hosting: https://trustintheweb.com/

TrustWeb is a local-first web app: every person's data lives in their own browser. The server side only
relays questions between phones and offers optional services (encrypted backups, hosted recordings,
transcription, feedback).

## Repository

| Path | What it is |
|---|---|
| `apps/trustweb` | The app (vanilla TypeScript, Vite). Built with `apps/demo`'s toolchain. |
| `apps/demo` | Shared modules the app imports (relay client, matcher, gates) and the earlier demos |
| `packages/*` | Protocol, transport, relay crypto, network access, inventory store, policies |
| `services/` | Server parts: `trustweb-backup` (backups, hosting, feedback, names, links) and `trustweb-peer` (front doors) |
| `docs/`, `DECISIONS.md` | Design notes and the decision log |

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
```

## How a change ships

1. Work on a short-lived branch `task/<name>` (cloud sessions: `claude/<name>`), never directly on `main`.
2. Look at it first: locally (`scripts/tw_dev.sh`), or for a pushed branch on its quick preview
   (`pre` / `pre2` / `pre3` .trustweb.one, about a minute after the push).
3. CI (`.github/workflows/ci.yml`) builds the bundle and runs the checks. Once they pass, the same bundle
   appears on the verified preview (`dev` / `dev2` / `dev3` .trustweb.one).
4. A human approves the exact candidate there (passkey). `main` moves forward to it and that same bundle goes
   live, with a rollback point.

Previews are password-protected and use demo data only. Every build carries `release.json` with its commit,
so https://app.trustweb.one/release.json shows what is live.

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

## Licensing beyond AGPL

Jakob is willing to publish TrustWeb under AMPL (see https://evobiosys.org/evobiosys/AMPL) for projects that reach out: connect@japossert.com. The existing route in [`NOTICE`](NOTICE) stays.
