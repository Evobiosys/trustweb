# Preview window / dev panel: operator guide

One folder for every command behind the preview window. A session needs only this path
(`tools/preview/` in the app repo, Evobiosys/trustweb). `tools/preview/preview` forwards to the ops repo's
`bin/preview` (path read from `~/.cache/trustweb-dev/ops.path`, default below).

```
tools/preview/preview tw new
```

## What the previews are

- **Personal preview**: local, runs on Jakob's own record (`TW_DEV_RECORD`, path in
  `~/.cache/trustweb-dev/dev-record.path`). Never pushed, never committed, no names in reports.
- **Stock preview**: local, without his data (dummy/welcome) = what other users see. It is the "stock twin" of each personal preview.
- **Dev slot**: hosted, built by CI from a pushed branch, demo data only (`dev` / `dev2` / `dev3` .trustweb.one).
- `mode personal|stock` picks which window the next launch opens.

## Paths

```
WOT=~/Documents/SingularStructure/PROJECTS/evobiosys/PROJECTS_evobiosys/EvoBioSys-cross/PROJECTS_evobiosys-cross/web-of-trust
O=$WOT/Code/trustweb-ops          ops repo (local git, never pushed): bin/preview, bin/preview_lib.mjs, bin/tw_*.sh, test/, DEVLOG/wave<N>/
R=$WOT/Code/primary-repo          app repo checkout, detached; never edit there
$WOT/Code/worktrees/preview-<id>        the assembled preview (branch preview/<short>)
$WOT/Code/worktrees/wave<N>-<slug>      one row = one worktree = branch wave<N>/<slug>
~/.cache/trustweb-dev/previews/<id>.json    registry (TW_PREVIEWS_DIR overrides); id = tw<YYMMDD>_<HHMM>
~/.cache/trustweb-dev/ops.path              ops repo path used by the wrapper
$O/previews/features-tw.json            catalogue of rows (key, ref, branch, title, requires, selector, steps)
$O/previews/features-tw-archive.json    rows already merged into main
```

## Commands

Run as `tools/preview/preview <args>` (or `$O/bin/preview <args>`). `tw` = newest preview of project tw, `tw2` = second newest.

| Command | Effect |
|---|---|
| `preview tw new [--only k1,k2] [--approved]` | next free id, worktree + branch `preview/<short>` from origin/main, merge the rows, launch. Rows start loaded, never approved, unless `--approved` |
| `preview tw` / `preview <id>` | launch that preview in its stored mode |
| `preview <id> apply` | assemble base + loaded rows in catalogue order (+ `pnpm install` when the lock changed); one run at a time, a second call queues one follow-up |
| `preview <id> toggle <key> on\|off` | load (+ its requires) or unload (+ its dependants) one row; registry only until `apply` |
| `preview <id> set <key>=on\|off[,...]` | load/unload exactly that state, no cascade; unmet requires exit 2 |
| `preview <id> verdict <key> approve\|needs-work` | owner's call per row (the CLI also accepts `merge` = approve, `clear`); approve loads it, needs-work unloads it |
| `preview <id> sync` | a builder moved a catalogue ref: those rows lose their verdict; new rows join unchecked |
| `preview <id> stop` | stop its dev server + stock twin |
| `preview <id> pr` | push as `task/<short>`, open or update the PR, wait for CI + slot. Refuses while a loaded row is unapproved |
| `preview <id> compat` | compatibility matrix (see below) |
| `preview <id> mode personal\|stock` | window of the next launch |
| `preview <id> test` | optional local CI gates on the assembled worktree; writes `tested{}` into the registry |
| `preview tw ls` / `preview tw features` | table of previews / the catalogue |

Two states per row: **loaded** (box checked = merged into the assembly) and **approved** (verdict merge = reviewed and liked).
`toggle`, `set`, `verdict`, `sync` only write the registry; nothing assembles until `apply` (the panel fires it after every box).

**macOS gotcha**: `timeout` is absent; bound a long command with perl:

```
perl -e 'alarm 300; exec @ARGV' -- tools/preview/preview tw new
```

Other scripts in `$O/bin/`:

- `tw_pr_done.sh <branch> [pr-number]`: tell the panel a PR was opened by hand (e.g. `tw_pr_done.sh preview/261031_0840`).
- `tw_approve.sh`, `tw_approve_local.sh`, `tw_approve_merge.sh`: approval of a pushed candidate (the PR flow calls them).
- `tw_windows.sh`, `tw_snapshot.sh`, `tw_history.sh`: window handling, frozen earlier previews.
- Headless row builder: `~/.pi/scripts/headless_builder.sh <slug> <cwd> <task-file> <log-dir> [model]` (Sonnet, background; log `<log-dir>/<slug>.log`, status `<slug>.rc`).

## Gates

- Row/app (from `apps/trustweb`): `../demo/node_modules/.bin/tsc --noEmit -p tsconfig.json && ../demo/node_modules/.bin/vitest run --config test/unit/vitest.config.mjs`
- Desk/Curator (from `apps/crm`): `pnpm exec svelte-check && pnpm exec vitest run`
- Bundle (from `apps/trustweb`): `../crm/node_modules/.bin/vite build`, then `node test/scan_bundle_for_private_lines.mjs dist`
- Ops (from `$O`): `node --test test/*.test.mjs` (a directory argument fails on node 26)

## Ports

| Port | Use |
|---|---|
| 5200 / 7200 | dev (5300 = frozen older preview) |
| 5250 / 5350 / 7250 | current personal preview / its stock twin / relay |
| 5280 | reserved by the ops setup |
| 8263 | Curator notes bridge (`apps/crm/scripts/notes_bridge.mjs`); "connection refused" in the console = bridge not running |
| 5400-5499 | free for row builders' own vite servers |

Pattern: stock twin = port + 100, relay = port + 2000 (`scripts/tw_dev.sh`, default 5190).

## Wave flow

1. Rows are written down (`$O/DEVLOG/wave<N>/wave<N>-rows.txt`), one section per row, plus `instructions-common.txt`.
2. One worktree per row: `$WOT/Code/worktrees/wave<N>-<slug>`, branch `wave<N>/<slug>` from main.
3. Briefs go to disk; headless builders run (`headless_builder.sh`), each writes `<slug>_result-report.txt` and commits locally.
4. Integrate: rows join `features-tw.json` in order; `preview tw new` assembles them.
5. Jakob looks at the personal preview, approves or unchecks rows. Unchecked rows stay and get adjusted on the same branch.
6. **One PR per session**, opened at the end (`preview <id> pr`). Jakob merges it. Agents never merge or push `main`.
   GitHub main auto-deploys to app.trustweb.one.

## Conflict rules

- Merge, never rebase. On a conflict keep both sides (both imports, both fields, both strings).
- A row branch that depends on earlier rows merges them first (`requires` in the catalogue).
- `main.ts` and `strings.ts` are shared: smallest region, new strings next to the same screen's strings.
- An assembly conflict is aborted, recorded in the registry (`assembled.conflicts`), and the remaining rows still merge.
- Rows already in main are archived to `features-tw-archive.json` and must not be merged again.

## Compat matrix

`bin/preview_compat.mjs <id>` (pure logic in `bin/compat_lib.mjs`; built by the ops row ops-compat on branch wave27/catalogue;
not in the checkout this README was written from, so check `ls $O/bin` first). For the loaded rows it uses `git merge-tree --write-tree`
(in memory, no checkout) against the base sha: each row alone, every pair, the full set as a chain (scratch ref `refs/compat/<id>`),
and, when the full set conflicts, every all-but-one set to name the culprit. The result lands in the registry as `compat`.
Pairs + full + all-but-one cover what git can show for any subset of checkmarks; a purely semantic clash (compiles, behaves wrong) stays invisible.
It runs in the background after `apply`; the Approve gate waits for `compat.state === "ok"`.

## Rollback

From `$WOT`: `~/.claude/scripts/dehydrate.sh --rollback DEVLOG Code/trustweb-ops`. Restore: `dehydrate.sh --restore <tag> <paths>`.
Nothing is ever deleted: `trash <absolute path>` or a dated archive.

## Genealogy link

Evobiosys/trust-family (github.com) auto-deploys every merge to main to evobiosys.org/stammbaum (and /bindungsanalyse):
LaunchAgent `com.local.stammbaum-autodeploy` runs `~/.pi/scripts/stammbaum_autodeploy.sh` every 2 min
(log `~/.cache/stammbaum-deploy/deploy.log`). `family_tree_link.ts` connects the two apps (PR #56, merged 2026-11-01).
