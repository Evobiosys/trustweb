# Deployment: WoT Central Index

## Status: loopback by default; a reachable bind is now possible, and is an operator decision

Superseded 2026-09-06 (B-20 option A). This section previously said "do not put this on a
reachable host", because withdraw and clear verified nothing and an `authorCommitment` is a
deterministic hash rather than a secret. Both endpoints now verify an Ed25519 signature against
the key registered with each declaration at publish time, so that reason is gone.

The bind still defaults to loopback and refuses anything else unless the jurisdiction (residency)
config for this instance sets `"allowPublicBind": true`. Both shipped configs keep it `false`.
Before flipping it on a real host, an operator still owes:

- TLS terminated in front of this process (the existing Caddy pattern); the server speaks plain
  HTTP and always has.
- The residency, lawful basis, operator contact and retention days in the jurisdiction file being
  true of the actual deployment, since `GET /jurisdiction` and the status page publish them.
- A note that `GET /declarations?authorCommitment=` is not signature-gated: a leaked commitment
  still enumerates that holder's declaration ids and timestamps.

`WOT_CENTRAL_UNSAFE_BIND=1` is a test-only escape hatch and is not a deployment option.

## Build and Run with Podman

Build the container:

```bash
podman build -f Containerfile -t wot-central:latest .
```

Or use podman-compose to build and run:

```bash
podman-compose up -d
```

The server starts on `127.0.0.1:4187` by default.

## Switching Jurisdiction

Set the `WOT_CENTRAL_JURISDICTION` environment variable to switch between instances:

```bash
WOT_CENTRAL_JURISDICTION=eu podman run -e WOT_CENTRAL_JURISDICTION=eu -p 127.0.0.1:4187:4187 wot-central:latest
```

Or in podman-compose.yml, change the environment variable:

```yaml
environment:
  WOT_CENTRAL_JURISDICTION: eu
```

Available jurisdictions: `at` (Austria, default), `eu` (European Union).

Each jurisdiction file also carries `allowPublicBind` (default `false`). Leave it `false` for a
loopback instance. Set it to `true`, and publish the container on a real interface, only for a
deployment an operator intends to be reachable.

## Configuration

The port can be changed via `WOT_CENTRAL_PORT` (default 4187). Data is stored in the `/data` directory inside the container. When using podman-compose, this is persisted in the `wot-central-data` named volume.

## Open Decisions

Hosting provider, hosting cost, and any additional jurisdictions beyond AT (Austria, default) and EU (European Union) are open decisions for Jakob Possert-Bienzle and are not set here. Do not commit hosting details to this file.
