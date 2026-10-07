/**
 * The personal inventory exporter's logic (pure, no I/O except through the
 * injected Tana reader). The CLI around it is scripts/trustweb_inventory_export.ts.
 *
 * The rule (Jakob, 2026-10-06): "permissions set in advance, and nothing
 * personal goes there until you decide". So a line may leave this Mac for the
 * personal front door ONLY when Jakob marked it explicitly, in one of three
 * places:
 *   1. the choices file of the Kimi review page (kimi-ticked.json): a ticked
 *      line with "Allow in advance";
 *   2. Tana: a child node "allowed in advance" or "allowed in advance: <note>"
 *      under an inventory node;
 *   3. the Mac folder: a line that starts with "+ " in a regular .txt file (nothing else in the folder is read).
 * Everything else stays on the Mac (the full local file and the phone import
 * file). A marked line that carries something identifying (a Tana node id or
 * link, a DID, a timestamp finer than a day) stays too: the review file says
 * why. The server file never carries a node id, a DID or a fine timestamp.
 *
 * Four outputs, built here, written by the CLI:
 *   (a) full local file   every line, with its source and verdict (Mac only)
 *   (b) server file       the leaving lines only, as the peer reads them
 *   (c) review file       for Jakob: what WOULD leave, what stays, and why
 *   (d) import file       every line, for Jakob's OWN phone ("Only me")
 */
import { createHash } from 'node:crypto'
import { presetContext } from './peer'

/** The exporter cuts a line at this many characters, well inside what the peer reads (peer.ts INVENTORY_LINE_MAX is 400). */
export const LINE_MAX = 160
const NOTE_MAX = 120
const GROUP_NAME_RE = /^[a-z][a-z ]{0,30}$/
const KNOWN_GROUPS = new Set(['resources', 'tools', 'choices', 'offers', 'projects'])
/** Exactly "allowed in advance", or "allowed in advance: <note>". Nothing looser: "allowed in advance? ask first" is no mark. */
const MARK_RE = /^allowed in advance(?:\s*:\s*(.*))?$/i
const PLUS_RE = /^\+\s+(.+)$/
const BULLET_RE = /^(?:[-*]\s+)?(.+)$/
export const IMPORT_FORMAT = 'trustweb-inventory-import'
export const IMPORT_VERSION = 1

export enum LineSource {
  TanaReferenced = 'tana-referenced',
  TanaInbox = 'tana-inbox',
  KimiReview = 'kimi-review',
  MacFolder = 'mac-folder',
}

export enum MarkKind {
  /** "Allow in advance" ticked on the Kimi review page. */
  KimiChoice = 'kimi-choice',
  /** A Tana child "allowed in advance[: note]". */
  TanaChild = 'tana-child',
  /** A "+ " line in the Mac folder. */
  MacPlus = 'mac-plus',
}

export enum Verdict {
  /** Marked by Jakob and clean: goes into the server file. */
  Leaves = 'leaves',
  /** No explicit mark: stays on the Mac (and on his phone, via the import file). */
  StaysUnmarked = 'stays-unmarked',
  /** Marked, but the text carries an identifier or a fine timestamp: stays. */
  StaysIdentifying = 'stays-identifying',
}

export enum Provenance {
  Tana = 'tana',
  Mac = 'mac',
}

export interface Mark {
  kind: MarkKind
  note?: string
}

/** One line as a source produced it, before merging. */
export interface Candidate {
  text: string
  source: LineSource
  /** The inventory group ("tools", "offers", ...), "inbox", a Kimi candidate title or a file name. */
  category: string
  tanaNodeId?: string
  mark?: Mark
}

export interface ExportLine {
  key: string
  text: string
  category: string
  sources: LineSource[]
  tanaNodeIds: string[]
  mark?: Mark
  verdict: Verdict
  /** Why, in plain words, for the review file. */
  reason: string
}

export interface ExportOptions {
  /** ISO day (YYYY-MM-DD) the preset carries: never finer than a day. */
  today: string
  /** Who allowed it (the asker sees "Allowed in advance by <by>"). */
  by: string
  /** Every Tana node id read in this run: a line containing one never leaves. */
  knownIds: ReadonlySet<string>
}

export interface ServerItem {
  text: string
  audience: 'fof'
  preset: { by: string; at: string; note?: string }
}

export interface ServerFile {
  items: ServerItem[]
}

export interface ImportItem {
  /** Stable across exports (sha256 of the normalised text, 16 hex): re-importing is idempotent. */
  key: string
  text: string
  audience: 'me'
  provenance: Provenance
  /** Jakob marked it "allowed in advance" (the same line is in the front door's file once sent). */
  allowedInAdvance: boolean
}

export interface ImportFile {
  format: typeof IMPORT_FORMAT
  version: typeof IMPORT_VERSION
  /** ISO day only. */
  exportedOn: string
  items: ImportItem[]
}

// ---------------------------------------------------------------------------
// text hygiene
// ---------------------------------------------------------------------------

/** Removes inline markup (Tana inline references are HTML spans carrying node ids), collapses whitespace. */
export function cleanText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Lower-cased, whitespace-collapsed: two sources naming the same line merge. */
export function normalise(text: string): string {
  return cleanText(text).toLowerCase()
}

export function lineKey(text: string): string {
  return createHash('sha256').update(normalise(text)).digest('hex').slice(0, 16)
}

/**
 * Identifiers and fine timestamps, each matched as the WHOLE token, so the
 * same patterns both detect (identifyingReason) and replace (scrubText):
 * a DID with its body, a Tana link or node reference with its id, a
 * date-time in ISO or the Austrian/German form (6.10.2026 14:30), an epoch.
 */
const IDENTIFIER_PATTERNS: readonly RegExp[] = [
  /\bdid:[a-z0-9]+:[^\s"'<>)\]]*/gi,
  /\bhttps?:\/\/[^\s"'<>]*tana\.inc[^\s"'<>]*/gi,
  /\bapp\.tana\.inc[^\s"'<>]*/gi,
  /\btana:[A-Za-z0-9_-]+/gi,
  /\bnode-?id\s*[=:]\s*[A-Za-z0-9_-]*/gi,
  /\[\[[^\]]*\^[A-Za-z0-9_-]+\]\]/g,
  /\b\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g,
  /\b\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4},?\s+(?:um\s+)?\d{1,2}[:.]\d{2}\b/gi,
  /\b\d{10,13}\b/g,
]

/** Why a text may not leave this Mac, or null when it is clean. */
export function identifyingReason(text: string, knownIds: ReadonlySet<string>): string | null {
  for (const id of knownIds) if (id && text.includes(id)) return 'it contains a Tana node id'
  for (const re of IDENTIFIER_PATTERNS) {
    re.lastIndex = 0
    if (re.test(text)) return 'it contains an identifier or a timestamp finer than a day'
  }
  return null
}

/** For the phone import file: every identifier replaced as a whole token, the rest of the line kept. */
export function scrubText(text: string, knownIds: ReadonlySet<string>): string {
  let out = text
  for (const id of knownIds) if (id) out = out.split(id).join('[link]')
  for (const re of IDENTIFIER_PATTERNS) out = out.replace(re, '[link]')
  return out
}

function capLine(text: string): string {
  return text.length <= LINE_MAX ? text : text.slice(0, LINE_MAX - 1).trimEnd() + '…'
}

/** "Title" or "Title: first line", capped at what the peer keeps. */
export function lineFrom(title: string, firstLine?: string): string {
  const t = cleanText(title)
  const f = firstLine ? cleanText(firstLine) : ''
  return capLine(f && f.toLowerCase() !== t.toLowerCase() ? `${t}: ${f}` : t)
}

// ---------------------------------------------------------------------------
// marks
// ---------------------------------------------------------------------------

/** A Tana child "allowed in advance" / "Allowed in advance: for neighbours" -> the mark; anything else -> null. */
export function parseTanaMark(childName: string): Mark | null {
  const m = MARK_RE.exec(cleanText(childName))
  if (!m) return null
  const note = (m[1] ?? '').trim().slice(0, NOTE_MAX)
  return { kind: MarkKind.TanaChild, ...(note ? { note } : {}) }
}

/** The Mac folder's line syntax: "+ text" marked, "- text" / "* text" / "text" unmarked, "#..." and blank skipped. */
export function parseFolderLine(raw: string, file: string): Candidate | null {
  const line = raw.trim()
  if (!line || line.startsWith('#')) return null
  const plus = PLUS_RE.exec(line)
  const text = cleanText(plus ? plus[1] : (BULLET_RE.exec(line)?.[1] ?? ''))
  if (!text) return null
  return { text: capLine(text), source: LineSource.MacFolder, category: file, ...(plus ? { mark: { kind: MarkKind.MacPlus } } : {}) }
}

/** kimi-ticked.json from the review page: {items:[{candidate, tanaNodeId?, line, toTana, allowInAdvance}]}. Malformed rows are skipped. */
export function parseChoices(raw: unknown): Candidate[] {
  const items = typeof raw === 'object' && raw !== null ? (raw as { items?: unknown }).items : undefined
  if (!Array.isArray(items)) throw new Error('choices file: no items array')
  const out: Candidate[] = []
  for (const it of items) {
    if (typeof it !== 'object' || it === null) continue
    const o = it as Record<string, unknown>
    if (o.toTana !== true || typeof o.line !== 'string') continue
    const text = cleanText(o.line)
    if (!text) continue
    out.push({
      text: capLine(text),
      source: LineSource.KimiReview,
      category: typeof o.candidate === 'string' ? cleanText(o.candidate).slice(0, 80) : 'Kimi review',
      ...(typeof o.tanaNodeId === 'string' && o.tanaNodeId ? { tanaNodeId: o.tanaNodeId } : {}),
      ...(o.allowInAdvance === true ? { mark: { kind: MarkKind.KimiChoice } } : {}),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Tana (read-only, one hop)
// ---------------------------------------------------------------------------

/** The only Tana tools this exporter may call. Nothing that writes is reachable from here. */
export enum TanaReadTool {
  GetChildren = 'get_children',
}

export type TanaCall = (tool: TanaReadTool, args: Record<string, unknown>) => Promise<unknown>

export interface TanaNode {
  id: string
  name: string
  description?: string
  childCount: number
}

export interface TanaRead {
  candidates: Candidate[]
  /** Containers and inventory nodes whose content was read (for the #ai-ingested pass). */
  readIds: string[]
  /** Every node id seen, children included: a line containing one never leaves. */
  seenIds: Set<string>
}

function asTanaNodes(raw: unknown): { nodes: TanaNode[]; received: number; hasMore: boolean } {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as { children?: unknown; hasMore?: unknown }
  const list = Array.isArray(o.children) ? o.children : []
  const nodes: TanaNode[] = []
  for (const c of list) {
    if (typeof c !== 'object' || c === null) continue
    const r = c as Record<string, unknown>
    if (typeof r.id !== 'string' || typeof r.name !== 'string' || r.inTrash === true) continue
    nodes.push({
      id: r.id,
      name: r.name,
      ...(typeof r.description === 'string' && r.description.trim() ? { description: r.description } : {}),
      childCount: typeof r.childCount === 'number' ? r.childCount : 0,
    })
  }
  return { nodes, received: list.length, hasMore: o.hasMore === true }
}

const PAGE = 200

export async function tanaChildren(call: TanaCall, nodeId: string): Promise<TanaNode[]> {
  const out: TanaNode[] = []
  // Advance by what the page held (trash included), not by the limit: a server may return fewer than asked.
  for (let offset = 0; ; ) {
    const { nodes, received, hasMore } = asTanaNodes(await call(TanaReadTool.GetChildren, { nodeId, limit: PAGE, offset }))
    out.push(...nodes)
    if (!hasMore || received === 0) return out
    offset += received
  }
}

function isGroup(n: TanaNode): boolean {
  const name = n.name.trim()
  return n.childCount > 0 && (KNOWN_GROUPS.has(name.toLowerCase()) || GROUP_NAME_RE.test(name))
}

/** One inventory node -> one line: its title, then its description or first plain child; a mark child marks it. */
async function readItem(call: TanaCall, node: TanaNode, source: LineSource, category: string, seen: Set<string>): Promise<Candidate | null> {
  const title = cleanText(node.name)
  if (!title) return null
  let first = node.description
  let mark: Mark | null = null
  if (node.childCount > 0) {
    for (const c of await tanaChildren(call, node.id)) {
      seen.add(c.id)
      const m = parseTanaMark(c.name)
      if (m) { mark ??= m; continue }
      if (!first && cleanText(c.name)) first = c.name
    }
  }
  return { text: lineFrom(title, first), source, category, tanaNodeId: node.id, ...(mark ? { mark } : {}) }
}

/** Reads the inventory node: "referenced" (groups one level, then items) and "inbox"; one hop into each item. */
export async function readTanaInventory(call: TanaCall, rootId: string): Promise<TanaRead> {
  const seen = new Set<string>([rootId])
  const readIds: string[] = [rootId]
  const candidates: Candidate[] = []
  const top = await tanaChildren(call, rootId)
  for (const n of top) seen.add(n.id)
  const section = (name: string): TanaNode | undefined => top.find((n) => n.name.trim().toLowerCase() === name)
  const visit = async (node: TanaNode, source: LineSource, category: string): Promise<void> => {
    readIds.push(node.id)
    const c = await readItem(call, node, source, category, seen)
    if (c) candidates.push(c)
  }
  const referenced = section('referenced')
  if (referenced) {
    readIds.push(referenced.id)
    for (const n of await tanaChildren(call, referenced.id)) {
      seen.add(n.id)
      if (!isGroup(n)) { await visit(n, LineSource.TanaReferenced, 'referenced'); continue }
      readIds.push(n.id)
      for (const item of await tanaChildren(call, n.id)) {
        seen.add(item.id)
        await visit(item, LineSource.TanaReferenced, n.name.trim().toLowerCase())
      }
    }
  }
  const inbox = section('inbox')
  if (inbox) {
    readIds.push(inbox.id)
    for (const n of await tanaChildren(call, inbox.id)) {
      seen.add(n.id)
      await visit(n, LineSource.TanaInbox, 'inbox')
    }
  }
  return { candidates, readIds: [...new Set(readIds)], seenIds: seen }
}

// ---------------------------------------------------------------------------
// merge, decide, render
// ---------------------------------------------------------------------------

/** Exactly what an asker would see as the line's context (the peer's own presetContext): the review and the send confirmation print this. */
export function wireContext(by: string, day: string, note?: string): string {
  return presetContext({ by, at: day, ...(note ? { note } : {}) })
}

const MARK_WHY: Record<MarkKind, string> = {
  [MarkKind.KimiChoice]: 'you ticked "Allow in advance" on the review page',
  [MarkKind.TanaChild]: 'a Tana child "allowed in advance" under it',
  [MarkKind.MacPlus]: 'a "+ " line in your Mac folder',
}

/** Merges duplicates (same normalised text), keeps the first explicit mark, decides each line. */
export function buildExport(candidates: readonly Candidate[], opts: ExportOptions): ExportLine[] {
  const byKey = new Map<string, ExportLine>()
  for (const c of candidates) {
    const text = cleanText(c.text)
    if (!text) continue
    const key = lineKey(text)
    const line = byKey.get(key) ?? { key, text, category: c.category, sources: [], tanaNodeIds: [], verdict: Verdict.StaysUnmarked, reason: '' }
    if (!line.sources.includes(c.source)) line.sources.push(c.source)
    if (c.tanaNodeId && !line.tanaNodeIds.includes(c.tanaNodeId)) line.tanaNodeIds.push(c.tanaNodeId)
    if (c.mark && !line.mark) line.mark = c.mark
    byKey.set(key, line)
  }
  const ids = new Set(opts.knownIds)
  for (const l of byKey.values()) for (const id of l.tanaNodeIds) ids.add(id)
  for (const l of byKey.values()) {
    if (!l.mark) { l.verdict = Verdict.StaysUnmarked; l.reason = 'not marked "allowed in advance" by you'; continue }
    const bad = identifyingReason(l.text, ids)
    if (bad) { l.verdict = Verdict.StaysIdentifying; l.reason = `marked by you, but ${bad}`; continue }
    l.verdict = Verdict.Leaves
    l.reason = MARK_WHY[l.mark.kind]
  }
  return [...byKey.values()]
}

export function serverFile(lines: readonly ExportLine[], opts: Pick<ExportOptions, 'today' | 'by'>): ServerFile {
  const at = opts.today.slice(0, 10)
  return {
    items: lines
      .filter((l) => l.verdict === Verdict.Leaves && l.mark)
      .map((l) => ({ text: l.text, audience: 'fof' as const, preset: { by: opts.by, at, ...(l.mark?.note ? { note: l.mark.note } : {}) } })),
  }
}

/**
 * Defence in depth before anything is sent: every server item is a marked,
 * clean line of this export, nothing more, and carries no identifier.
 * Throws with the reason; returns the item count.
 */
export function assertServerFileSafe(file: ServerFile, lines: readonly ExportLine[], knownIds: ReadonlySet<string>): number {
  const leaving = new Set(lines.filter((l) => l.verdict === Verdict.Leaves && l.mark).map((l) => l.text))
  const raw = JSON.stringify(file)
  for (const id of knownIds) if (id && raw.includes(id)) throw new Error('server file contains a Tana node id')
  if (/did:[a-z0-9]+:/i.test(raw)) throw new Error('server file contains a DID')
  for (const it of file.items) {
    if (Object.keys(it).sort().join(',') !== 'audience,preset,text' || it.audience !== 'fof') throw new Error('server file holds an item with unexpected fields')
    if (!leaving.has(it.text)) throw new Error('server file holds a line that is not marked')
    if (!it.preset || !/^\d{4}-\d{2}-\d{2}$/.test(it.preset.at)) throw new Error('server file holds a line without a day-only preset')
    if (Object.keys(it.preset).some((k) => k !== 'by' && k !== 'at' && k !== 'note')) throw new Error('server file holds a preset with unexpected fields')
    for (const t of [it.text, it.preset.by, it.preset.note ?? '']) if (identifyingReason(t, knownIds)) throw new Error('server file holds an identifying line')
  }
  const keys = Object.keys(file).sort().join(',')
  if (keys !== 'items') throw new Error('server file has unexpected fields: ' + keys)
  return file.items.length
}

export function importFile(lines: readonly ExportLine[], opts: Pick<ExportOptions, 'today' | 'knownIds'>): ImportFile {
  const ids = new Set(opts.knownIds)
  for (const l of lines) for (const id of l.tanaNodeIds) ids.add(id)
  return {
    format: IMPORT_FORMAT,
    version: IMPORT_VERSION,
    exportedOn: opts.today.slice(0, 10),
    items: lines.map((l) => ({
      key: l.key,
      text: scrubText(l.text, ids),
      audience: 'me' as const,
      provenance: l.sources.every((s) => s === LineSource.MacFolder) ? Provenance.Mac : Provenance.Tana,
      allowedInAdvance: Boolean(l.mark),
    })),
  }
}

export interface FullFile {
  _note: string
  exportedOn: string
  /** Tana containers and inventory nodes this run read (for the #ai-ingested pass). */
  tanaNodesRead: string[]
  items: Array<{
    text: string
    audience: 'fof' | 'me'
    preset?: ServerItem['preset']
    category: string
    sources: LineSource[]
    tanaNodeIds: string[]
    verdict: Verdict
    reason: string
  }>
}

/** The Mac-only full file: the peer's {items} shape plus where each line came from and why it stays or leaves. */
export function fullFile(lines: readonly ExportLine[], opts: Pick<ExportOptions, 'today' | 'by'>, tanaNodesRead: readonly string[] = []): FullFile {
  const server = new Map(serverFile(lines, opts).items.map((i) => [i.text, i.preset]))
  return {
    _note: 'Mac only. Every line of the personal inventory export with its source and verdict. Never copy this file to a server.',
    exportedOn: opts.today.slice(0, 10),
    tanaNodesRead: [...tanaNodesRead],
    items: lines.map((l) => ({
      text: l.text,
      audience: l.verdict === Verdict.Leaves ? ('fof' as const) : ('me' as const),
      ...(server.has(l.text) ? { preset: server.get(l.text) } : {}),
      category: l.category,
      sources: l.sources,
      tanaNodeIds: l.tanaNodeIds,
      verdict: l.verdict,
      reason: l.reason,
    })),
  }
}

export interface ReviewContext {
  runId: string
  /** Who and which day the presets name (the asker sees both). */
  by: string
  today: string
  generatedAt: string
  mode: 'dry run' | 'send'
  destination: string
  inputs: string[]
  /** Mac folder entries that were not read (not a regular .txt file), each named with its reason. */
  skipped?: string[]
  files: string[]
}

/** The human review file: what WOULD leave this Mac, what stays, and why. Carries the run id the send check looks for. */
export function renderReview(lines: readonly ExportLine[], ctx: ReviewContext): string {
  const leaving = lines.filter((l) => l.verdict === Verdict.Leaves)
  const staying = lines.filter((l) => l.verdict !== Verdict.Leaves)
  const row = (sign: string, l: ExportLine): string => `  ${sign} ${l.text}\n      why: ${l.reason}; from: ${l.sources.join(', ')} (${l.category})`
  // A leaving line shows exactly what the asker would see, the note included.
  const leaveRow = (l: ExportLine): string => `${row('+', l)}\n      the asker sees: "${l.text}" marked "${wireContext(ctx.by, ctx.today.slice(0, 10), l.mark?.note)}"`
  return [
    'PERSONAL TRUSTWEB INVENTORY: EXPORT REVIEW',
    `run ${ctx.runId}, ${ctx.mode}, generated ${ctx.generatedAt}`,
    '',
    'Read from (read-only):',
    ...ctx.inputs.map((i) => '  ' + i),
    '',
    ...((ctx.skipped ?? []).length ? ['NOT READ in the Mac folder (only regular .txt files are read):', ...(ctx.skipped ?? []).map((m) => '  ' + m), ''] : []),
    `WOULD LEAVE THIS MAC: ${leaving.length} line(s), to ${ctx.destination}.`,
    'An asker you granted sees each one marked "Allowed in advance by <you> (<day>)". Nothing else goes there.',
    ...(leaving.length ? leaving.map(leaveRow) : ['  (none: nothing would leave this Mac)']),
    '',
    `STAYS ON THIS MAC (and goes into the import file for your own phone, "Only me"): ${staying.length} line(s).`,
    ...(staying.length ? staying.map((l) => row('-', l)) : ['  (none)']),
    '',
    'Files written by this run:',
    ...ctx.files.map((f) => '  ' + f),
    '',
    'To allow a line in advance: tick "Allow in advance" on the review page, or add a child that reads exactly',
    '"allowed in advance" (or "allowed in advance: <note>"; the note is shown to the asker) under the node in Tana,',
    'or start the line with "+ " in a regular .txt file of your Mac folder (.md and every other file type are not read). Then run the dry run again and read this file.',
    '',
  ].join('\n')
}
