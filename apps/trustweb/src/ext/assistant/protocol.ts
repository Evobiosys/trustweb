// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 ai-edit-chat: how the assistant talks with the person's own AI. The model writes plain words and, for every change, one
 * fenced block ```tw-actions {"actions":[{"type","args","why"}],"done":bool}```; each action is checked against the registry
 * (actions.ts) and shown as a card. Unknown or malformed actions are rejected, never run. Streaming replies arrive as
 * OpenAI-compatible server-sent events. Pure, no DOM.
 */
import type { ActionSpec, Checked, Valid } from '../../actions'

export const BLOCK = 'tw-actions'
export const MAX_ACTIONS = 50

const THINK = /<think>[\s\S]*?(<\/think>|$)/gi
const FENCE = new RegExp('```' + BLOCK + '\\s*\\n?([\\s\\S]*?)```', 'g')

export interface ParsedReply { say: string; actions: Valid[]; rejected: { error: string }[]; done: boolean }

const tidy = (t: string): string => t.replace(/\n{3,}/g, '\n\n').trim()

/** The words of a finished reply, its checked actions, what was rejected and whether the model says it is done. */
export function parseAssistantReply(text: string, check: (raw: unknown) => Checked): ParsedReply {
  const clean = text.replace(THINK, '')
  const out: ParsedReply = { say: '', actions: [], rejected: [], done: false }
  const raws: unknown[] = []
  for (const m of clean.matchAll(FENCE)) {
    let body: unknown
    try { body = JSON.parse(m[1].trim()) } catch { out.rejected.push({ error: 'the action block is not JSON' }); continue }
    const list = Array.isArray(body) ? body : (body as { actions?: unknown } | null)?.actions
    if (!Array.isArray(body) && (body as { done?: unknown } | null)?.done === true) out.done = true
    if (Array.isArray(list)) raws.push(...list)
  }
  for (const raw of raws.slice(0, MAX_ACTIONS)) {
    const c = check(raw)
    if (c.ok) out.actions.push(c.action); else out.rejected.push({ error: c.error })
  }
  if (raws.length > MAX_ACTIONS) out.rejected.push({ error: `more than ${MAX_ACTIONS} actions in one reply: the rest were left out` })
  out.say = tidy(clean.replace(FENCE, ''))
  return out
}

/** What to show while the reply streams in: the words only (finished blocks and a block still arriving are hidden). */
export function visibleText(partial: string): string {
  const t = partial.replace(THINK, '').replace(FENCE, '')
  const open = t.indexOf('```' + BLOCK)
  return tidy(open >= 0 ? t.slice(0, open) : t)
}

/** Reads `data:` lines of a chat completions stream; push() returns the content pieces each chunk completes. */
export function createSseReader() {
  let buf = ''
  let finished = false
  return {
    push(chunk: string): string[] {
      if (finished) return []
      buf += chunk
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      const out: string[] = []
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') { finished = true; break }
        try {
          const piece = (JSON.parse(data) as { choices?: { delta?: { content?: unknown } }[] })?.choices?.[0]?.delta?.content
          if (typeof piece === 'string' && piece) out.push(piece)
        } catch { /* a line that is not JSON (a comment, a keep-alive) */ }
      }
      return out
    },
    done: (): boolean => finished,
  }
}

export interface PromptRow { key: string; name: string; labels?: string[]; ring?: string; note?: string; emails?: string[]; phones?: string[] }
export interface PromptPerson { id: string; name: string; ring: string; tags: string[] }
export interface PromptInput {
  specs: readonly ActionSpec[]
  where: string
  profile: string
  look: string
  variations: readonly string[]
  modules: readonly string[]
  places: readonly string[]
  recent: readonly string[]
  /** Import rows waiting on the Curate page (key, name, tags, ring, note; e-mail and phone are never sent). */
  rows: readonly PromptRow[]
  /** People the message names. */
  people: readonly PromptPerson[]
}

/** The system message: who the assistant is, the action catalogue, the block format, and where the person is right now. */
export function systemPrompt(o: PromptInput): string {
  const rows = o.rows.map((r) => `- ${r.key}: ${r.name}${r.labels?.length ? ` [${r.labels.join(', ')}]` : ''}${r.ring ? ` ring=${r.ring}` : ''}${r.note ? ` note="${r.note.slice(0, 80)}"` : ''}`)
  const people = o.people.map((p) => `- ${p.id}: ${p.name} ring=${p.ring}${p.tags.length ? ` tags=${p.tags.join(',')}` : ''}`)
  return [
    'You are the TrustWeb assistant inside the TrustWeb app (a personal web of trust: people on rings, tags, notes, imports).',
    'You can do everything the person can do by tapping, through the actions below. You can also explain any part of the app and help the person recreate or vary it (variations of look, parts and profile).',
    'Answer in short plain words. For every change you propose, add ONE fenced block at the end of your reply:',
    '```' + BLOCK,
    '{"actions":[{"type":"<type>","args":{...},"why":"<short reason>"}],"done":false}',
    '```',
    'Set "done": true when you think the whole request is finished, so the person can review. Never invent ids: use the keys and ids listed below, or exact names.',
    'Use "open" to bring the person to the place a change happens, before the change.',
    '',
    'ACTIONS:',
    ...o.specs.map((s) => `- ${s.type} ${s.shape}: ${s.doc}`),
    '',
    `PLACES: ${o.places.join(', ')}`,
    `MODULES: ${o.modules.join(', ')}`,
    `VARIATIONS: ${o.variations.join(', ')}`,
    '',
    `NOW: on ${o.where}; variation ${o.profile}; look ${o.look}.`,
    ...(o.recent.length ? ['RECENT STEPS (oldest first):', ...o.recent.map((r) => `- ${r}`)] : []),
    ...(rows.length ? ['IMPORT ROWS WAITING ON CURATE (key: name [tags]):', ...rows] : []),
    ...(people.length ? ['PEOPLE NAMED IN THE MESSAGE (id: name):', ...people] : []),
  ].join('\n')
}

const fold = (t: string): string => t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')

/** People whose full name, or first name of 3+ letters, the message names; at most `max`. */
export function mentionedPeople<P extends { id: string; name: string }>(people: readonly P[], text: string, max: number): P[] {
  const hay = ` ${fold(text).replace(/[^\p{L}\p{N}]+/gu, ' ')} `
  const hit = (p: P): boolean => {
    const n = fold(p.name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    if (!n) return false
    const first = n.split(' ')[0]
    return hay.includes(` ${n} `) || (first.length >= 3 && hay.includes(` ${first} `))
  }
  return people.filter(hit).slice(0, max)
}
