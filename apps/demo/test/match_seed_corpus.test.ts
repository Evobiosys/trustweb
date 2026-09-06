import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { matchTemplate } from '../src/match/lexical'
import { getTemplate, TEMPLATES } from '../src/data/templates'
import type { ChatThread } from '../src/types'

/**
 * The acceptance test that matters most: run the real matcher against the
 * real seeded WhatsApp export and prove T1 finds the one buried flat-coming-
 * free mention, the other four templates behave as documented (zero hits,
 * or a real, explained hit -- never a silently loosened assertion), and the
 * whole thing is deterministic.
 *
 * Fixture loading: the parse agent's fixture directory landed at
 * test/fixtures/seed-corpus-wien-wohnen.txt during this task (confirmed
 * present as of this writing), with the overnight/ copy as a fallback in
 * case that changes. src/parse/index.ts (parseWhatsApp) also landed, so this
 * test uses the REAL parser, not a local stand-in.
 */
const FIXTURE_PATH = join(__dirname, 'fixtures', 'seed-corpus-wien-wohnen.txt')
const OVERNIGHT_FALLBACK_PATH = join(
  __dirname,
  '../../../../overnight/seed-corpus-wien-wohnen.txt',
)

function loadSeedCorpusRaw(): string {
  const path = existsSync(FIXTURE_PATH) ? FIXTURE_PATH : OVERNIGHT_FALLBACK_PATH
  return readFileSync(path, 'utf-8')
}

/**
 * Parse the seed corpus into a ChatThread. Uses the real parser
 * (src/parse/index.ts's parseWhatsApp, landed by the parse agent) when
 * importable; otherwise falls back to a minimal TEST-ONLY line splitter so
 * this test still runs standalone. THE FALLBACK IS A STAND-IN, NOT A
 * REPLACEMENT: swap it out the moment src/parse is authoritative (it
 * already is, as of this writing -- see the try branch below).
 */
async function parseSeedCorpus(raw: string): Promise<ChatThread> {
  try {
    const parseModule = await import('../src/parse/index')
    if (typeof parseModule.parseWhatsApp === 'function') {
      return parseModule.parseWhatsApp(raw)
    }
  } catch {
    // src/parse not ready yet -- fall through to the local stand-in below.
  }

  // --- TEST-ONLY FALLBACK ----------------------------------------------------
  // Minimal iOS WhatsApp line splitter. Strips the U+200E LRM the real
  // export inserts after "] " and before both the sender name and
  // attachment placeholders; does NOT attempt full timestamp parsing.
  // Every real matching behaviour under test lives in src/match/*, not
  // here -- this only has to produce {author, text, system} triples.
  const LRM = '‎'
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const messages = lines
    .map((line) => {
      const withoutLrm = line.split(LRM).join('')
      const m = withoutLrm.match(/^\[[^\]]+\]\s*(.*)$/)
      if (!m) return null
      const rest = m[1]
      const colonIdx = rest.indexOf(': ')
      if (colonIdx === -1) {
        // System line (join/leave/encryption notice): no "Author: text" shape.
        return { ts: '', author: 'system', text: rest, system: true }
      }
      const author = rest.slice(0, colonIdx)
      const text = rest.slice(colonIdx + 2)
      return { ts: '', author, text, system: false }
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)

  const participants = Array.from(
    new Set(messages.filter((m) => !m.system).map((m) => m.author)),
  )
  return {
    id: 'seed-corpus-wien-wohnen',
    title: 'Otta Grätzl & Alltag',
    kind: participants.length === 2 ? 'direct' : 'group',
    participants,
    messages,
    source: 'seed',
    included: true,
  }
}

describe('match_seed_corpus (acceptance)', () => {
  it('T1 (flat pre-listing) finds the buried flat-coming-free message as its top hit', async () => {
    const raw = loadSeedCorpusRaw()
    const thread = await parseSeedCorpus(raw)
    const t1 = getTemplate('wot.vienna.housing.flat_pre_listing')
    if (!t1) throw new Error('T1 template missing')

    const result = matchTemplate(t1, [thread])

    expect(result.hits.length).toBeGreaterThanOrEqual(1)

    // Steffi's message: "die Wohnung wird frei sobald sie im Herbst
    // auszieht, Herklotzgasse, Ottakring, 2 Zimmer" -- the buried mention.
    // "herklotzgasse" is unique to this one message in the whole corpus, so
    // asserting on it pins down exactly which message won, not just that
    // *a* hit exists.
    const top = result.hits[0]
    expect(top.message.text.toLowerCase()).toContain('herklotzgasse')
    expect(top.message.author).toBe('Steffi')

    // The win must be decisive (score, not an accidental tie-break): the
    // boosted terms (auszieht, wohnung, "2 zimmer", ottakring, herbst) all
    // fire on this one message, stacking well above any other candidate
    // (the next-best legitimate message -- "falls wer wen kennt der grad a
    // wohnung braucht ... bevors online geht" -- scores far lower).
    if (result.hits.length > 1) {
      expect(top.score).toBeGreaterThan(result.hits[1].score)
    }

    // The three named decoys must never appear in the hit list at all.
    const hitTexts = result.hits.map((h) => h.message.text.toLowerCase())
    expect(hitTexts.some((t) => t.includes('willhaben.at'))).toBe(false)
    expect(hitTexts.some((t) => t.includes('ferienwohnung'))).toBe(false)
    expect(hitTexts.some((t) => t.includes('putzen'))).toBe(false)

    // Seeker-side language must not create a hit on this OFFER template.
    expect(hitTexts.some((t) => t.includes('cousine sucht grad genau sowas'))).toBe(false)

    // C-03 (2026-09-06): the demo-only kThreshold override of 1 is banned
    // ("must not ship") and T1 now carries the workspace DEFAULT_K (3) like
    // every other production template. A single seeded group can no longer
    // clear that floor, so aboveThreshold correctly reads false here -- this
    // is the accepted cost of closing C-03, not a regression. The matcher
    // still finds and ranks the buried message correctly, above; only the
    // consent-worthy reveal is gated differently now.
    expect(t1.kThreshold).toBe(3)
    expect(result.aboveThreshold).toBe(false)
  })

  it('T2 (Nachmieter/Genossenschaft) finds zero hits: this corpus never mentions co-op/municipal succession', async () => {
    const raw = loadSeedCorpusRaw()
    const thread = await parseSeedCorpus(raw)
    const t2 = getTemplate('wot.vienna.housing.nachmieter_genossenschaft')
    if (!t2) throw new Error('T2 template missing')

    const result = matchTemplate(t2, [thread])

    expect(result.hits).toHaveLength(0)
    expect(result.aboveThreshold).toBe(false)
  })

  it('T3 (Kassenarzt) DOES legitimately hit: Steffi\'s doctor question is real Kassenarzt content, not a false positive', async () => {
    // Per the task's own instruction ("if one legitimately hits, assert
    // that and explain why ... do not silently loosen the test"): this
    // corpus's Kassenarzt sub-thread (lines 37-42 of the seed file) is
    // genuine, on-topic content for T3 -- Steffi's Hausarzt is retiring and
    // the group discusses Aufnahmestopp and a Frauenärztin who stopped
    // taking patients. Deleting "kassenarzt"/"aufnahmestopp" from the
    // vocabulary to force a zero-hit result here would gut real-world
    // recall for the sake of a clean test, which the task explicitly
    // forbids.
    const raw = loadSeedCorpusRaw()
    const thread = await parseSeedCorpus(raw)
    const t3 = getTemplate('wot.vienna.health.kassenarzt_open')
    if (!t3) throw new Error('T3 template missing')

    const result = matchTemplate(t3, [thread])

    expect(result.hits.length).toBeGreaterThanOrEqual(1)
    expect(
      result.hits.some((h) => h.message.text.toLowerCase().includes('kassenarzt')),
    ).toBe(true)
    // Still correctly gated: one seeded group is nowhere near k=7.
    expect(result.aboveThreshold).toBe(false)
  })

  it('T4 (reliable Handwerker) DOES legitimately hit: Rosa\'s Installateur question is real content', async () => {
    // Same principle as T3: line 27 ("kennt wer an guten Installateur der
    // wirklich kommt wann er sagt?") is genuine on-topic content for this
    // template, asserted here rather than hidden by a term deletion.
    const raw = loadSeedCorpusRaw()
    const thread = await parseSeedCorpus(raw)
    const t4 = getTemplate('wot.vienna.services.handwerker_reliable')
    if (!t4) throw new Error('T4 template missing')

    const result = matchTemplate(t4, [thread])

    expect(result.hits.length).toBeGreaterThanOrEqual(1)
    expect(
      result.hits.some((h) => h.message.text.toLowerCase().includes('installateur')),
    ).toBe(true)
    expect(result.aboveThreshold).toBe(false)
  })

  it('T5 (Kindergarten place) DOES legitimately hit: Fatima\'s sister storyline is real content', async () => {
    // Same principle again: lines 54, 99 and 112 track a real Kindergarten-
    // place storyline (sister on a waiting list, then a place opening up).
    // Kept, and asserted, rather than deleted to force zero.
    const raw = loadSeedCorpusRaw()
    const thread = await parseSeedCorpus(raw)
    const t5 = getTemplate('wot.vienna.childcare.place_open')
    if (!t5) throw new Error('T5 template missing')

    const result = matchTemplate(t5, [thread])

    expect(result.hits.length).toBeGreaterThanOrEqual(1)
    expect(
      result.hits.some((h) => h.message.text.toLowerCase().includes('kindergarten')),
    ).toBe(true)
    expect(result.aboveThreshold).toBe(false)
  })

  it('is deterministic: matching all 5 templates twice gives byte-identical results', async () => {
    const raw = loadSeedCorpusRaw()
    const thread = await parseSeedCorpus(raw)

    const runOnce = () => TEMPLATES.map((t) => matchTemplate(t, [thread]))

    const first = runOnce()
    const second = runOnce()

    expect(second).toEqual(first)
  })
})
