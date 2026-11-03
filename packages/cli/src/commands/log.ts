// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** `trustweb log`: the record's audit lines, oldest first (I6: every change, human-readable, local). */
import { UsageError } from '../args.ts'
import type { Command } from '../cli.ts'
import { table, when } from '../output.ts'

export const log: Command = {
  name: 'log',
  summary: 'Show what changed the record, oldest first',
  options: [{ name: 'limit', alias: 'n', kind: 'string', placeholder: '<count>', help: 'Only the last <count> lines' }],
  examples: ['trustweb log', 'trustweb log -n 5', 'trustweb log --json'],
  run(ctx) {
    const all = ctx.record().log
    const n = typeof ctx.options.limit === 'string' ? Number(ctx.options.limit) : all.length
    if (!Number.isInteger(n) || n < 0) throw new UsageError(`-n, --limit: "${String(ctx.options.limit)}" is not a count (0 or more)`)
    const lines = all.slice(Math.max(0, all.length - n))
    ctx.emit(lines, table(lines.map((l) => [when(l.at), l.by, l.command, l.text]), ['when', 'by', 'command', 'what']))
  },
}
