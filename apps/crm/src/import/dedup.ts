/**
 * Who is the same person across several exports (wave 7). Pure: no DOM, no network, no storage.
 *
 * Email and phone links are sure; a name link (same or similar) always needs a human look.
 */
import type { ImportedContact } from './types'

export enum MatchReason {
  Email = 'email',
  Phone = 'phone',
  SameName = 'same-name',
  SimilarName = 'similar-name',
}

export interface DupGroup {
  /** Indexes into the input, ascending. */
  members: number[]
  reasons: MatchReason[]
  /** Linked by email or phone only; a name-only link needs review. */
  sure: boolean
}

const SIMILAR_THRESHOLD = 0.94
const MIN_PHONE_DIGITS = 6

/** Digits with a leading +; '' when too short to compare. */
export function normalizePhone(raw: string, defaultCountry = '43'): string {
  const text = raw.trim().replace(/\(0\)/g, '')
  const digits = text.replace(/\D/g, '')
  if (digits.length < MIN_PHONE_DIGITS) return ''
  if (text.startsWith('+')) return `+${digits}`
  if (digits.startsWith('00')) return `+${digits.slice(2)}`
  if (digits.startsWith('0')) return `+${defaultCountry}${digits.slice(1)}`
  return `+${digits}`
}

/** Lower case, diacritics folded, punctuation out, tokens sorted. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ')
}

function jaro(a: string, b: string): number {
  if (a === b) return 1
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const aHit: boolean[] = []
  const bHit: boolean[] = []
  let matches = 0
  for (let i = 0; i < a.length; i++) {
    const hi = Math.min(i + range, b.length - 1)
    for (let j = Math.max(0, i - range); j <= hi; j++) {
      if (bHit[j] || a[i] !== b[j]) continue
      aHit[i] = bHit[j] = true
      matches++
      break
    }
  }
  if (matches === 0) return 0
  let swaps = 0
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!aHit[i]) continue
    while (!bHit[k]) k++
    if (a[i] !== b[k]) swaps++
    k++
  }
  return (matches / a.length + matches / b.length + (matches - swaps / 2) / matches) / 3
}

function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b)
  let prefix = 0
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  return j + prefix * 0.1 * (1 - j)
}

class UnionFind {
  private parent: number[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]]
      i = this.parent[i]
    }
    return i
  }
  /** True when the two were in different sets. */
  union(a: number, b: number): boolean {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return false
    this.parent[Math.max(ra, rb)] = Math.min(ra, rb)
    return true
  }
}

interface Link {
  a: number
  b: number
  reason: MatchReason
}

/** Links every index that shares a key with the first index seen for that key. */
function keyLinks(keys: readonly (readonly string[])[], reason: MatchReason): Link[] {
  const first = new Map<string, number>()
  const links: Link[] = []
  keys.forEach((own, i) => {
    for (const key of own) {
      if (!key) continue
      const seen = first.get(key)
      if (seen === undefined) first.set(key, i)
      else if (seen !== i) links.push({ a: seen, b: i, reason })
    }
  })
  return links
}

/** Multi-token names only: a lone "Maria" never links by name. */
function nameKeys(list: readonly ImportedContact[]): string[] {
  return list.map((c) => normalizeName(c.name))
}

function isLinkable(name: string): boolean {
  return name.includes(' ')
}

function blockKey(name: string): string {
  const tokens = name.split(' ')
  return `${tokens[0].slice(0, 2)}|${tokens[tokens.length - 1].slice(0, 2)}`
}

function similarNameLinks(names: readonly string[]): Link[] {
  const blocks = new Map<string, Map<string, number>>()
  names.forEach((name, i) => {
    if (!isLinkable(name)) return
    const key = blockKey(name)
    const block = blocks.get(key) ?? new Map<string, number>()
    if (!block.has(name)) block.set(name, i)
    blocks.set(key, block)
  })
  const links: Link[] = []
  for (const block of blocks.values()) {
    const entries = [...block]
    for (let x = 0; x < entries.length; x++) {
      for (let y = x + 1; y < entries.length; y++) {
        const [na, ia] = entries[x]
        const [nb, ib] = entries[y]
        if (Math.abs(na.length - nb.length) > 3) continue
        if (jaroWinkler(na, nb) >= SIMILAR_THRESHOLD) links.push({ a: ia, b: ib, reason: MatchReason.SimilarName })
      }
    }
  }
  return links
}

/** Groups of the same person, 2+ members, ordered by first member. */
export function findDuplicates(list: readonly ImportedContact[], defaultCountry = '43'): DupGroup[] {
  const names = nameKeys(list)
  const linkable = names.map((n) => (isLinkable(n) ? [n] : []))
  const links = [
    ...keyLinks(list.map((c) => c.emails.map((e) => e.trim().toLowerCase())), MatchReason.Email),
    ...keyLinks(list.map((c) => c.phones.map((p) => normalizePhone(p, defaultCountry))), MatchReason.Phone),
    ...keyLinks(linkable, MatchReason.SameName),
    ...similarNameLinks(names),
  ]
  const sets = new UnionFind(list.length)
  const reasonsByRoot = new Map<number, Set<MatchReason>>()
  const used: Link[] = []
  for (const link of links) {
    const strong = link.reason === MatchReason.Email || link.reason === MatchReason.Phone
    // a name link only counts when it joins two sets that email/phone had not already joined
    if (sets.union(link.a, link.b) || strong) used.push(link)
  }
  for (const link of used) {
    const root = sets.find(link.a)
    const set = reasonsByRoot.get(root) ?? new Set<MatchReason>()
    set.add(link.reason)
    reasonsByRoot.set(root, set)
  }
  const members = new Map<number, number[]>()
  list.forEach((_, i) => {
    const root = sets.find(i)
    members.set(root, [...(members.get(root) ?? []), i])
  })
  return [...members]
    .filter(([, m]) => m.length > 1)
    .map(([root, m]) => {
      const reasons = [...(reasonsByRoot.get(root) ?? [])]
      const sure = reasons.every((r) => r === MatchReason.Email || r === MatchReason.Phone)
      return { members: m, reasons, sure }
    })
    .sort((x, y) => x.members[0] - y.members[0])
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function firstDefined(list: readonly ImportedContact[], pick: (c: ImportedContact) => string | undefined): string | undefined {
  for (const c of list) {
    const v = pick(c)?.trim()
    if (v) return v
  }
  return undefined
}

/** One contact from a group; `list` must not be empty. */
export function mergeContacts(list: readonly ImportedContact[]): ImportedContact {
  const first = list[0]
  const phoneSeen = new Set<string>()
  const phones = list.flatMap((c) => c.phones).filter((p) => {
    const key = normalizePhone(p) || p
    if (phoneSeen.has(key)) return false
    phoneSeen.add(key)
    return true
  })
  const notes = distinct(list.map((c) => c.note?.trim() ?? '').filter(Boolean))
  const sinces = list.map((c) => c.since).filter((s): s is number => s !== undefined)
  return {
    source: first.source,
    file: first.file,
    sourceRef: first.sourceRef,
    name: list.reduce((best, c) => (c.name.length > best.length ? c.name : best), first.name),
    given: firstDefined(list, (c) => c.given),
    family: firstDefined(list, (c) => c.family),
    phones,
    emails: distinct(list.flatMap((c) => c.emails)),
    org: firstDefined(list, (c) => c.org),
    title: firstDefined(list, (c) => c.title),
    birthday: firstDefined(list, (c) => c.birthday),
    note: notes.length ? notes.join('\n\n') : undefined,
    labels: distinct(list.flatMap((c) => c.labels)),
    since: sinces.length ? Math.min(...sinces) : undefined,
  }
}
