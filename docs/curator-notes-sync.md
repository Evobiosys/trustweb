<!-- SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later -->
# Curator notes sync: the scheduled pull

The Web Curator (`apps/crm`) can learn about people from your own notes vault (Obsidian or Logseq, a folder of markdown
files). `notes_sync.mjs pull` reads the notes that changed since the last run, asks a model which people each note names,
and merges them into your TrustWeb record. This page covers running it on a schedule, every 15 minutes, without supervision.

## The command

```sh
node apps/crm/scripts/notes_sync.mjs pull --vault ~/Notes --seed ~/trustweb/record.json \
  --reader ollama:qwen3.5:9b --skip-folders speakers,pitches
```

| Flag | Meaning |
| --- | --- |
| `--vault <dir>` | the vault (required) |
| `--seed <record.json>` | the TrustWeb record the people are merged into; it must exist (required) |
| `--reader <kind>:<model>` | who reads the notes (required): `ollama:<model>` or `claude:<model>`, see below |
| `--skip-folders a,b` | vault-relative folders never read (merged with `.trustweb-notes.json`, see below) |
| `--include a,b` | read only these subfolders |
| `--me "<name>"` | your own name, so you are not added as a person |
| `--work <dir>` | where the readings, the tana-links file and the lock live (default `<vault>/assets/local-notes`) |
| `--no-lock` | skip the lock (one-off runs by hand; never on a schedule) |

### The reader

- `ollama:<model>`: a local Ollama server (`OLLAMA_URL`, default `http://127.0.0.1:11434`). Free, slower, works offline.
  **With Ollama the vault never leaves the machine.**
- `claude:<model>`: the `claude` command-line tool on your own subscription. Each note is sent to that service to be read.
  The `claude` binary must be on the `PATH` the scheduler gives the job (launchd and systemd give a minimal one).

Either way the readings stay in `--work`, and only the merged record changes.

## Lock and exit codes

Each pull holds `<work>/pull.lock` (JSON: pid, start time, host) while it runs. A second pull that starts meanwhile prints
one line and leaves everything alone:

```
another pull is running (pid 4711, since 2026-11-03T09:00:00.000Z)
```

A lock is stale, and is taken over, once the process that wrote it has died or after 6 hours. The lock is released on
normal exit, on Ctrl-C and on SIGTERM (a scheduler stopping the job).

| Exit | Meaning |
| --- | --- |
| 0 | done (including "nothing new to read") |
| 2 | usage error, no seed at `--seed`, or an unreadable `.trustweb-notes.json` |
| 3 | another pull holds the lock; nothing was changed |
| other | the reader or the converter failed with that code (the message names the step) |

## Idempotency

Running the pull twice with no new notes does no harm:

- The reader is resumable by content hash. A note whose text (without TrustWeb's own blocks) and reader are unchanged is
  not read again, so it costs nothing. A note that failed is logged in `<readings>.errors.jsonl` and retried next run.
- The converter is one-shot: merging the same readings onto its own output gives the same record.
- When nothing has ever been read (an empty vault, or every read failed), the seed is left unchanged and the run exits 0.

## What is never read

| Rule | Where | Effect |
| --- | --- | --- |
| `trustweb: no` | front matter (also `no-trustweb` in tags, or `#no-trustweb` anywhere) | TrustWeb never touches the note: it is not read and no block is written into it |
| `people: skip` | front matter (also `no`, `none`, `false`; any case) | the note names people but creates none: it is not read for people |
| folder list | `--skip-folders` and `.trustweb-notes.json` | the same as `people: skip`, for whole folders (speaker scans, pitch decks) |

Skipped notes are never sent to the reader, so they cost nothing. The reader's summary line counts each kind:

```
412 notes, 37 in skipped folders, 9 too small, 3 opted out (#no-trustweb), 5 people: skip, 350 already read, 8 to read with ollama:qwen3.5:9b
```

### The folder list

Put the folders you never want read in `<vault>/.trustweb-notes.json`, so every run (scheduled or by hand) honours them:

```json
{ "skipFolders": ["speakers", "pitches", "work/clients"] }
```

The file's list and `--skip-folders` are merged. Entries are folder paths relative to the vault root, matched on whole
path segments: `speakers` skips `speakers/x.md` and `speakers/2026/y.md`, but not `archive/speakers/z.md` (list
`archive/speakers` for that) and not `speakers-old/`. If the file is not valid JSON, or `skipFolders` is not a list, the
pull stops with exit 2 rather than read notes you meant to keep out.

TrustWeb's own generated pages folder (marked by a `.trustweb-generated` file) and code or cache folders (`.obsidian`,
`.git`, `node_modules`, `.trash`, ...) are never read either.

## Scheduling

Every example runs the pull every 15 minutes and appends its output to a log. Replace `/Users/you`, `/home/you` and the
paths to your checkout, vault and record. launchd and systemd do not expand `~`, so write full paths there.

### macOS: launchd user agent

`~/Library/LaunchAgents/org.trustweb.notes-pull.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>org.trustweb.notes-pull</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/you/trustweb/apps/crm/scripts/notes_sync.mjs</string>
    <string>pull</string>
    <string>--vault</string><string>/Users/you/Notes</string>
    <string>--seed</string><string>/Users/you/trustweb/record.json</string>
    <string>--reader</string><string>ollama:qwen3.5:9b</string>
    <string>--skip-folders</string><string>speakers,pitches</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/Users/you/Library/Logs/trustweb-notes-pull.log</string>
  <key>StandardErrorPath</key><string>/Users/you/Library/Logs/trustweb-notes-pull.err.log</string>
</dict>
</plist>
```

```sh
launchctl load ~/Library/LaunchAgents/org.trustweb.notes-pull.plist     # start
launchctl unload ~/Library/LaunchAgents/org.trustweb.notes-pull.plist   # stop
```

### Any Unix: crontab

`crontab -e`, then one line (cron's `PATH` is minimal too: use the full path to `node`):

```
*/15 * * * * mkdir -p ~/.cache/trustweb && /usr/bin/node ~/trustweb/apps/crm/scripts/notes_sync.mjs pull --vault ~/Notes --seed ~/trustweb/record.json --reader ollama:qwen3.5:9b --skip-folders speakers,pitches >> ~/.cache/trustweb/notes-pull.log 2>&1
```

A run that finds the previous one still going exits 3 and writes one line to the log.

### Fedora (or any systemd distribution): user timer

`~/.config/systemd/user/trustweb-notes-pull.service`:

```ini
[Unit]
Description=TrustWeb: pull people from the notes vault

[Service]
Type=oneshot
ExecStart=/usr/bin/node %h/trustweb/apps/crm/scripts/notes_sync.mjs pull --vault %h/Notes --seed %h/trustweb/record.json --reader ollama:qwen3.5:9b --skip-folders speakers,pitches
# exit 3 = another pull holds the lock: not a failure
SuccessExitStatus=3
```

`~/.config/systemd/user/trustweb-notes-pull.timer`:

```ini
[Unit]
Description=TrustWeb: pull people from the notes vault every 15 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min

[Install]
WantedBy=timers.target
```

```sh
systemctl --user daemon-reload
systemctl --user enable --now trustweb-notes-pull.timer
journalctl --user -u trustweb-notes-pull.service     # the log
loginctl enable-linger "$USER"                       # optional: keep running while logged out
```

## Cleanup

Placeholder: the sibling part documents `notes_sync.mjs cleanup` here.

## Join offers

Placeholder: the sibling part documents Settings > Obsidian / Logseq > names to join here.
