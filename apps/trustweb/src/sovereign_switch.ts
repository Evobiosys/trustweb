// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 (sovereign-switch): Settings > Sovereign Switch, the pure parts. Export everything as files (record.json as stored, log.jsonl
 * one create_node line per node, Logseq-style Markdown per kind, a README), and the other-services checklist with a GDPR Art. 17
 * (erasure) + Art. 20 (portability) request in English or German. The log is the shape the record moves to (append-only JSONL);
 * today every node is one create_node line. No DOM, no network: the file stays on this device until the owner moves it.
 */
import type { RtbfService } from './data/services_rtbf'
import type { AppState } from './model'
import type { ZipFile } from './zip'

const pad = (n: number): string => String(n).padStart(2, '0')

export function exportName(now: number): string {
  const d = new Date(now)
  return `trustweb-export-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`
}

/** The collections that are nodes; everything else of the record is one settings node (without the identity keys). */
const NODE_KEYS = ['people', 'inventory', 'events', 'tasks', 'received', 'meetings', 'chats'] as const

type Node = Record<string, unknown>
type Chats = Record<string, { messages?: { at?: number }[] }>

function chatMeta(chats: unknown): Node[] {
  return Object.entries((chats ?? {}) as Chats).map(([peerId, t]) => {
    const ts = (t.messages ?? []).map((m) => m.at).filter((x): x is number => typeof x === 'number')
    return { peerId, messages: t.messages?.length ?? 0, ...(ts.length ? { firstTs: Math.min(...ts), lastTs: Math.max(...ts) } : {}) }
  })
}

function nodes(s: AppState): { kind: string; file: string; list: Node[] }[] {
  const r = s as unknown as Record<string, unknown>
  const arr = (k: string): Node[] => (Array.isArray(r[k]) ? (r[k] as Node[]) : [])
  const settings = Object.fromEntries(Object.entries(r).filter(([k]) => !(NODE_KEYS as readonly string[]).includes(k) && k !== 'identity'))
  return [
    { kind: 'person', file: 'people.md', list: arr('people') },
    { kind: 'resource', file: 'resources.md', list: arr('inventory') },
    { kind: 'event', file: 'events.md', list: arr('events') },
    { kind: 'task', file: 'tasks.md', list: arr('tasks') },
    { kind: 'share', file: 'shares.md', list: arr('received') },
    { kind: 'meeting', file: 'meetings.md', list: arr('meetings') },
    { kind: 'chat', file: 'chats.md', list: chatMeta(r.chats) },
    { kind: 'settings', file: 'settings.md', list: [settings] },
  ]
}

/** One line, no outliner syntax breaking out of a property. */
const flat = (v: unknown): string => String(v).replace(/\s+/g, ' ').trim()
const prop = (k: string, v: unknown): string => (v === undefined || v === null || v === '' ? '' : `  ${k}:: ${flat(v)}\n`)
const iso = (ms: unknown): string | undefined => (typeof ms === 'number' ? new Date(ms).toISOString() : undefined)
const tagsOf = (fields: unknown): string => Object.entries((fields ?? {}) as Record<string, string>).filter(([, v]) => v === 'true').map(([k]) => k).join(', ')

function md(kind: string, n: Node): string {
  switch (kind) {
    case 'person': {
      const lines = Array.isArray(n.lines) ? (n.lines as Node[]) : []
      return `- ${flat(n.name)}\n${prop('id', n.id)}${prop('ring', n.ring)}${prop('context', n.context)}${prop('tags', tagsOf(n.fields))}` +
        lines.map((l) => `  - ${flat(l.text)}\n`).join('')
    }
    case 'resource': return `- ${flat(n.text)}\n${prop('id', n.id)}${prop('audience', n.audience)}${prop('shared', n.included)}`
    case 'event': return `- ${flat(n.name)}\n${prop('id', n.id)}${prop('from', n.from)}${prop('to', n.to)}`
    case 'task': return `- ${flat(n.title)}\n${prop('id', n.id)}${prop('due', n.due)}`
    case 'share': return `- ${flat(n.title)}\n${prop('id', n.id)}${prop('from', n.fromName)}${prop('at', iso(n.at))}${prop('link', n.link)}`
    case 'meeting': return `- ${flat(n.about)}\n${prop('id', n.id)}${prop('at', iso(n.at))}${prop('lines', Array.isArray(n.lines) ? n.lines.length : undefined)}`
    case 'chat': return `- ${flat(n.peerId)}\n${prop('messages', n.messages)}${prop('first', iso(n.firstTs))}${prop('last', iso(n.lastTs))}`
    default: return `- settings\n` + Object.entries(n).filter(([, v]) => typeof v !== 'object').map(([k, v]) => prop(k, v)).join('')
  }
}

const README = `# TrustWeb export

Everything this device holds of your TrustWeb record, as files you own.

- record.json: the record exactly as stored on this device. It includes your identity keys: keep this file private.
- log.jsonl: one line per node ({seq, ts, op, kind, node}); op is create_node for every node in this export. Chats carry counts and times only; their texts are in record.json.
- people.md, resources.md, events.md, tasks.md, shares.md, meetings.md, chats.md, settings.md: the same nodes as outliner Markdown with properties (key:: value), readable in Logseq or any text editor.

Nothing was sent anywhere to make this file.
`

export function exportFiles(s: AppState, now: number): ZipFile[] {
  const all = nodes(s)
  let seq = 0
  const log = all.flatMap(({ kind, list }) => list.map((node) => JSON.stringify({ seq: ++seq, ts: now, op: 'create_node', kind, node }))).join('\n')
  return [
    { name: 'README.md', data: README },
    { name: 'record.json', data: JSON.stringify(s, null, 2) },
    { name: 'log.jsonl', data: log ? log + '\n' : '' },
    ...all.map(({ kind, file, list }) => ({ name: file, data: list.map((n) => md(kind, n)).join('') })),
  ]
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Other services: the request template and the checklist.

export type Lang = 'en' | 'de'
export interface Fill { name: string; account: string; date: string }

export function requestText(lang: Lang, service: string, f: Fill): { subject: string; body: string } {
  if (lang === 'de') {
    return {
      subject: `Antrag auf Löschung (Art. 17 DSGVO) und Datenübertragung (Art. 20 DSGVO): ${f.account}`,
      body: `Sehr geehrte Damen und Herren,\n\nich beantrage gemäß Art. 20 DSGVO die Herausgabe aller personenbezogenen Daten, die ${service} über mich gespeichert hat, in einem strukturierten, gängigen und maschinenlesbaren Format, und anschließend gemäß Art. 17 DSGVO die Löschung dieser Daten und meines Kontos.\n\nName: ${f.name}\nKonto: ${f.account}\nDatum: ${f.date}\n\nBitte bestätigen Sie die Löschung innerhalb der Frist von einem Monat (Art. 12 Abs. 3 DSGVO).\n\nMit freundlichen Grüßen\n${f.name}`,
    }
  }
  return {
    subject: `Request for erasure (GDPR Article 17) and data portability (Article 20): ${f.account}`,
    body: `Dear Data Protection Officer,\n\nUnder Article 20 GDPR I request a copy of all personal data ${service} holds about me, in a structured, commonly used and machine-readable format, and then, under Article 17 GDPR, the erasure of that data and of my account.\n\nName: ${f.name}\nAccount: ${f.account}\nDate: ${f.date}\n\nPlease confirm the erasure within one month (Article 12(3) GDPR).\n\nKind regards\n${f.name}`,
  }
}

export function mailtoFor(svc: Pick<RtbfService, 'name' | 'email'>, lang: Lang, f: Fill): string {
  const { subject, body } = requestText(lang, svc.name, f)
  return `mailto:${svc.email ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

type Sov = Pick<AppState, 'sovereign'>

/** Ticks (or, with null, clears) the export or deletion request for a service, with its date. */
export function markService(s: Sov, id: string, what: 'export' | 'delete', at: number | null): void {
  s.sovereign ??= {}
  const all = (s.sovereign.services ??= {})
  const key = what === 'export' ? 'exportAt' : 'deleteAt'
  const next = { ...all[id] }
  if (at === null) delete next[key]; else next[key] = at
  if (Object.keys(next).length) all[id] = next; else delete all[id]
}

/** "Start the switch": the first service with an export link whose export is not ticked yet; null when none is left. */
export function nextToExport(list: readonly RtbfService[], s: Sov): RtbfService | null {
  return list.find((x) => x.exportUrl && !s.sovereign?.services?.[x.id]?.exportAt) ?? null
}
