// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * `trustweb export`: the record as a file a person can keep, read or hand to another tool. Three shapes:
 *   json      the record's canonical bytes (what `import` reads back);
 *   jsonl     the relation store, one tuple per line, through the app's own toJsonl (facts only, or with --effective the
 *             store every check runs on: facts + unfolded tag rules + the scope tuples of the latest shares, at --now);
 *   markdown  the app's toMarkdown page per person and per live tag, on the effective store.
 * Export only reads: it never commits and writes no log line (nothing in the record changed).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { UsageError } from '../args.ts'
import { CommandError, type Command } from '../cli.ts'
import { serializeRecord, type TrustRecord } from '../record.ts'
import { activeZones, personIds, storeOf, toJsonl, toMarkdown } from '../sink.ts'

export const FORMATS = ['json', 'jsonl', 'markdown'] as const
export type Format = (typeof FORMATS)[number]

/** The bytes of one export. Markdown is always on the effective store: a page that ignored the tag rules would lie about who sees what. */
export function exportText(r: TrustRecord, format: Format, effective: boolean, now: Date): string {
  if (format === 'json') return serializeRecord(r)
  if (format === 'jsonl') return toJsonl(effective ? storeOf(r, now) : r.tuples)
  const store = storeOf(r, now)
  const active = activeZones(r)
  const liveTags = Object.keys(r.tags).filter((t) => r.tags[t].removedAt === undefined).map((t) => `tag:${t}`)
  const ids = [...personIds(r), ...liveTags].sort()
  return ids.map((id) => toMarkdown(store, id, now, active)).join('\n')
}

export const exportCommand: Command = {
  name: 'export',
  summary: 'Write the record, its relation store, or Markdown pages to stdout or a file',
  description: [
    'json (default): the record\'s canonical bytes; `trustweb import` reads them back. --json prints the same bytes.',
    'jsonl: the relation store as kept, one tuple per line (facts only). With --effective: the store every check runs on,',
    '  i.e. the facts, the tag rules unfolded per person and the scope tuples of the latest share per item. That depends',
    '  on the clock (a rule or membership that has not begun or has ended is not unfolded): pass --now to pin it.',
    'markdown: one page per known person and per live tag, in id order: zone, tags, what they can see and why.',
    '  Always on the effective store.',
    'Export only reads the record: nothing is changed and no log line is written.',
  ].join('\n'),
  options: [
    { name: 'format', kind: 'string', placeholder: '<json|jsonl|markdown>', help: 'What to write (default json)' },
    { name: 'effective', kind: 'flag', help: 'jsonl: the derived store at --now instead of the facts (implied for markdown)' },
    { name: 'out', kind: 'string', placeholder: '<file>', help: 'Write to this file instead of stdout (its directory is made)' },
    { name: 'force', kind: 'flag', help: 'With --out: overwrite a file that exists' },
  ],
  examples: [
    'trustweb export > web.json',
    'trustweb export --out backup/web.json',
    'trustweb export --format jsonl',
    'trustweb export --format jsonl --effective --now 2026-12-01',
    'trustweb export --format markdown --out pages.md',
  ],
  run(ctx) {
    const given = typeof ctx.options.format === 'string' ? ctx.options.format : 'json'
    if (!(FORMATS as readonly string[]).includes(given)) throw new UsageError(`--format: "${given}" is not one of ${FORMATS.join(', ')}`)
    const format = given as Format
    const effective = ctx.options.effective === true
    if (effective && format === 'json') throw new UsageError('--effective applies to --format jsonl (markdown is always effective); the json export is the record itself')
    const text = exportText(ctx.record(), format, effective || format === 'markdown', ctx.now)
    if (typeof ctx.options.out !== 'string') {
      // Straight to stdout in both modes: the record's own bytes are already JSON, and wrapping them would change them.
      ctx.io.stdout(text)
      return
    }
    const file = resolve(ctx.io.cwd, ctx.options.out)
    if (existsSync(file) && ctx.options.force !== true) throw new CommandError(`${file} already exists: choose another --out, or add --force to overwrite it`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
    const bytes = Buffer.byteLength(text)
    ctx.emit({ wrote: file, bytes, format, effective: effective || format === 'markdown' }, `wrote ${file} (${bytes} bytes)`)
  },
}
