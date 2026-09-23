/**
 * Picks structured lines out of a free note, on this phone, with plain
 * keyword rules (no model, nothing leaves the device). The result is only a
 * first guess: every line stays editable, and a long press retags it.
 */
import { Tag } from './model'

const RULES: { tag: Tag; re: RegExp }[] = [
  { tag: Tag.Meet, re: /\b(talk to|speak to|meet|introduce|intro to|suggested|should (talk|meet|speak)|worth meeting|connect (me|us|her|him|them) with)\b/i },
  { tag: Tag.Looking, re: /\b(looking for|looks for|hiring|needs?|searching|seeking|wants?|wishes|sucht|braucht)\b/i },
  { tag: Tag.Offer, re: /\b(knows|can|could|offers?|has|have|spare|lends?|happy to|kann|hat|bietet)\b/i },
]

export function guessTag(line: string): Tag {
  for (const r of RULES) if (r.re.test(line)) return r.tag
  return Tag.Note
}

/**
 * Split a note into lines: on line breaks and sentence ends, then on ", " /
 * "; " where each side is long enough to stand alone as a note.
 */
export function splitNote(text: string): string[] {
  const out: string[] = []
  // No regex lookbehind: it is a parse error on iOS Safari before 16.4 and
  // would blank the whole bundle there.
  for (const sentence of text.replace(/([.!?])\s+/g, '$1\n').split(/\n+/)) {
    const parts = sentence.split(/[,;]\s+/).map((p) => p.trim()).filter(Boolean)
    let acc = ''
    for (const p of parts) {
      if (acc && acc.split(/\s+/).length >= 3 && p.split(/\s+/).length >= 3) {
        out.push(acc)
        acc = p
      } else {
        acc = acc ? `${acc}, ${p}` : p
      }
    }
    if (acc) out.push(acc)
  }
  return out
    .map((l) => l.replace(/[.\s]+$/, '').trim())
    .filter((l) => l.length >= 3)
    .map((l) => l.charAt(0).toUpperCase() + l.slice(1))
}

export function extractLines(text: string): { text: string; tag: Tag }[] {
  return splitNote(text).map((line) => ({ text: line, tag: guessTag(line) }))
}
