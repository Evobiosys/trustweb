// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * `trustweb import <file>`: a record file (what `trustweb export` writes) brought into this place.
 *   - no record here yet: the file becomes the record (canonical bytes, its log kept, one line added for the import);
 *   - a record here: the person chooses. --replace swaps it for the file's record (one log line says whose it replaced).
 *     --merge keeps ours and adds what is missing: zones, persons and tags by id (ours win, a removal here stays), tuples
 *     not already here (closing wins, see mergeRecord), share lines newer than ours about the same item, renumbered to
 *     follow ours, the two logs in time order. Our device stays.
 * The file is validated in full before anything is written (record.parseRecord, the share sink's tuple check inside).
 * Nothing is ever deleted from our record by a merge, and nothing closed, removed or revoked here comes back through one;
 * a replace is the one deliberate exception, and it is logged.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { UsageError } from '../args.ts'
import { CommandError, type Command } from '../cli.ts'
import { RecordError, parseRecord, recordPathIn, type LogEntry, type TrustRecord } from '../record.ts'
import { count, table } from '../output.ts'
import { MAX_DEPTH, ancestors, depthOf, type ShareLine, type Tuple } from '../sink.ts'

const PARTS = ['zones', 'persons', 'tags', 'tuples', 'shares'] as const
type Part = (typeof PARTS)[number]
export type Counts = Record<Part, number>

export interface ImportSummary {
  file: string
  record: string
  mode: 'new' | 'replace' | 'merge'
  dryRun: boolean
  added: Counts
  /** Already here (merge only): kept as ours, not added again. */
  skipped: Counts
  /** Merge only: tuples of ours the other record had closed (their `until` taken over). */
  closed?: number
  /** Merge only: share lines of theirs older than our latest line about the same item, left out. */
  superseded?: number
  /** For replace: the device whose record was replaced. */
  replaced?: string
}

const zero = (): Counts => ({ zones: 0, persons: 0, tags: 0, tuples: 0, shares: 0 })
const sizes = (r: TrustRecord): Counts =>
  ({ zones: Object.keys(r.zones).length, persons: Object.keys(r.persons).length, tags: Object.keys(r.tags).length, tuples: r.tuples.length, shares: r.shares.length })

const TUPLE_KEYS = ['subject', 'relation', 'object', 'zone', 'tag', 'since', 'by'] as const
/**
 * A tuple's identity: every field but `until`, in a fixed order. The same fact opened on one device and closed on another
 * is one tuple with two states; the merge keeps the closed one (the earlier `until`), so a closure is never undone.
 */
const tupleKey = (t: Tuple): string => JSON.stringify(TUPLE_KEYS.map((k) => t[k] ?? null))
const earlier = (a: string | undefined, b: string | undefined): string | undefined =>
  a === undefined ? b : b === undefined ? a : Date.parse(a) <= Date.parse(b) ? a : b
/** A share line's identity without its position (seq, and the cutoff/at that follow seq): the same event in either record. */
const shareKey = (l: ShareLine): string => {
  const rest: Record<string, unknown> = { ...l }
  delete rest.seq
  delete rest.cutoff
  delete rest.at
  return JSON.stringify(Object.keys(rest).sort().map((k) => [k, rest[k]]))
}
const logKey = (l: LogEntry): string => JSON.stringify([l.at, l.by, l.command, l.text])

/** Keyed entries (zones, persons, tags): theirs added where ours has no entry; ours always kept as they are. */
function mergeEntries<T>(ours: Record<string, T>, theirs: Record<string, T>): { added: number; skipped: number } {
  let added = 0
  let skipped = 0
  for (const [id, e] of Object.entries(theirs)) {
    if (id in ours) skipped++
    else { ours[id] = e; added++ }
  }
  return { added, skipped }
}

/** The item a share line is about. */
const itemOf = (l: ShareLine): string => (l.op === 'share' ? l.id : l.op === 'agree' ? l.agreement : l.target)

export interface MergeResult {
  added: Counts
  skipped: Counts
  /** Tuples of ours that the other record had already closed (or closed earlier): their `until` was taken over. */
  closed: number
  /** Share lines of theirs older than our latest line about the same item: left out, ours stands. */
  superseded: number
  logLines: number
}

/**
 * Merges `theirs` into `ours` in place. Nothing of ours is lost, and nothing closed, removed or revoked here comes back:
 *   - a tuple is the same fact on both sides whatever its `until`; the earlier `until` wins (closing wins);
 *   - a merged tuple that names a person or tag removed here is closed at that removal;
 *   - a share line of theirs older than our latest line about the same item is superseded (left out); a newer one is
 *     appended after ours with seq renumbered and its cutoff (share, agree) or at (revoke) moved by the same amount,
 *     so a one-off share still shows exactly the lines it showed before;
 *   - the nested tags must still form a DAG no deeper than the share sink allows, else the whole merge is refused.
 */
export function mergeRecord(ours: TrustRecord, theirs: TrustRecord, now: Date): MergeResult {
  const added = zero()
  const skipped = zero()
  for (const part of ['zones', 'persons', 'tags'] as const) {
    const m = mergeEntries(ours[part] as Record<string, unknown>, theirs[part] as Record<string, unknown>)
    added[part] = m.added
    skipped[part] = m.skipped
  }
  const removedAt = (id: string): string | undefined => {
    const bare = id.slice(id.indexOf(':') + 1)
    return id.startsWith('person:') ? ours.persons[bare]?.removedAt : id.startsWith('tag:') ? ours.tags[bare]?.removedAt : undefined
  }
  const byKey = new Map(ours.tuples.map((t, i) => [tupleKey(t), i]))
  let closed = 0
  for (const t of theirs.tuples) {
    const k = tupleKey(t)
    const i = byKey.get(k)
    if (i !== undefined) {
      const mine = ours.tuples[i]
      const until = earlier(mine.until, t.until)
      if (until !== mine.until) { ours.tuples[i] = { ...mine, until }; closed++ } else skipped.tuples++
      continue
    }
    const end = earlier(t.until, earlier(removedAt(t.subject), removedAt(t.object)))
    const kept: Tuple = end === undefined ? { ...t } : { ...t, until: end }
    delete (kept as { until?: string }).until
    if (end !== undefined) kept.until = end
    byKey.set(k, ours.tuples.length)
    ours.tuples.push(kept)
    added.tuples++
  }
  // Our latest word on each item, before the merge: a line of theirs older than that is superseded. Their own lines keep
  // their order among themselves (a share and its revoke at the same moment both come over).
  const latestTs = new Map<string, number>()
  for (const l of ours.shares) latestTs.set(itemOf(l), Math.max(latestTs.get(itemOf(l)) ?? 0, Date.parse(l.ts)))
  const shares = new Set(ours.shares.map(shareKey))
  let superseded = 0
  for (const l of theirs.shares) {
    const k = shareKey(l)
    if (shares.has(k)) { skipped.shares++; continue }
    if (Date.parse(l.ts) < (latestTs.get(itemOf(l)) ?? -Infinity)) { superseded++; continue }
    shares.add(k)
    const seq = ours.shares.length + 1
    const shift = seq - l.seq
    const moved: ShareLine = l.op === 'share' || l.op === 'agree' ? { ...l, seq, cutoff: l.cutoff + shift } : l.op === 'revoke' ? { ...l, seq, at: l.at + shift } : { ...l, seq }
    ours.shares.push(moved)
    added.shares++
  }
  checkNesting(ours.tuples.filter((t) => t.until === undefined || Date.parse(t.until) > +now))
  const logs = new Set(ours.log.map(logKey))
  const fresh = theirs.log.filter((l) => !logs.has(logKey(l)))
  // A stable sort: lines at the same moment keep ours first, each record's own order kept.
  ours.log = [...ours.log, ...fresh].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  return { added, skipped, closed, superseded, logLines: fresh.length }
}

/** The merged nestings must be what `tag nest` would have written one by one: a DAG, at most MAX_DEPTH deep. */
function checkNesting(store: readonly Tuple[]): void {
  for (const t of store) {
    if (t.relation !== 'nested_in') continue
    if (t.subject === t.object || ancestors(store, t.object).has(t.subject)) throw new CommandError(`the merge would nest ${t.subject} under ${t.object} in a cycle; nothing was imported`)
    if (depthOf(store, t.subject) > MAX_DEPTH) throw new CommandError(`the merge would nest tags deeper than ${MAX_DEPTH} levels (${t.subject}); nothing was imported`)
  }
}

const SINGULAR: Record<Part, string> = { zones: 'zone', persons: 'person', tags: 'tag', tuples: 'tuple', shares: 'share' }
const plusList = (c: Counts): string => PARTS.filter((p) => c[p] > 0).map((p) => `+${count(c[p], SINGULAR[p])}`).join(', ')

function readImport(file: string, cwd: string): TrustRecord {
  let text: string
  try {
    text = readFileSync(resolve(cwd, file), 'utf8')
  } catch {
    throw new CommandError(`cannot read ${file}: no such file, or not readable`)
  }
  try {
    return parseRecord(text)
  } catch (e) {
    if (e instanceof RecordError) throw new RecordError(`${file}: ${e.message}; nothing was imported`)
    throw e
  }
}

export const importCommand: Command = {
  name: 'import',
  summary: 'Bring a record file in: as the record here, over it (--replace), or into it (--merge)',
  description: [
    'The file is a record as `trustweb export` writes it; it is checked in full first, and a bad file changes nothing.',
    'No record here yet: the file becomes the record (to ./.trustweb/record.json, or --record), in canonical bytes,',
    'its log kept and one line added for the import.',
    'A record here: choose.',
    '  --replace  the file\'s record takes its place; one log line names the device whose record it replaced.',
    '  --merge    ours stays and gains what it lacks: zones, persons and tags by id (ours win; a removal here stays),',
    '             tuples not already here (the same fact closed on either side stays closed; a fact naming a person or',
    '             tag removed here is closed at that removal), share lines newer than our latest line about the same',
    '             item (after ours, seq renumbered, cutoff/at moved with it; older ones are superseded), the two logs in',
    '             time order. Nested tags must stay a DAG, else nothing is imported. The device stays ours.',
    '             Merging the same file twice adds nothing.',
    '--dry-run prints the summary and writes nothing.',
  ].join('\n'),
  positionals: [{ name: 'file', help: 'The record file to import (e.g. one `trustweb export --out` wrote)' }],
  options: [
    { name: 'replace', kind: 'flag', help: 'Replace the record here with the file\'s' },
    { name: 'merge', kind: 'flag', help: 'Add what the file has and this record lacks' },
    { name: 'dry-run', kind: 'flag', help: 'Say what would happen; write nothing' },
  ],
  examples: [
    'trustweb import web.json',
    'trustweb import phone.json --merge --dry-run',
    'trustweb import phone.json --merge',
    'trustweb import backup/web.json --replace',
  ],
  run(ctx) {
    const file = ctx.positionals[0]
    const replace = ctx.options.replace === true
    const merge = ctx.options.merge === true
    const dryRun = ctx.options['dry-run'] === true
    if (replace && merge) throw new UsageError('--replace and --merge exclude each other: choose one')
    const theirs = readImport(file, ctx.io.cwd)
    const found = ctx.recordPath()
    const target = found ?? recordPathIn(ctx.io.cwd)
    const here = existsSync(target)
    const summary: ImportSummary = { file, record: target, mode: 'new', dryRun, added: zero(), skipped: zero() }
    const head = (what: string): string => `${dryRun ? 'dry run: would import' : 'imported'} ${file} ${what}`

    if (!here) {
      summary.added = sizes(theirs)
      // The file becomes the record here, in canonical bytes, with one line of its own saying so (I6).
      if (!dryRun) ctx.commit(theirs, `imported ${file} as the record here (from ${theirs.device})`, target)
      ctx.emit(summary, [head(`as a new record at ${target}`), ...counts(summary)])
      return
    }
    if (!replace && !merge) {
      throw new CommandError(`a record already exists at ${target}: add --merge to add what ${file} has to it, or --replace to swap it for ${file} (--dry-run shows what either would do)`)
    }
    const ours = ctx.record()
    if (replace) {
      summary.mode = 'replace'
      summary.replaced = ours.device
      summary.added = sizes(theirs)
      if (!dryRun) ctx.commit(theirs, `imported ${file}, replacing the record of ${ours.device}`, target)
      ctx.emit(summary, [head(`replacing the record of ${ours.device} at ${target}`), ...counts(summary)])
      return
    }
    summary.mode = 'merge'
    const m = mergeRecord(ours, theirs, ctx.now)
    summary.added = m.added
    summary.skipped = m.skipped
    summary.closed = m.closed
    summary.superseded = m.superseded
    const changed = PARTS.some((p) => m.added[p] > 0) || m.closed > 0 || m.logLines > 0
    if (!changed) {
      ctx.emit(summary, [`${file}: nothing new; the record at ${target} already holds all of it`, ...counts(summary)])
      return
    }
    const parts = [plusList(m.added), m.closed ? `${count(m.closed, 'tuple')} closed` : '', m.superseded ? `${count(m.superseded, 'share line')} superseded` : ''].filter(Boolean)
    const what = parts.join(', ') || `${count(m.logLines, 'log line')} only`
    if (!dryRun) ctx.commit(ours, `imported ${file} (merge): ${what}`, target)
    ctx.emit(summary, [head(`(merge) into ${target}: ${what}`), ...counts(summary)])
  },
}

/** The summary table: one row per part, added and (for a merge) already here. */
function counts(s: ImportSummary): string[] {
  return table(PARTS.map((p) => [`  ${p}`, `+${s.added[p]}`, s.mode === 'merge' && s.skipped[p] > 0 ? `(${s.skipped[p]} already here)` : '']))
}
