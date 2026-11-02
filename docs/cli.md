# trustweb: the command line

## What it is

`trustweb` edits a TrustWeb record from a terminal: which trust zones are set up, who sits in them, which tags people
carry, which items are shared to whom, and export/import of the whole thing. The design in one sentence: **the CLI
edits the record; the app's `canAccess` decides who sees what.** It never has its own idea of visibility: every answer
about who can see an item runs the app's check (`apps/trustweb/src/share_sink/check.ts`) on the record.

It makes no network calls. It reads and writes local files only (`packages/cli/test/no_network.test.ts` proves it).

## Running it

Node >= 22.13, nothing installed. From the repository root:

```
node packages/cli/bin/trustweb.mjs --help
```

A shell alias saves typing: `alias trustweb="node /path/to/trustweb/packages/cli/bin/trustweb.mjs"`. The examples
below assume it.

**The record file.** `trustweb init` creates `.trustweb/record.json` in the current directory. Every other command
finds the record like git finds `.git`, in this order:

1. `--record <file>` (relative to the current directory);
2. the `TRUSTWEB_RECORD` environment variable;
3. the nearest `.trustweb/record.json` walking up from the current directory.

No record found: the command exits 1 and says to run `trustweb init` or pass `--record`.

**Global options** (every command takes them):

| option | what it does |
|---|---|
| `--record <file>` | use this record file |
| `--json` | print the result as JSON (a stable shape per command) instead of text |
| `--now <iso-date>` | pretend it is this moment (tests, replays); else `TRUSTWEB_NOW`, else the clock |
| `-h`, `--help` | help for the command or subcommand; every node of the tree has it |
| `-V`, `--version` | print the version |

**Exit codes**, git-like: `0` done; `1` the record or the request refused it (no record, an unknown person, a zone
not set up, a bad file); `2` wrong use of the command line (unknown option, missing argument, a group without a
subcommand). Errors go to stderr and say what to run instead.

## Concepts

### The ladder

Zones are the fixed TrustZones ladder (`share_sink/zones.ts`, `LADDER`), outer to inner. A higher zone is more
intimate. The labels are the defaults (`domain.ts`, `ZONE_LABELS`) until a zone is renamed.

| zone | default label | |
|---|---|---|
| `public` | Public | always on |
| `intending` | Intending to connect | |
| `acquaintance` | Acquaintances | |
| `community` | Community | |
| `friend` | Friends | |
| `close` | Close friends and allies | |
| `closest` | Closest few | |
| `self` | Self | always on (the owner alone) |

A person may sit in several zones; the most intimate one that is on counts.

### Create and archive

`zone create <zone>` sets a zone up in this record: switches it on and gives it a label. `zone archive <zone>` switches
it off, `zone unarchive` back on. `public` and `self` are always on and are never created, renamed or archived.

Off means what the app means by it (`zones.ts`):

> The innermost of a person's zones among the rings switched on; public when none is.

> An item shared to a ring that is off moves one ring in (to the next ring on), never out (I9).

So a person whose only zone is archived counts as public, and an item shared to an archived zone is visible only from
the next ring in that is on (`effectiveZone`). Nothing is deleted: unarchive and it all counts again.

### Tags and tag rules

A person carries tags (`person tag ada garden`). A tag can be added to a zone (`zone add-tag friend garden`): that is
a *rule*, and every live carrier of the tag, and of every tag nested under it, counts as in that zone.

### Nesting

`tag nest roses garden` puts `roses` under `garden`: a carrier of `roses` holds `garden` too. The tags form a DAG; a
cycle is refused, and so is a chain deeper than 4 levels (`share_sink/tags.ts`, `MAX_DEPTH`; a root tag is level 1).
Nesting goes only through the app's `nest`, so the CLI cannot write a graph the app would refuse.

### Shares

`share add bike --zone friend` appends one share line (`share_sink/share_lines.ts`, `appendShare`), the same line the
app's Share page writes. Per item the **latest** share line wins; `share revoke bike` ends it. A share's scope is a zone
plus `--also <id>` (people or tags who see it besides the zone) and `--except <id>` (who does not). **An exclusion beats
everything**: a zone, a tag, a direct grant (D3 in `check.ts`). Scope tuples expire after a year by default (I9).

### The derived store

The record keeps facts. Every visibility answer runs on the store derived from them at `now` (`sink.ts`, `storeOf`):

- the record's tuples (the facts);
- the tag rules unfolded: one `person:<id> in_zone zone:<z>` tuple per carrier, marked `"tag": "tag:<t>"`;
- the scope tuples of the latest share line per item.

`canAccess` then runs on that store with the zones that are on (`activeZones`). Because rules and memberships have
`since`/`until`, the derived store depends on the clock; `--now` pins it.

### The audit log

Every command that changes the record writes exactly one human-readable line to the record's log (I6): when, which
device, the command as typed, and what it did. `trustweb log` shows it. A command that refuses writes nothing; a
command that finds nothing to do (adding what is already there) says so, exits 0 and writes nothing.

### What stays local

Everything. The record is one file on this machine. The CLI does not sync, upload, or contact anyone.

## Command reference

Ids: bare (`ada`) where the kind is clear, or typed (`person:ada`, `tag:garden`, `zone:friend`, `item:bike`). Output
uses typed ids. Every command answers `--help` with its usage, options and examples.

Outputs marked *(illustrative)* are written from the specification, for commands built in parallel with this page;
the shape of the text may differ in detail. Unmarked outputs were produced by running the command (paths shortened
to `/home/me/web`, long runs of lines cut to `...`).

### init

`trustweb init [--device <name>]`: creates an empty record in `./.trustweb/record.json` (or at `--record`). The device
name becomes `by` on every tuple this record writes (`device:<name>`, default `device:cli`). Refuses to overwrite a
record that exists; refuses a device name with a space or a colon.

```
$ trustweb init --device laptop
Created /home/me/web/.trustweb/record.json
Writing as device:laptop. Next: trustweb zone create friend --label "Friends"
```

### log

`trustweb log [-n <count>]`: the audit lines, oldest first.

```
$ trustweb log
when              by             command            what
----------------  -------------  -----------------  ----------------------------------------------------------------------------
2026-10-01 09:00  device:phone   init               record created by device:phone
2026-11-02 12:00  device:laptop  init               record created by device:laptop
2026-11-02 12:00  device:laptop  import phone.json  imported phone.json (merge): +1 zone, +1 person, +1 tag, +2 tuples, +1 share
```

### zone

| command | what it does |
|---|---|
| `zone list` | the ladder with each zone's label and state (always-on, on, archived, not set up) |
| `zone create <zone> [--label <text>]` | set the zone up (on); label defaults to the ladder's word |
| `zone rename <zone> <label>` | new label |
| `zone archive <zone>` | switch it off (see Create and archive) |
| `zone unarchive <zone>` | switch it back on |
| `zone add-person <zone> <person>...` | `person:<id> in_zone zone:<z>` |
| `zone remove-person <zone> <person>...` | closes those tuples (`until` = now) |
| `zone add-tag <zone> <tag>...` | a tag rule: `tag:<t> in_zone zone:<z>` |
| `zone remove-tag <zone> <tag>...` | closes the rule |

Refusals (exit 1): `public`/`self` given to create, rename or archive; a zone not set up (`run trustweb zone create
<zone>`); adding people to an archived zone (`run trustweb zone unarchive <zone> first`); an unknown or removed person
or tag; removing what is not there.

```
$ trustweb zone create friend --label "Friends"          (illustrative)
zone friend set up (Friends)
$ trustweb zone add-person friend ada                    (illustrative)
person:ada in zone friend
$ trustweb zone add-person friend ada                    (illustrative)
person:ada is already in zone friend
```

### person

| command | what it does |
|---|---|
| `person list [--all]` | persons with their zone and tags; `--all` includes removed ones |
| `person add <id> [--name <text>]` | declare a person |
| `person rename <id> <name>` | new display name |
| `person remove <id>...` | sets `removedAt` and closes their live tuples; nothing is deleted |
| `person tag <id> <tag>...` | `person:<id> has_tag tag:<t>` |
| `person untag <id> <tag>...` | closes those tuples |

```
$ trustweb person add ada --name "Ada"                   (illustrative)
person:ada added (Ada)
$ trustweb person tag bo garden                          (illustrative)
person:bo tagged garden
```

### tag

| command | what it does |
|---|---|
| `tag list [--all]` | tags with carriers and nesting; `--all` includes removed ones |
| `tag add <id> [--label <text>]` | declare a tag |
| `tag rename <id> <label>` | new label |
| `tag remove <id>...` | sets `removedAt` and closes the tag's live tuples |
| `tag nest <child> <parent>` | `tag:<child> nested_in tag:<parent>`; refuses a cycle or depth > 4 |
| `tag unnest <child> <parent>` | closes that tuple |

```
$ trustweb tag nest roses garden                         (illustrative)
tag:roses nested in tag:garden
$ trustweb tag nest garden roses                         (illustrative)
trustweb: tag:garden under tag:roses would make a cycle
```

### show

| command | what it does |
|---|---|
| `show zone <zone>` | who sits in it (directly or through a tag rule) and what a member of it can see |
| `show tag <tag> [--markdown]` | who carries it and what it opens |
| `show person <person> [--markdown]` | their zone, tags, and every item they can see with the tuples that say why |
| `show item <item>` | its latest share line and who can see it |

"What a zone or tag can see" is answered with a probe: a stand-in member is put in the zone (or given the tag) and
`canAccess` is asked, so the answer comes from the same oracle as everything else. `--markdown` prints the app's
`toMarkdown` page.

```
$ trustweb show person bo                                (illustrative)
person:bo (Bo)  zone friend (through tag:garden)
tags: tag:garden
can see:
  item:bike  person:bo in_zone zone:friend; zone:friend may_read item:bike
```

### share

| command | what it does |
|---|---|
| `share add <item> --zone <zone> [--also <id>]... [--except <id>]...` | append a share line |
| `share list [--all]` | the latest share per item; `--all` lists every line |
| `share preview <item> --zone <zone> [--also ...] [--except ...]` | who would see it, writing nothing (`previewShare`) |
| `share revoke <item>` | append a revoke line; the item is shared with no one |

`--also` and `--except` take person or tag ids. The preview and the enforcement are the same check on the same store,
so they cannot disagree.

```
$ trustweb share preview bike --zone friend --except cy  (illustrative)
item:bike to zone friend would be seen by 2: person:ada, person:bo
$ trustweb share add bike --zone friend --except cy      (illustrative)
item:bike shared to zone friend (except person:cy): 2 people see it
```

### export

`trustweb export [--format json|jsonl|markdown] [--effective] [--out <file>] [--force]`. Export only reads: no commit,
no log line.

- `json` (default): the record's canonical bytes; `import` reads them back. `--json` prints the same bytes.
- `jsonl`: the relation store as kept, one tuple per line, through the app's `toJsonl` (facts only).
  `--effective`: the derived store at `--now` (facts, unfolded tag rules, scope tuples of the latest shares).
- `markdown`: the app's `toMarkdown` page per known person and per live tag, in id order, separated by a blank line.
  Always on the derived store.
- `--out <file>`: write there (its directory is made), print `wrote <path> (<n> bytes)`. An existing file is refused
  unless `--force`. With `--json`: `{"wrote", "bytes", "format", "effective"}`.

Refusals: an unknown `--format` and `--effective` with `json` are usage errors (exit 2).

```
$ trustweb export --format jsonl --effective
{"subject":"person:ada","relation":"in_zone","object":"zone:friend","since":"2026-11-02T12:00:00.000Z","by":"device:laptop"}
...
{"subject":"tag:garden","relation":"in_zone","object":"zone:friend","since":"2026-11-02T12:00:00.000Z","by":"device:laptop"}
{"subject":"person:bo","relation":"in_zone","object":"zone:friend","tag":"tag:garden","since":"2026-11-02T12:00:00.000Z","by":"device:laptop"}
{"subject":"zone:friend","relation":"may_read","object":"item:bike","since":"2026-11-02T12:00:00.000Z","until":"2027-11-02T12:00:00.000Z","by":"device:laptop"}
{"subject":"person:cy","relation":"excludes","object":"item:bike","since":"2026-11-02T12:00:00.000Z","until":"2027-11-02T12:00:00.000Z","by":"device:laptop"}

$ trustweb export --format markdown
# person:ada

- zone: friend
- tags: none

## Can see

- item:bike
  - person:ada in_zone zone:friend
  - zone:friend may_read item:bike

# person:bo
...

$ trustweb export --out backup/web.json
wrote /home/me/web/backup/web.json (2479 bytes)
```

(That record: ada in friend, cy in close, bo and cy carrying garden (cy through roses), a rule garden -> friend, and
bike shared to friend except cy.)

### import

`trustweb import <file> [--replace | --merge] [--dry-run]`. The file is a record as `export` writes it. It is
validated in full first (`record.parseRecord`, with the share sink's tuple check inside); a bad file exits 1, names
the file and the problem, and writes nothing.

- **No record here yet**: the file becomes the record (`./.trustweb/record.json`, or `--record`), byte for byte, like
  a clone: the same device, the same log. `export` there gives the same bytes as `export` where it came from.
- **A record here**, and neither option: refused, with the two choices.
- `--replace`: the file's record takes its place. One log line is appended:
  `imported <file>, replacing the record of <old device>`.
- `--merge`: ours stays and gains what it lacks. Zones, persons and tags by id: missing ones are added, ours are kept
  as they are (a person removed here stays removed). Tuples: every one not already here (all fields equal). Share
  lines: appended after ours, `seq` renumbered to follow ours, `cutoff` (share, agree) or `at` (revoke) moved by the
  same amount, so a one-off share still shows exactly the lines it showed; a line already here is skipped. Logs: the
  union in time order, then the import's own line. The device stays ours. Merging the same file again adds nothing
  and writes nothing.
- `--dry-run`: the summary, nothing written. `--json`: `{file, record, mode, dryRun, added, skipped, replaced?}`.

`--replace` with `--merge` is a usage error (exit 2).

```
$ trustweb import phone.json
trustweb: a record already exists at /home/me/web/.trustweb/record.json: add --merge to add what phone.json has
to it, or --replace to swap it for phone.json (--dry-run shows what either would do)
$ trustweb import phone.json --merge
imported phone.json (merge) into /home/me/web/.trustweb/record.json: +1 zone, +1 person, +1 tag, +2 tuples, +1 share
  zones    +1
  persons  +1  (1 already here)
  tags     +1
  tuples   +2
  shares   +1
$ trustweb import phone.json --merge
phone.json: nothing new; the record at /home/me/web/.trustweb/record.json already holds all of it
  ...
$ trustweb import bad.json --merge
trustweb: bad.json: kind must be "trustweb-cli-record"; nothing was imported
```

A merge appends the other record's lines after ours, so for an item both records shared, the other record's latest
line wins. Look at `--dry-run` first.

## Record format

One JSON object (`packages/cli/src/record.ts`):

```
{
  "kind": "trustweb-cli-record",
  "v": 1,
  "device": "device:laptop",
  "zones":   { "friend": { "label": "Friends", "createdAt": "...", "archivedAt": "..." } },
  "persons": { "ada": { "name": "Ada", "addedAt": "...", "removedAt": "..." } },
  "tags":    { "garden": { "label": "garden", "addedAt": "...", "removedAt": "..." } },
  "tuples":  [ { "subject": "person:ada", "relation": "in_zone", "object": "zone:friend", "since": "...", "by": "device:laptop" } ],
  "shares":  [ { "op": "share", "id": "item:bike", "seq": 1, "scope": { "zone": "friend", "include": [], "exclude": [] },
                 "cutoff": 1, "to": "zone:friend", "terms": "read-keep", "ts": "..." } ],
  "log":     [ { "at": "...", "by": "device:laptop", "command": "init", "text": "record created by device:laptop" } ]
}
```

- `zones`: only the ladder zones set up here (never `public` or `self`); `archivedAt` present = off.
- `tuples`: the share sink's relation store, shape and validation from
  [`apps/trustweb/src/share_sink/tuples.ts`](../apps/trustweb/src/share_sink/tuples.ts):
  `{subject, relation, object, zone?, tag?, since, until?, by}`.
- `shares`: share lines from [`share_lines.ts`](../apps/trustweb/src/share_sink/share_lines.ts) (`share`, `revoke`,
  `retract`, `agree`).
- `log`: one line per change.

**Canonical bytes**: top-level keys in the order above, `zones`/`persons`/`tags` sorted by id, tuple keys in the
share sink's order, two-space indent, final newline. The same record always writes the same bytes, so it diffs well
in git. Writes go through a temporary file and a rename.

**Append-only**: a membership that ends is closed with `until`, never removed; a removed person or tag gets
`removedAt` and keeps its entry; share lines and log lines are only appended. The record is its own history. The one
deliberate exception is `import --replace`, and it is logged.

## How it reuses the app

- The rules are the app's modules, imported as source: `apps/trustweb/src/share_sink/` (`zones.ts`, `tuples.ts`,
  `check.ts`, `tags.ts`, `share_lines.ts`, `export.ts`). `zones.ts` imports `apps/trustweb/src/model.ts` for the
  ring enum; the model's other imports are type-only.
- `packages/cli/src/sink.ts` is the only CLI file that imports the app. It re-exports what the commands use and adds
  the views the CLI needs on top (`activeZones`, `personIds`, `latestShares`, `unfoldTagRules`, `storeOf`). A test
  checks no other file reaches into `apps/`.
- `packages/cli/scripts/register.mjs` lets plain Node run all of it: Node's own type stripping (transform mode,
  because the model and the share sink use enums) and a resolver for the app's extensionless imports (`./zones`).
  `bin/trustweb.mjs` and the test run load it.
- Two type shims (`packages/cli/types/shims/`) stand in for `@noble/curves` and `multiformats`: the model's
  type-only imports reach `apps/demo`'s identity code, which names them. The CLI never runs that code; the shims let
  `tsc` check the CLI without a browser toolchain installed. (`types/env.d.ts` does the same for Vite's
  `import.meta.env`.)

## Testing

From `packages/cli/`, three gates, all must pass:

```
node --import ./scripts/register.mjs --test --test-reporter spec "test/**/*.test.ts"
tsc --noEmit -p tsconfig.json
node scripts/lint.mjs
```

- Tests are `node:test` + `node:assert/strict`, in-process through `test/helpers/run.ts` (`Cli` runs a command line
  in a temporary directory with the clock pinned; `seeded()` gives a standard fixture; `withRecord` edits it).
- Test first: a failing test, then the code. Every subcommand: happy path, refusals, `--json` shape, idempotence,
  the log line, archived zones and removed persons where they matter. `test/cli.test.ts` checks `--help` on every
  node of the command tree.
- Lint: the licence header on line 1 of every file, and no network or browser API anywhere in the CLI.
- No personal data: ids `ada`, `bo`, `cy`, `di`, `eve`; tags `garden`, `roses`, `choir`; items `bike`, `ladder`,
  `seeds`.
- No network, proven twice (`test/no_network.test.ts`): statically (no CLI file imports a network or process
  module; the app files it reaches import only each other, plus types) and at run time (fetch, `net.Socket`
  connect, dns, http(s), tls, http2, dgram and child_process replaced by tripwires while a whole session runs; none
  fires).

## Honesty box

- This is a **local record editor**. It is not the app's sync and does not talk to other devices.
- It is **not zero-knowledge** and adds no privacy of its own: the record is a plain JSON file, readable by anyone
  who can read the file.
- Nothing done here changes what another device sees until the record travels there by other means (a file copy,
  git, an import on the other side). `import` is how a record arrives; it does not fetch anything.
- `show` and `share preview` answer with the app's `canAccess`, on this record. They say what the rules give, not
  what any other copy of the record says.
