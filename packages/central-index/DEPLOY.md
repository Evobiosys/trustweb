# Deployment: WoT Central Index

## Status: DESIGNED, not deployable yet

Do not put this on a reachable host. `DELETE /declarations/:id` and `POST /clear` accept a
withdrawal proof and do not verify it, and an `authorCommitment` is a deterministic hash rather
than a secret, so a reachable instance would let anyone who learned one wipe that holder's
declarations. The server refuses to bind anything other than loopback for exactly that reason.
Everything below describes the jurisdiction shape and becomes usable once withdrawal and clear
are signature-verified. Until then this runs on the holder's own machine only.

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

## Configuration

The port can be changed via `WOT_CENTRAL_PORT` (default 4187). Data is stored in the `/data` directory inside the container. When using podman-compose, this is persisted in the `wot-central-data` named volume.

## Open Decisions

Hosting provider, hosting cost, and any additional jurisdictions beyond AT (Austria, default) and EU (European Union) are open decisions for Jakob Possert-Bienzle and are not set here. Do not commit hosting details to this file.
