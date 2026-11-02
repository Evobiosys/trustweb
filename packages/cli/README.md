# trustweb (command line)

A small, git-like command line for a TrustWeb record: trust zones, persons, tags and shares, plus export and import.
It edits one local JSON file (`.trustweb/record.json`); who may see what is decided by the app's own check
(`canAccess` in `apps/trustweb/src/share_sink`), which the CLI reuses as source. No network, no server, no account.

## Run it from a fresh clone

Nothing to install: Node >= 22.13 runs the TypeScript directly (its own type stripping, `scripts/register.mjs`).

```
node packages/cli/bin/trustweb.mjs --help
node packages/cli/bin/trustweb.mjs init --device laptop
node packages/cli/bin/trustweb.mjs export --format markdown
```

Optional: `alias trustweb="node $PWD/packages/cli/bin/trustweb.mjs"`.

## Test it

```
pnpm --filter trustweb test
```

or, without pnpm, from `packages/cli/`:

```
node --import ./scripts/register.mjs --test "test/**/*.test.ts"
tsc --noEmit -p tsconfig.json
node scripts/lint.mjs
```

## More

The reference (concepts, every command, the record format, how it reuses the app): [`docs/cli.md`](../../docs/cli.md).

## Licence

AGPL-3.0-or-later, like the rest of this repository (see [`LICENSE`](../../LICENSE) and [`NOTICE`](../../NOTICE)).
For terms outside the AGPL, write to connect@japossert.com.
