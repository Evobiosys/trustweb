<!-- SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later -->
# Geb bridge

Lets the TrustWeb app (Chat > Extend > Geb) list, read and send through **your own** Geb command-line tool
(`geb.mjs`, Consensual / Day Waterbury, Alignment License v0.3.1; install it yourself, it is not part of this repo).
Node standard library only, no dependency.

## Run

    node scripts/geb-bridge/geb-bridge.mjs --cli /path/to/geb.mjs

(or `GEB_CLI=/path/to/geb.mjs`; `GEB_HOME` is passed through, default `~/.geb`.) It prints one link:

    https://app.trustweb.one/#geb-bridge=<port>.<token>

Open it in the browser where you use TrustWeb. The app keeps port and token in that browser's localStorage only
(never in your synced record) and removes the fragment from the address bar. Every start makes a new token and port.
Options: `--port N` (default random), `--app <origin>` (TrustWeb origin the link points to, e.g. `http://localhost:5173`).

## What it does and does not do

- Binds `127.0.0.1` only; refuses to run on anything else.
- Every request needs the exact `Host` (`127.0.0.1:<port>` or `localhost:<port>`), an `Authorization: Bearer <token>`
  header, and, if the browser sent an `Origin`, one of `https://app.trustweb.one`, `https://dev.trustweb.one`,
  `https://pre.trustweb.one`, `http://localhost:<port>`. CORS preflight is answered only for those origins.
- Runs `node <geb.mjs> ...` with an argument array (no shell). It never runs `geb listen` (one listener per
  identity: start your own) and never `--mark-read`.
- The fragment of the pairing link never reaches a server. TrustWeb's servers never see Geb messages.
- Not verified: the exact JSON that `geb id|connections|inbox --json` prints. Parsing is defensive; unknown shapes
  show as empty lists rather than errors.

## Endpoints

| | |
| --- | --- |
| `GET /status` | `{ok, did}` from `geb id --json`; `{ok:false, error}` when the CLI fails |
| `GET /threads` | `{threads:[{did,title,lastAt,unread,lastText}]}` from `geb connections --json` + `geb inbox --json` |
| `GET /history?with=<did or petname>` | `{lines:[{from,text,at}]}` from `geb history <x>` (JSON lines, else plain text lines) |
| `POST /send` `{to,text}` | `geb send <to> <text>`; `{ok:true}` |

## Test

    node --test scripts/geb-bridge/geb-bridge.test.mjs
