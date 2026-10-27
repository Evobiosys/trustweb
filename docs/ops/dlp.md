# Data loss prevention: backup + restore-drill plan

Status: **proposal** (nothing below is deployed yet except the drill tool). Scope: the server in
`services/trustweb-backup` (`BACKUP_DIR`, default unit path `/var/lib/trustweb-backup`). Phones keep
their own data (I1); this plan protects what the server holds.

## 1. How comparable products prevent data loss

Source tiers: A = legal/gov/science, B = journal/analytic, C = vendor/community. Retrieved
2026-10-27 through a search tool; the first-party vendor pages themselves could **not** be fetched
from this sandbox. Treat every figure as **unverified until checked on the vendor page**. No
first-party document found for any of these four describes PITR, multi-region replication or
restore drills; where they do those things, they do not say so in public pages this search found.

| Product | What the search found | Tier | Gap for us to learn from |
|---|---|---|---|
| Notion | No first-party backup/PITR doc surfaced; a third-party comparison lists in-product retention as "7-90 days trash + history by plan". Third-party tools (Rewind, Plakar, SimpleBackups) sell snapshot/PITR backups, so the in-product retention is not treated as a backup. | C | Product history is not a backup you control. Keep an independent copy. |
| Linear | No first-party DR doc surfaced. Third parties (SimpleBackups, Cloudback) offer read-only API snapshots and recommend restoring into a throwaway workspace to test. | C | Restore to a *new* place, never over the original. |
| Obsidian Sync | Help/product pages (mirrors): end-to-end encryption with a user password (AES-256), version history (saved about every 10 s, notes only), restore of deleted files; Obsidian cannot recover a lost password. Independent audits reported (Cure53; Trail of Bits after the Aug 2025 encryption upgrade). | C (vendor) | Same trust shape as ours: ciphertext on the server, key with the person. A lost key is unrecoverable by design. |
| Tana | FAQ: JSON export exists, no automatic re-import yet; users ask for scheduled backups on the ideas board. | C | An export that cannot be restored is not a backup. |
| Generic practice | PITR protects against bad writes within a retention window, not against total loss; pair it with full copies. | B (Vinchin explainer) | Layer: versions + off-host copy + tested restore. |

Pattern across all of them: (1) short in-product history for "oops", (2) encryption where the
vendor cannot read content, (3) an independent copy, (4) restore tested somewhere other than
production. Multi-region replication is a hyperscaler feature; for a 2 GB single-host service it is
replaced by one off-host copy in a second EU location.

## 2. What TrustWeb holds, and what loses it

| Data | Where | Loss risk today |
|---|---|---|
| Encrypted backup blobs `TWB1` + token hash + ciphertext | `blobs/<id>.bin` | Overwritten by the next PUT (latest only); one disk, no copy. |
| Short links, connect codes + names, organizer accounts | `links.json`, `connect.json`, `organizers.json` (atomic rewrite, 0600) | Disk loss; a bad write replaces the previous file. |
| Hosted recordings (ciphertext) | `HOSTED_DIR`, 90-day sweeper | Disk loss; deliberately expiring, so **not** in the offsite set. |
| Feedback lines, admin token, API keys | `FEEDBACK_FILE`, `/etc/trustweb/*` | Out of scope here; keys are re-issued, not restored from backup. |

The server cannot decrypt blobs, so a server restore returns ciphertext; **the person's key stays
their only way in** (I1). Say so in any user-facing text.

## 3. Plan

Targets (proposed, to be accepted or changed by the owner): RPO 24 h, RTO 4 h, copies kept:
7 daily + 4 weekly + 6 monthly.

1. **Snapshot** daily from a systemd timer: `restore_drill.mjs snapshot` copies `blobs/*.bin` and the
   JSON stores (never `tmp/`) into a fresh dated directory with `MANIFEST.json` (sha256 + size per
   file). The stores are written atomically (temp file + rename), so a copy sees the old or the new file, never a torn one.
2. **Encrypt, then ship off-host** to a second EU location. Blobs are already ciphertext, but the
   JSON stores hold stored connect URLs and hashes, so encrypt the whole snapshot (age or gpg,
   recipient key held by the owner offline) before it leaves the host.
3. **Retention** by pruning old snapshot directories by an *archive* step (move to `archive/`), not
   deletion, until the owner approves a purge.
4. **Monthly restore drill** (section 4), result appended to `DEVLOG/` and to the PR/issue log.
5. **Alert** when the newest snapshot is older than 36 h or `verify` fails.

Unverified assumptions to confirm on the host: free disk for 7+ snapshots (server has 2 GB RAM;
disk not measured), SELinux label for the snapshot directory (`var_lib_t` like production).

## 4. Restore drill (tool: `services/trustweb-backup/restore_drill.mjs`)

```sh
node restore_drill.mjs drill /var/lib/trustweb-backup /var/tmp/drill-$(date +%F)   # ok:true, problems:[]
node restore_drill.mjs verify <snapshot-dir>             # re-hash + header + JSON checks
node restore_drill.mjs restore <snapshot-dir> <empty-dir> # refuses a non-empty target
```

Pass criteria: `ok: true`; a throwaway server (`BACKUP_DIR=<restored>`, loopback, other port)
returns the same ciphertext for a canary id; `restoreMs` recorded against the RTO. Never restore
over the live directory: restore beside it, then swap by an operator after the drill passes.
The automated test (`test/restore_drill.test.mjs`) does this end to end with synthetic data.

Quarterly, add a full-host rehearsal from the off-host copy on a fresh machine with only the
owner's offline key, to prove nothing lives only on the old host.

## 5. Honest limits (I7)

- Snapshots are periodic, so up to RPO of recent writes can be lost; there is no continuous PITR.
- Backup blobs keep only the latest version per id; older versions exist only inside snapshots.
- This does not recover a lost user key or a lost owner offline key.
- Not yet implemented: timer, encryption/ship step, retention archiving, alerting.
