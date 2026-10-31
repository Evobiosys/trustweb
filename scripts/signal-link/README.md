<!-- SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later -->
# TrustWeb Signal link companion

A small laptop process (Node, stdlib only) behind the TrustWeb extension "Signal / Molly". It links this computer to your
existing Signal or Molly account as an additional device, collects counts and a local word list per conversation, and serves them
to the TrustWeb app in your browser over `127.0.0.1`. Nothing is sent to the TrustWeb project or its servers.

## Run

    node scripts/signal-link/signal-link.mjs [--signal-cli /path/to/signal-cli] [--account +<your number>] [--port N]
    node --test scripts/signal-link/

It prints `https://app.trustweb.one/#signal-link=<port>.<token>`. Open that on this computer once: the app stores port and token in
this browser's localStorage and removes them from the address bar. A new token is made at every start.

## Choice: signal-cli, as a separate process

| Option | Licence | Verdict |
|---|---|---|
| signal-cli (Java) | GPL-3.0 | Chosen. Supports linking as a secondary device, receive, contacts, a JSON-RPC mode. |
| presage (Rust library) | AGPL-3.0 | A library: using it means building and shipping our own Rust binary and tracking Signal protocol changes. Later option. |
| other libsignal-based clients | various | Same maintenance cost; none evaluated further. |

signal-cli is installed by the user, started as a child process, and talked to over pipes. It is never embedded, vendored or
copied here, so its GPL does not touch this code. Install it from its own project (not verified here: the sandbox has no network and signal-cli is not installed).

## Signal's limits (say it plainly)

A linked device only receives messages from the moment it is linked, plus what the primary device syncs (contacts, groups). Old
history is not imported unless the phone transfers it, so counts start thin and grow with use. The zone proposals are therefore
rough at first.

## What is verified and what is a guess

Verified: everything in this folder that does not touch signal-cli (token, Host/Origin/Bearer gate, aggregation, stopwords,
file mode, the HTTP endpoints) is unit tested with made-up fixtures (`node --test`).

Not verified against a real signal-cli (it was not available): all of these are recalled from its documentation and are GUESSES.
- `signal-cli link -n "TrustWeb"` prints an `sgnl://linkdevice?uuid=...&pub_key=...` URI and waits until the phone scans it.
- `signal-cli -a +E164 jsonRpc` runs a JSON-RPC server on stdin/stdout, emitting `receive` notifications with
  `params.envelope.{sourceNumber,timestamp,dataMessage.message,syncMessage.sentMessage.{destinationNumber,message}}`.
- The JSON-RPC method `listContacts` and its result fields `number`, `name`, `profileName`.
- That outgoing messages from the phone appear as `syncMessage.sentMessage` on the linked device.
- Whether a linked device needs an explicit contact sync request after linking (signal-cli has a `sendSyncRequest` command, as far as recalled; the companion does not call it).
- The account number is not discovered automatically: after linking, restart with `--account +<your number>`.

## Endpoints (all on 127.0.0.1)

| | |
|---|---|
| `GET /status` | `{v, link: idle\|waiting\|linked\|failed, error?, account, receiving, messages}` |
| `POST /link` | starts `signal-cli link`, returns `{uri: "sgnl://linkdevice?..."}`; the app draws the QR |
| `GET /import` | `{v, generatedAt, note, conversations:[{e164,name,n365,out,in,firstTs,lastTs,words:[[word,count],...]}]}` |

Rules: bound to 127.0.0.1; `Host` must be `127.0.0.1:<port>` or `localhost:<port>`; `Authorization: Bearer <token>`; an `Origin` must be
`https://app.trustweb.one`, `https://dev.trustweb.one`, `https://pre.trustweb.one` or `http://localhost:<port>`; CORS headers only for those.

## What is stored, where

`~/.trustweb-signal-link/messages.jsonl` (directory 0700, file 0600): one line per message with peer number, direction, time, and the
kept words of that message (stopwords, short words and numbers dropped, then sorted alphabetically so the sentence cannot be read
back). Message bodies are not written. Words are still personal data: delete the folder to forget them. signal-cli keeps its own
account data in its own folder, outside this project.

The word histogram is returned only by `/import` to the page on this computer, shown there as "words you use together", and never
written into the TrustWeb record.
