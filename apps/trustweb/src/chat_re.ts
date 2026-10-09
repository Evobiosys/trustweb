/**
 * Wave 6i, THE ONE THING ("an ask and its answer stay one conversation"), its first part. Jakob 2026-10-09 (a screenshot: a chat that
 * shows only "I do"): "I said this in reply to the other device asking for a spare room, so make sure to include this in the reply;
 * now the context is missing."
 *
 * A message that answers an ask carries it: the chat envelope's optional `re: {qid, text, at}` (apps/demo types.ts ChatRe). It is set
 * when a chat is started from an ask (the consent prompt, the nothing-matched card, an answer card, a late answer, an away card) and
 * travels sealed with the message; both phones show "Re: <ask> (<time>)" above it, and the chat history keeps it. The qid is the one
 * of that ask between these two phones. On receipt, a qid that names one of this phone's OWN asks to that connection shows this
 * phone's own words and time (the quote is bound to the ask, not to what the other phone claims); otherwise the carried words show,
 * cleaned like a chat text. Older builds drop the field and show the message alone.
 * Pure and DOM-free; never throws.
 */
import type { ChatRe } from '../../demo/src/types'
import { QID_RE, RE_TEXT_MAX } from '../../demo/src/types'
import { clipText, isRecord } from './kept_list'
import { askOfQid } from './late_answers'
import { stripUnsafe } from './safe_text'

export type { ChatRe }

/** An ask's words fit to quote: no hidden or bidi characters, one line, at most RE_TEXT_MAX; '' when nothing is left. */
export function cleanReText(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return clipText(stripUnsafe(raw).replace(/\s+/g, ' ').trim(), RE_TEXT_MAX)
}

/** The context a chat started from an ask carries; null when the ask has no usable qid, words or time (the chat then opens plainly). */
export function makeRe(qid: unknown, text: unknown, at: unknown): ChatRe | null {
  const words = cleanReText(text)
  if (typeof qid !== 'string' || !QID_RE.test(qid) || !words || typeof at !== 'number' || !Number.isFinite(at) || at < 0) return null
  return { qid, text: words, at }
}

/** A stored or received `re`, checked again (a record from another build, or the wire); null when it is not one. */
export function sanitizeRe(v: unknown): ChatRe | null {
  return isRecord(v) ? makeRe(v.qid, v.text, v.at) : null
}

/**
 * What an arriving message's `re` shows: when its qid is one this phone itself sent to that connection (late_answers.ts sentAsks),
 * this phone's own words and time; otherwise the carried ones, cleaned. Null when there is none or it is not well formed.
 */
export function bindRe(raw: unknown, sentAsks: unknown, peerId: string, now: number): ChatRe | null {
  const re = sanitizeRe(raw)
  if (!re) return null
  const own = askOfQid(sentAsks, re.qid, peerId, now)
  return own ? makeRe(re.qid, own.text, own.at) ?? re : re
}
