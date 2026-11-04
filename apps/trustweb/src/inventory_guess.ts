// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 31 wabridge-ingest: items a person offers or needs, guessed from what THEY wrote, by a few verb-object patterns (de, en). Only the short
 * object phrase is kept, never the sentence. A guess, never verified. Pure.
 */
export interface Guess { title: string; need: boolean }

const TITLE_MAX = 40
const WORDS_MAX = 4
const ARTICLE = /^(?:ein|eine|einen|einem|einer|eins|der|die|das|den|dem|a|an|the|some|any|mal)\s+/i
const PATTERNS: readonly { re: RegExp; need: boolean }[] = [
  { re: /\bkann ich dir (.+?) (?:mal |gern |gerne )?leihen/i, need: false },
  { re: /\bverleihe (.+)/i, need: false },
  { re: /\bI can lend (?:you )?(.+)/i, need: false },
  { re: /\bhast du (?:vielleicht )?(?:ein|eine|einen|eins) (.+)/i, need: true },
  { re: /\bbrauche (.+)/i, need: true },
  { re: /\bsuche (.+)/i, need: true },
  { re: /\bdo you have (.+)/i, need: true },
  { re: /\blooking for (.+)/i, need: true },
  { re: /\bI need (?:a|an) (.+)/i, need: true },
]

/** "den Bohrer, danke" -> "Bohrer": cut at punctuation or " und ", drop the article, keep the first words. */
function clean(raw: string): string {
  const cut = raw.split(/[.,!?;:\n]| und | and | oder | or /i)[0].trim().replace(ARTICLE, '')
  return cut.split(/\s+/).slice(0, WORDS_MAX).join(' ').slice(0, TITLE_MAX).trim()
}

export function guessItems(texts: readonly string[]): Guess[] {
  const seen = new Set<string>()
  const out: Guess[] = []
  for (const t of texts) {
    for (const { re, need } of PATTERNS) {
      const m = re.exec(t)
      const title = m ? clean(m[1]) : ''
      const key = `${need}:${title.toLowerCase()}`
      if (title.length < 2 || seen.has(key)) continue
      seen.add(key)
      out.push({ title, need })
      break
    }
  }
  return out
}
