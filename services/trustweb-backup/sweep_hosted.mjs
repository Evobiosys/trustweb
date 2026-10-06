// Retention sweep for hosted recordings, run by hand or by the orchestrator (not a daemon).
//
//   HOSTED_DIR=/var/lib/trustweb-hosted node sweep_hosted.mjs            dry run (default): lists what would go
//   HOSTED_DIR=/var/lib/trustweb-hosted node sweep_hosted.mjs --apply    removes recordings untouched for HOSTED_RETENTION_DAYS (90)
//
// Prints one summary line per run and one line per removed (or would-be-removed) recording; no content, no tokens.

import { pathToFileURL } from 'node:url'
import { sweepHosted } from './hosted_store.mjs'

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.env.HOSTED_DIR
  if (!dir) {
    console.error('HOSTED_DIR is required')
    process.exit(1)
  }
  console.log('… sweep_hosted running …')
  console.log('--------')
  const apply = process.argv.includes('--apply')
  const report = await sweepHosted(dir, { retentionDays: Number(process.env.HOSTED_RETENTION_DAYS ?? 90), dryRun: !apply })
  for (const r of report.recordings) console.log(`${apply ? 'removed' : 'would remove'} recording ${r.account.slice(0, 8)}/${r.id.slice(0, 8)} ${r.bytes} bytes idle ${r.idleDays} days`)
  for (const a of report.accounts) console.log(`${apply ? 'removed' : 'would remove'} empty idle account ${a.account.slice(0, 8)}`)
  console.log('--------')
  console.log(`${apply ? 'APPLIED' : 'DRY RUN'}: ${report.recordings.length} recordings, ${report.accounts.length} accounts, ${report.freedBytes} bytes`)
}
