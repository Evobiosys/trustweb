# `trustweb` CLI

A small git-like command line for trust zones, tags and what they can see, built on the TrustWeb share sink
(`apps/trustweb/src/share_sink/`). It works on **one local JSON file** and **never uses the network**.

Package: `packages/cli` (name `trustweb`). Decision record: `DECISIONS.md` → D-cli.

## Run it

Needs Node **22.18 or later**. No build step and no runtime dependency: `bin/ts-hooks.mjs` runs the TypeScript sources
with Node's own type transform.

```sh
node packages/cli/bin/trustweb.mjs --help        # from the repo root
pnpm --filter trustweb exec trustweb --help      # through pnpm
```

To have a plain `trustweb` on your PATH: `ln -s "$PWD/packages/cli/bin/trustweb.mjs" ~/.local/bin/trustweb`.

Every command has help: `trustweb <command> --help`, `trustweb help <command>`, or `-h`.

## A first session

```text
$ trustweb init
created trustweb-record.json with 7 built-in zones

$ trustweb zone create allies --level close --name Allies
zone create: allies "Allies" on level close

$ trustweb zone add friend person:fig person:kiwi
zone add: friend + person:fig, person:kiwi (new: person:fig, person:kiwi)

$ trustweb zone add allies person:plum tag:garden
zone add: allies + person:plum, tag:garden (new: person:plum, tag:garden)

$ trustweb person tag kiwi garden
person tag: kiwi + garden

$ trustweb share bike --zone friend
$ trustweb share ladder --zone closest --include tag:garden
$ trustweb share tools --zone friend --exclude person:kiwi

$ trustweb sees person:kiwi
person:kiwi can see 2 items
item:bike
  because person:kiwi in_zone zone:close (via allies)
  because zone:friend may_read item:bike
item:ladder
  because person:kiwi has_tag tag:garden
  because tag:garden may_read item:ladder
```

kiwi does not see `item:tools`: the exclusion beats every grant. kiwi counts as `close` (through the tag `garden`, which
places its holders in `allies`), and close sits inside friend, so kiwi sees what friend sees.

## Concepts

| Term | Meaning |
|---|---|
| **record** | The JSON file the CLI reads and writes (`./trustweb-record.json`; or `--record <path>`; or `$TRUSTWEB_RECORD`). |
| **level** | A rung of the TrustZones ladder: `public < intending < acquaintance < community < friend < close < closest`. `self` is the owner alone; nobody is put in it. |
| **built-in zone** | One per level, created by `init`, id = level. Can be renamed and archived (public cannot be archived). |
| **created zone** | A named group placed on a level (`zone create <id> --level <level>`). Its members sit on that level. It never opens more than its level. |
| **member** | `person:<id>` or `tag:<id>`. A tag member places everyone who holds the tag, nested tags included. |
| **tag** | Something people hold (`person tag`). Tags nest (`tag nest child parent`): holding the child means holding the parent. At most four levels, no cycles (the share sink's rule). |
| **share line** | `share <item> --zone <level> [--include …] [--exclude …]` appends one line; the latest line per item counts; its grants last one year. |
| **relation store** | The share sink's tuples (`person:x in_zone zone:friend`, `tag:t may_read item:i`, …). **Derived** from the record on every call, never stored, so there is one truth and one check. |

### What "sees" means

`trustweb sees <target>` runs the share sink's `canAccess` over every shared item and prints the items allowed, each with
the tuples that open it:

- **`person:<id>`** – exactly that person, as enforcement would decide (zones, tags, individual grants, exclusions).
- **`tag:<id>`** – someone who holds only that tag and sits in no zone (so public items show up too).
- **a zone id** – someone who sits only in that zone. A created zone sees what its level sees, and says so in a note.

Per-person exclusions only show on persons: a zone or tag view cannot know which of its members are excluded.

### Archive, never delete

- `zone archive <builtin>` switches that **ring off** (the share sink's `active` rings): someone only in it counts as the
  next ring out, and what was shared to it reaches the **next ring in** that is on, never further out. Example: archive
  `friend`, and `item:bike` (shared to friend) is now seen from `close` inward; fig, only in friend, sees nothing.
- `zone archive <created>` makes the zone place nobody. Its members stay listed.
- `zone restore <id>` undoes either.
- `zone remove` / `person untag` take a membership away; the person or tag stays in the record.
- `init --force`, `import --force` and `export --out <file> --force` move the old file to `archive/` next to it before
  writing. Nothing is overwritten in place.

### Why `share --zone` takes levels only

Sharing to a created zone would have to mean either "its level" (silently wider than the name suggests) or "a snapshot of
its members" (silently stale). Neither is honest, so the CLI refuses and points at `--include`:

```text
$ trustweb share bike --zone allies
trustweb: allies is a created zone on level close: share to close, or name its people with --include
```

## Commands

Global options (any command, before or after it): `--record <path>`, `--now <ISO date>` (act and answer at that time;
handy for "what will this zone see next year"), `-h/--help`.

| Command | Does |
|---|---|
| `init [--device <id>] [--force]` | Create an empty record with the seven built-in zones. |
| `zone list [--all] [--json]` | List zones (archived ones with `--all`): id, level, kind, how many people they place, name. |
| `zone create <id> --level <level> [--name <name>]` | Create a named zone on a level. |
| `zone rename <id> <name...>` | New display name; id, level and members stay. |
| `zone archive <id>` / `zone restore <id>` | See *Archive, never delete*. |
| `zone add <id> <member>...` | Add `person:<id>` / `tag:<id>`; unknown people and tags are registered. All or nothing. |
| `zone remove <id> <member>...` | Take members out of this zone. |
| `zone show <id> [--json]` | Level, dates, members (tag members with their holders), people placed. |
| `person list [--json]` | People with the zone they count in and their tags. |
| `person add <id> [--name <name>]` | Add a person. |
| `person tag <id> <tag>...` / `person untag <id> <tag>...` | Give or take tags. |
| `tag list [--json]` / `tag create <id> [--label <l>]` / `tag nest <child> <parent>` | Tags. |
| `share <item> --zone <level> [--include <m>]... [--exclude <m>]...` | Append a share line. |
| `sees <zone-id\|tag:<id>\|person:<id>> [--json\|--md]` | What it can see, and why. |
| `export [--format json\|jsonl] [--out <file>] [--force]` | `json`: the record (what `import` reads). `jsonl`: the share sink's relation store (`toJsonl`, stable bytes). |
| `import <file\|-> [--force]` | Validate a record export in full and make it the record (`-` = stdin). Logged. |
| `log [-n <count>]` | The change log: one dated, readable line per change (I6). |
| `help [<command>]`, `--version` | Help and version. |

Ids are lowercase `a-z 0-9 . _ -`, up to 64 characters, starting with a letter or digit.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Done. |
| 1 | Refused (unknown zone, already a member, cycle, file exists, damaged record, …): one line on stderr. |
| 2 | The command line was wrong (unknown command or option, wrong number of arguments, bad id or level). |

## The record file

```json
{
  "format": "trustweb-cli-record",
  "version": 1,
  "device": "device:cli",
  "zones": [{ "id": "allies", "name": "Allies", "level": "close", "builtin": false,
              "members": ["person:plum", "tag:garden"], "createdAt": "…", "archivedAt": "…?" }],
  "people": [{ "id": "kiwi", "name": "…?", "tags": ["garden"], "addedAt": "…" }],
  "tags": [{ "id": "garden", "label": "…?", "parents": [], "createdAt": "…" }],
  "shares": [{ "op": "share", "id": "item:bike", "seq": 1, "scope": { "zone": "friend", "include": [], "exclude": [] },
               "cutoff": 1, "to": "zone:friend", "terms": "read-keep", "ts": "…" }],
  "log": ["2026-11-02T10:00:00.000Z init: empty record, 7 built-in zones"]
}
```

`shares` holds the share sink's own `ShareLine`s (`appendShare`); lines of other kinds (revoke, retract, agree) are kept
as they are but not yet acted on. Every load and import checks the whole file and names the first thing wrong
(`record: zone 3: tag:garden is not in tags`).

## Privacy, honestly

- The record is **plain JSON on your disk**: names, tags and who sees what. It is not encrypted and not synced. Keep it
  where you keep private notes.
- The CLI makes **no network calls**. `run()` gets an `Io` with file, stdin/stdout and clock members only; `pnpm --filter
  trustweb lint` walks the runtime import graph (CLI and share sink) and fails on any network API.
- `sees` shows the owner's own view (I4 asymmetry). It is not something to show to the people named in it.
- Nothing here is zero-knowledge (I7); it is a local decision tool over the same rules the app enforces.

## Develop

```sh
cd packages/cli
pnpm test        # node:test, 100% line/branch/function coverage of src/ enforced
pnpm lint        # SPDX headers, no network API, src/ purity (no console, no own clock)
pnpm typecheck   # tsc over src/ and the share sink it imports
```

Layout: `src/record.ts` (format, validation), `src/ops.ts` (pure changes, one log line each), `src/derive.ts` (record →
relation store, `sees`), `src/commands.ts` (command table + help), `src/cli.ts` (`run`), `src/args.ts`, `src/io.ts`,
`bin/trustweb.mjs` (node:fs wiring), `bin/ts-hooks.mjs`. Tests use made-up ids only (fruit), never personal data.
