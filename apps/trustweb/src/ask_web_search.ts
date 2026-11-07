// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * "Ask your web" also searches the person's own web (wave 31): the people, resources and shared items on this phone that match the
 * words, an "also search online" link to the engine the person configured, and, when their own AI endpoint is set, a one-paragraph
 * summary that cites the matches. A "source set" narrows the search to named people and tags. Pure and DOM-free; nothing leaves the
 * phone here (the summary is a tap that sends the matches to the person's own endpoint only).
 */
import { fold, queryWords } from './search'
import { tagsOfFields } from './search_rank'
import type { AppState, AskSet } from './model'
import { alive } from './deleted_people'

export const ALL_SCOPE = 'all'
/** The engine when Settings holds none (or an unusable template): {q} stands for the encoded words. */
export const ENGINE_DEFAULT = 'https://duckduckgo.com/?q={q}'

export type WebRecord = Pick<AppState, 'askSets' | 'people' | 'inventory' | 'found'>

export interface AskScope { id: string; name: string }
export interface WebMatch { kind: 'person' | 'resource' | 'shared'; label: string; detail: string }

/** The search page for these words from a https template holding {q}; the default engine otherwise; null for no words. */
export function searchEngineUrl(template: string | undefined, query: string): string | null {
  const q = query.trim()
  if (!q) return null
  const t = template?.trim() ?? ''
  const base = t.startsWith('https://') && t.includes('{q}') ? t : ENGINE_DEFAULT
  return base.replace('{q}', encodeURIComponent(q))
}

/** What the ask box can be narrowed to: everyone, then each named source set. */
export function askScopes(rec: Pick<AppState, 'askSets'>): AskScope[] {
  return [{ id: ALL_SCOPE, name: '' }, ...(rec.askSets ?? []).map((s) => ({ id: s.id, name: s.name }))]
}

const hits = (words: readonly string[], ...texts: string[]): boolean => {
  const hay = fold(texts.join(' '))
  return words.every((w) => hay.includes(w))
}

/** Matches in my web: people, my own resources (switched on), items people shared. A set limits it to its people and tags. */
export function matchWeb(rec: WebRecord, query: string, scopeId: string = ALL_SCOPE): WebMatch[] {
  const words = queryWords(query)
  if (!words.length) return []
  const set: AskSet | undefined = scopeId === ALL_SCOPE ? undefined : rec.askSets?.find((s) => s.id === scopeId)
  if (scopeId !== ALL_SCOPE && !set) return []
  const people = alive(rec.people ?? []).filter((p) => !set || set.personIds.includes(p.id) || tagsOfFields(p.fields).some((t) => set.tags.includes(t)))
  const peerIds = new Set(people.map((p) => p.peerId).filter(Boolean))
  const out: WebMatch[] = []
  for (const p of people) if (hits(words, p.name, p.context, ...p.lines.map((l) => l.text))) out.push({ kind: 'person', label: p.name, detail: p.context })
  if (!set) for (const i of rec.inventory ?? []) if (i.included && hits(words, i.text)) out.push({ kind: 'resource', label: i.text, detail: '' })
  const seen = new Set<string>()
  for (const f of rec.found ?? []) for (const sh of f.shared) {
    if (set && !(sh.peerId && peerIds.has(sh.peerId))) continue
    for (const it of sh.items) {
      const key = sh.from + '|' + it.text
      if (!seen.has(key) && hits(words, it.text, it.context)) { seen.add(key); out.push({ kind: 'shared', label: it.text, detail: sh.from }) }
    }
  }
  return out
}

/** The user message for the person's own AI: the question and the numbered matches it must cite as [n]. */
export function summaryPrompt(query: string, matches: readonly WebMatch[]): string {
  const list = matches.map((m, i) => `[${i + 1}] ${m.label}${m.detail ? ` (${m.detail})` : ''}`).join('\n')
  return `Question: ${query}\nMatches in my web:\n${list}`
}

/** The system message: one plain paragraph, grounded in the numbered matches, citing them. */
export const SUMMARY_SYSTEM = 'Answer the question in one short plain paragraph, using only the numbered matches. Cite the matches you use as [1], [2]. If they do not answer it, say so.'
