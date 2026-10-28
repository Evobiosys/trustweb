# Data loss prevention (DLP): backup and restore-drill plan

Status: **proposal, not built** (2026-10-27). Nothing below changes a running system. Where it names
something that exists today it says so; everything else is a proposal for the owner to accept, change or reject
(see "Open decisions"). The invariants it must not break are I1 (local sovereignty), I7 (honest labeling) and
I9 (conservative defaults) in `CLAUDE.md`.

"DLP" here means **loss prevention** (data that disappears or becomes unrecoverable), not leak prevention.
Leak prevention is the privacy design itself (I1 to I3, `PRIVACY.md`).

## Conclusion

1. **Today there is exactly one copy of the server state, on one host, with no off-host backup and no restore ever rehearsed.**
   The deploy script takes a `.bak.<timestamp>` copy of the unit and Caddyfile before it changes them
   (`scripts/deploy_trustweb_backup.sh`), and the phone keeps its last 5 local snapshots before merges
   (R1/R2 in `DECISIONS.md`). Neither survives loss of the questhub host.
2. **The comparable SaaS products do not protect you the way their marketing suggests, and most do not publish numbers.**
   What they share is simple: the vendor backs up its own platform, the customer gets a short undo window (trash,
   version history), and anything stronger (customer-held export, point-in-time restore) is either absent or sold by
   third parties. TrustWeb can do better on one axis (ciphertext-only, customer-held keys) and must not copy the weak one
   (no rehearsed restore).
3. **Proposal in one line:** encrypted, deduplicated snapshots (hourly for the small identity stores, nightly for the rest)
   to a second EU/CH provider with append-only credentials, 35 days retention, a dead-man's-switch alert, and a restore
   drill every month on the staging unit with synthetic data. Targets: connect codes RPO 1 h / RTO 4 h; blobs RPO 24 h / RTO 4 h.
4. **Biggest hidden hazard:** the daemon's SQLite runs in WAL mode (`packages/agent-daemon/src/store/sql_driver.ts`);
   copying only the `.db` file silently loses committed data that still sits in the `-wal` file. Device-side backups must use
   SQLite's backup API or `VACUUM INTO`, never a file copy. This is a follow-up task, not part of this PR.

Confidence 0.7 on the plan's fit; 0.5 on the vendor claims below, because the primary sources could not be fetched in the
session that wrote this (network policy). Treat every row marked unverified as a lead, not a fact.

## Comparable SaaS: how they prevent data loss

Method: what each vendor publicly says, then the mechanism class. Source tiers: A = law, government, science; B = journal,
analyst, vendor documentation; C = community or third-party vendor marketing. The session had search but not page fetch,
so **no vendor primary page was read**. "unverified" means exactly that; check the URL column's publisher before relying on a row.
⚠️ marks claims that are unverified or whose source date was not captured.

| Product | What is publicly claimed | Customer-facing recovery | Source (publisher, date) and tier | Status |
|---|---|---|---|---|
| Tana | No official backup, retention or trust-center page surfaced. Users ask on the vendor's ideas board for a complete backup/export to file or external cloud, i.e. the gap is known to users. | Export exists in some form; completeness unknown ⚠️ | Tana ideas board, feature request "complete backup, export and import", date not captured [C] | unverified |
| Notion | No official RPO or RTO surfaced. Third-party backup vendors describe a shared-responsibility model: Notion protects its platform, the customer protects against their own deletes. Deleted pages sit in Trash for a limited window (30 days is the figure widely quoted) and page history is limited by plan ⚠️ | Trash and page history; no customer-chosen point-in-time restore | Rewind, HYCU, SimpleBackups product pages, dates not captured [C]; Notion help center not read | unverified |
| Linear | Infrastructure-level backups exist to recover Linear's own platform; they are not browsable or restorable by a customer. Third parties sell workspace backups with customer-held keys. | None native for a team's own mistakes beyond in-product archive/undo ⚠️ | SimpleBackups, Cloudback pages, dates not captured [C]; Linear security page not read | unverified |
| Obsidian Sync | End-to-end encrypted sync (AES-256), audited by Cure53 and later Trail of Bits; version history (saved roughly every 10 s while editing) and deleted-file recovery; retention length by plan not confirmed. The vault is also plain files on the user's disk, so the user always holds a full copy. | Version history, deleted-file recovery, and the local vault itself | Obsidian sync page and changelog, 2024 to 2025, relayed by search results [B]; retention figures not read | unverified |

What the table says in mechanism terms:

| Mechanism | How the comparable products do it (as far as known) | What it protects against | What it does not |
|---|---|---|---|
| Undo window (trash, version history) | All four, with limits by plan | Fat-finger deletes, bad edits | Account lockout, vendor outage, malicious delete past the window |
| PITR (point-in-time recovery: restore to any moment in a window) | Vendor-internal for the platform database; **not** customer-exposed by Tana, Notion or Linear as far as found. Third-party tools offer it per workspace. | Slow corruption, bad deploy, ransomware inside the window | Anything older than the window; needs write-ahead log or frequent snapshots |
| Multi-region / multi-AZ (copies in other regions or availability zones) | Vendor claims typical for large SaaS, not verified here ⚠️ | Datacenter loss | Logical errors (a delete replicates everywhere) |
| Customer-held copy (export, local files) | Obsidian by design; others via export or third parties | Vendor failure, lockout | Staleness: an export is only as fresh as its last run |
| Restore drill (rehearsed restore with a timer and pass criteria) | Not published by any of the four ⚠️. SOC 2 style audits usually require evidence of restore testing, but the reports are not public. | The untested-backup failure: a backup that cannot be restored | Nothing, if it is done and logged; that is the point |

Normative anchors for an EU operator [A], publisher and date:

- Regulation (EU) 2016/679 (GDPR), Official Journal 2016-05-04, Art. 32(1)(c): the ability to restore availability and access to personal data in a timely manner after an incident.
- Directive (EU) 2022/2555 (NIS2), Official Journal 2022-12-27, Art. 21(2)(c): business continuity such as backup management and disaster recovery. Whether TrustWeb is in scope is for the owner to check; the control list is a good checklist either way.
- 3-2-1 rule (three copies, two media, one off-site), popularised by a photographer's backup guide around 2009 [C] ⚠️ older than ten years; a rule of thumb, not a standard.
- SQLite documentation, "Online Backup API" and `VACUUM INTO`, sqlite.org, current docs, date not captured [B].

## What we hold and where

Read from the code, not from memory. Ciphertext-only means the host cannot read the bytes (I1, I7); it still sees sizes and timing.

| Surface | Lives in | Contents | Sensitivity | Rebuildable? |
|---|---|---|---|---|
| Device store | phone/laptop, SQLite via `packages/agent-daemon/src/store/sqlite_store.ts` | inventory, edges, policies, audit log | highest; source of truth (I1) | no |
| Encrypted backups | server `BACKUP_DIR`, one file per id, written tmp + fsync + rename (`services/trustweb-backup/server.mjs`) | ciphertext from the phone (`apps/trustweb/src/backup.ts`) plus a hash of the write token | ciphertext only | no; this is the recovery copy of the device |
| Connect codes and names | `connect.json` in `BACKUP_DIR` | permanent short addresses, usernames; only sha256 of each secret | pseudonymous | no: secrets are not recoverable, so a lost file breaks every code |
| Short links | `links.json` | https connect links, 30 day life | low | yes, users re-create |
| Organizer accounts | `organizers.json` | organizer names, counters | medium (names) | partly |
| Hosted recordings | `HOSTED_DIR`, swept after 90 days (`services/trustweb-backup/sweep_hosted.mjs`) | ciphertext audio | ciphertext only | no, but short-lived by design |
| Feedback | `feedback.jsonl` (`scripts/trustweb_feedback_read.sh` reads it) | free text, opt-in e-mail | **personal data in plaintext** | no |
| Deploy state | systemd unit, Caddyfile, credential files under the TrustWeb config directory | provider keys, admin token | secrets | redeploy script plus escrowed secrets |
| Code | git, GitHub plus extra remotes | source | public by intent (AGPL) | yes |

Worst-case size from the defaults in `services/trustweb-backup/server.mjs` and `config.mjs`: 5000 blobs of at most 1 MiB is about 5 GB,
hosted recordings are capped at 2 GB. Roughly 7 GB at the ceiling; storage cost is small. Price figures for providers are not in this document on purpose (not verified).

## Targets (RPO and RTO)

RPO (recovery point objective) is how much recent data we accept losing. RTO (recovery time objective) is how long recovery may take. All numbers are **proposed targets**, not measurements; the first drills produce the measurements.

| Surface | RPO | RTO | Why this number |
|---|---|---|---|
| Connect codes and names (`connect.json`) | 1 h | 4 h | cannot be rebuilt, and a lost file breaks every shared address |
| Encrypted backups (blobs) | 24 h | 4 h | phones hold the primary copy; the server copy is the safety net |
| Organizer accounts | 24 h | 24 h | small, changes rarely |
| Short links | 24 h | 24 h | 30 day life, loss is tolerable |
| Feedback | 24 h | 24 h | small, low urgency |
| Hosted recordings | 7 d | 24 h | ciphertext, 90 day life by design; weekly copy is enough (see D-4) |
| Deploy state and secrets | 0 (escrowed at change time) | 4 h | the script reinstalls code; secrets come from escrow |
| Device store | 24 h after the last successful encrypted upload | 1 h | depends on the app uploading; see D-6 |

## Backup plan

All of this is **proposed**; no part is built.

1. **Tool.** One deduplicating backup tool with client-side encryption (restic or borg; pick in D-1). The repository password and the append-only credentials are systemd credentials on the host (same pattern as the transcription keys), never in the repo.
2. **Schedule.** Hourly: `connect.json` and `organizers.json` (a few KB to MB). Nightly: everything under `BACKUP_DIR` except `tmp/`, plus `feedback.jsonl`. Weekly: `HOSTED_DIR`. Each run ends with a heartbeat ping to a dead-man's-switch (an alert fires when a ping is missing); self-hosted or EU-hosted, carrying no personal data.
3. **Consistency.** JSON stores are rewritten atomically and blobs are written tmp + fsync + rename, so a plain file read never sees half a file. Files may be from slightly different instants; that is acceptable because the stores do not reference each other. The device SQLite store is the exception: use the SQLite backup API or `VACUUM INTO` (see Conclusion, point 4).
4. **Where.** A second provider, a different legal entity and account, in the EU or Switzerland. This is our "multi-region": a different failure and jurisdiction domain, not active-active. We do not build high availability; one small host with an RTO of hours matches the "boring infrastructure" rule in `docs/40-infra.md`.
5. **PITR window.** Hourly snapshots for 48 h, daily for 35 days. That gives restore-to-the-hour for two days and restore-to-the-day for five weeks. It is snapshot PITR, not continuous log shipping; we do not claim more.
6. **Ransomware and compromise.** The host can add snapshots but not delete or rewrite them (append-only credentials or provider object lock). Pruning runs from a different machine under a different credential.
7. **Retention and erasure.** Everything that holds personal data (feedback e-mails, organizer names) rolls off after 35 days at most. State that figure in the privacy statement so a deletion request has a documented backup tail. No tier keeps personal data longer.
8. **Honesty (I1, I7).** Backups are ciphertext or are encrypted by the tool before leaving the host. The offsite provider sees ciphertext, sizes and timing, nothing else. The privacy box must not say "we never store anything" once offsite copies exist.
9. **Escrow.** Repository password, restore runbook and provider logins held by at least two people, in two places. A restore that needs one person's memory fails the bus-factor drill.
10. **Phone.** The recovery path is the encrypted blob plus the local pre-merge snapshots. Drill it with a synthetic persona on a fresh install.

## Restore drills

A backup counts only after a restore has been timed and checked. Four levels:

| Level | Cadence | What | Who |
|---|---|---|---|
| 0 automated | weekly | repository integrity check (sample of data), freshness of the newest snapshot per surface against its RPO, heartbeat seen | cron plus alert |
| 1 staging restore | **monthly** | restore the newest snapshot and one random older snapshot into the staging unit (`scripts/deploy_trustweb_backup.sh --staging`, own data directories, no public route), run the checks below, stop the unit again | operator |
| 2 host-loss rehearsal | **quarterly** | fresh VM at the second provider, install the code with the deploy script's staging flavour, restore from escrow only (no access to the old host), time it against the RTO | operator plus a second person |
| 3 people and device | yearly | the second person restores using only the runbook; a fresh phone install recovers a synthetic persona from its encrypted backup | two people |

**Synthetic data rule.** Drills use generated data only: the drill script writes a random canary (a random backup id, a canary connect code, a canary short link) before the backup run, and the drill looks for exactly that. No real person's data is used as test input, in the repo, in tests or in logs. A restore of a real production snapshot is allowed only on a host under the same controls as production, verified by checksums and counts, never by reading contents, and the restored copy is removed from the staging host when the drill ends.

**Pass criteria** (all must hold; a single miss is a failed drill):

- Restore finished within the surface's RTO; the elapsed time is recorded.
- The newest canary found in the restore is no older than the surface's RPO.
- Checksums of the restored files match the manifest written at backup time.
- The canary blob returns byte-identical from `GET`, and a `PUT` with the original write token still succeeds (slot ownership survived).
- The canary connect code answers with its redirect; the health route answers.
- No error or warning in the unit's log beyond the expected ones.

**A failed drill is an incident**: fix the cause, repeat the drill, and only then return to the normal cadence. A drill that was skipped is logged as skipped, not as passed.

### Drill log

Append one row per drill to a log kept next to the runbook (a private place, since it names hosts). Template:

| Date | Level | Snapshot ids restored | Elapsed vs RTO | Newest canary age vs RPO | Checksums | Result | Findings and fixes | Operator |
|---|---|---|---|---|---|---|---|---|
| (date) | 1 | (ids) | (time / target) | (age / target) | match / mismatch | pass / fail / skipped | (text) | (initials) |

## Open decisions

Everything above waits for the owner. Nothing here has been decided or built.

| # | Question | Lean |
|---|---|---|
| D-1 | restic or borg? | restic: simple, widely packaged; check the licence fit for the AGPL repo before adopting |
| D-2 | Which second provider (EU or CH, different entity)? | any S3-compatible or SFTP target with object lock or append-only; decide on price and jurisdiction |
| D-3 | Is 35 days retention acceptable, and does the privacy statement name it? | yes, and yes |
| D-4 | Back up hosted recordings at all, weekly? | yes weekly, because the allowance makes them user value; revisit if size grows |
| D-5 | Who are the two escrow holders? | owner plus one trusted operator |
| D-6 | Does the app upload its encrypted backup automatically, and how often? | needs a product decision; it sets the device RPO |
| D-7 | Follow-up code tasks: a tested `backupTo(path)` on the SQL driver, a drill script that writes and checks canaries, a backup freshness check | yes, one PR each, test first |

## What this plan does not cover

- Availability (uptime). One host means outages of hours; that is accepted at this stage.
- Leaks. That is the privacy design, not this document.
- The relay and Matrix paths in `packages/transport`. They are transport, not storage; messages in flight can be lost and re-sent by the protocol.
- Legal advice. GDPR and NIS2 references are pointers for the owner's own check.
