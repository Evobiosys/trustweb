import { describe, expect, it } from 'vitest'
import { matchTemplate } from '../src/match/lexical'
import { threadsInScope, addInventoryItem } from '../src/state'
import type { DeviceState } from '../src/state'
import type { InventoryItem, QueryTemplate } from '../src/types'

/**
 * "Was ich habe" runs through the exact same matcher as the chat corpus:
 * threadsInScope() (see state.ts) turns every included entry into a
 * synthetic ChatThread and hands it to the SAME matchTemplate() chats
 * already go through. There is no second scoring path to test separately --
 * these tests exercise that one path with inventory-shaped input.
 */

function baseState(overrides: Partial<DeviceState> = {}): DeviceState {
  return {
    me: { id: 'marlene0', displayName: 'Marlene' },
    threads: [],
    peers: [],
    profile: { displayName: 'Marlene', bio: '', neighbourhood: '', languages: [] },
    inventory: [],
    queryLog: [],
    ...overrides,
  }
}

function entry(text: string, included: boolean, overrides: Partial<InventoryItem> = {}): InventoryItem {
  return { id: overrides.id ?? 'inv-1', text, createdAt: '2026-08-15T10:00:00.000Z', included, ...overrides }
}

function template(overrides: Partial<QueryTemplate> = {}): QueryTemplate {
  return {
    id: 'test.inventory',
    version: 1,
    category: 'test',
    title: { de: 'Test', en: 'Test' },
    question: { de: 'Test?', en: 'Test?' },
    matchTerms: ['bohrmaschine'],
    boostTerms: [],
    excludeTerms: [],
    minScore: 1,
    kThreshold: 1,
    sensitivity: 'low',
    ttlSeconds: 3600,
    ...overrides,
  }
}

describe('inventory entries matched via threadsInScope + matchTemplate', () => {
  it('an included entry matches a template exactly like a chat message would', () => {
    const s = baseState({
      inventory: [entry('Hab eine Bohrmaschine daheim, kannst sie dir jederzeit ausborgen.', true)],
    })
    const result = matchTemplate(template(), threadsInScope(s))
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0].threadId).toBe('inv:inv-1')
    expect(result.hits[0].terms).toContain('bohrmaschine')
    expect(result.distinctAuthors).toBe(1)
    expect(result.aboveThreshold).toBe(true)
  })

  it('an excluded entry is unmatchable, and re-including it makes it matchable again', () => {
    const s = baseState({
      inventory: [entry('Hab eine Bohrmaschine daheim, kannst sie dir jederzeit ausborgen.', false)],
    })

    const excluded = matchTemplate(template(), threadsInScope(s))
    expect(excluded.hits).toHaveLength(0)
    // Prove it structurally, not just by absence of a score -- mirrors
    // match_lexical.test.ts's "content can never appear in a hit" assertion.
    expect(JSON.stringify(excluded)).not.toContain('ausborgen')

    s.inventory[0].included = true
    const included = matchTemplate(template(), threadsInScope(s))
    expect(included.hits).toHaveLength(1)
    expect(included.hits[0].threadId).toBe('inv:inv-1')
  })

  it('a newly typed entry defaults to included, unlike a 1-on-1 chat', () => {
    const s = baseState()
    const item = addInventoryItem(s, 'Hab ein Lastenrad, frag einfach kurz.')
    expect(item.included).toBe(true)
    const result = matchTemplate(template({ matchTerms: ['lastenrad'] }), threadsInScope(s))
    expect(result.hits).toHaveLength(1)
  })

  it('the seeded T1 pre-listing entry fires the real production template, not a test stub', async () => {
    // Demo-critical: "she types a line, the room sees that line found." This
    // pins the specific seed entry (state.ts PERSONAS) against the actual
    // shipped template, so a future edit to either one that breaks the demo
    // beat fails loudly here instead of live in Vienna. Located by the
    // phrase the test actually depends on ('Wohnung frei', T1's matchTerm),
    // not by an incidental word like "Hausverwaltung" that a copy-edit could
    // drop without touching what makes the entry fire.
    const { PERSONAS } = await import('../src/state')
    const { TEMPLATES } = await import('../src/data/templates')
    const marlene = PERSONAS.find((p) => p.id === 'marlene0')!
    const seed = marlene.inventorySeed.find((e) => e.text.includes('Wohnung frei'))
    expect(seed).toBeDefined()
    const s = baseState({ inventory: [entry(seed!.text, true)] })
    const t1 = TEMPLATES.find((tpl) => tpl.id === 'wot.vienna.housing.flat_pre_listing')!
    const result = matchTemplate(t1, threadsInScope(s))
    expect(result.hits.length).toBeGreaterThan(0)
    expect(result.hits.some((h) => h.threadId.startsWith('inv:'))).toBe(true)
    // C-03 (2026-09-06): T1's demo-only kThreshold of 1 is banned ("must not
    // ship"); it now carries DEFAULT_K (3).
    // B-08 (2026-09-06), supersedes the "answers silently" note this comment
    // used to carry: match/lexical.ts's owner-declared bypass now clears the
    // floor for this match anyway -- every hit here comes from
    // threadsInScope()'s inventoryThreads() (source: 'self'), so no third
    // party is in the band. This device surfaces the consent ceremony.
    expect(result.aboveThreshold).toBe(true)
  })

  it('the add-entry placeholder (what someone actually types live) also fires T1', async () => {
    // The seed proves the shipped example works; this proves the OTHER copy
    // that matters -- the placeholder in screens/inventory.ts, which is the
    // operator's live-demo script -- fires the same template. Without this,
    // a future copy-edit to the placeholder alone (the seed test would not
    // catch that) could silently kill the "type it, then find it" beat.
    const { t } = await import('../src/i18n')
    const { TEMPLATES } = await import('../src/data/templates')
    const placeholder = t('inventoryPh').replace(/^z\.\s*B\.\s*/i, '')
    const s = baseState({ inventory: [entry(placeholder, true)] })
    const t1 = TEMPLATES.find((tpl) => tpl.id === 'wot.vienna.housing.flat_pre_listing')!
    const result = matchTemplate(t1, threadsInScope(s))
    expect(result.hits.length).toBeGreaterThan(0)
    // C-03 (2026-09-06): T1 enforces DEFAULT_K (3).
    // B-08 (2026-09-06): same owner-declared bypass as the seed-entry test
    // above -- this inventory-only match clears it regardless.
    expect(result.aboveThreshold).toBe(true)
  })

  it('one distinct author across a chat message and an inventory entry counts once, not twice', () => {
    const s = baseState({
      threads: [
        {
          id: 'g1',
          title: 'Otta Grätzl & Alltag',
          kind: 'group',
          participants: ['Marlene'],
          messages: [{ ts: '2026-08-15T09:00:00.000Z', author: 'Marlene', text: 'bohrmaschine da, sag bescheid', system: false }],
          source: 'seed',
          included: true,
        },
      ],
      inventory: [entry('Hab eine Bohrmaschine daheim, kannst sie dir jederzeit ausborgen.', true)],
    })
    const result = matchTemplate(template({ kThreshold: 1 }), threadsInScope(s))
    expect(result.hits).toHaveLength(2)
    expect(result.distinctAuthors).toBe(1) // same person, same normalized author key
  })
})

describe('"call into the web": a free-text ask against an inventory entry (the owner\'s named story)', () => {
  it('writing "Ski" into "Was ich habe" and asking the network for "Ski" finds it', async () => {
    const { freeTextTemplate } = await import('../src/data/free_text_query')
    const { classifyIncomingQuery } = await import('../src/incoming_query')

    const s = baseState()
    addInventoryItem(s, 'Ski, kannst du dir ausborgen, steht im Keller.')

    const tpl = freeTextTemplate('Ski')
    const result = matchTemplate(tpl, threadsInScope(s))

    expect(result.hits).toHaveLength(1)
    expect(result.hits[0].message.text).toContain('Ski')
    // Structural, not incidental: an inventory-only match always has exactly
    // one author (state.ts's inventoryThreads() doc comment). Before C-03
    // (2026-09-06) freeTextTemplate() carried a demo override of
    // kThreshold: 1, which let a single-author match clear the floor; that
    // override is now banned ("must not ship") and freeTextTemplate() uses
    // DEFAULT_K (3) like every other template.
    //
    // B-08 (2026-09-06): match/lexical.ts's owner-declared bypass clears the
    // floor here anyway -- this hit's thread.source is 'self' (it came from
    // threadsInScope()'s inventoryThreads()), so there is no third party in
    // the band to protect. The "Ski in, Ski found" story is restored.
    expect(result.distinctAuthors).toBe(1)
    expect(result.aboveThreshold).toBe(true)

    // The exact decision main.ts's handleAmbientQuery() makes from this
    // match: above the floor via the bypass, so this device surfaces the
    // consent ceremony.
    expect(classifyIncomingQuery(result, false, true)).toEqual({ surface: true, outcome: null })
  })

  it('a device with no matching inventory or chat content gets a silent no-match, not a surfaced one', async () => {
    const { freeTextTemplate } = await import('../src/data/free_text_query')
    const { classifyIncomingQuery } = await import('../src/incoming_query')

    const s = baseState({ inventory: [entry('Hab ein Lastenrad, frag einfach kurz.', true)] })
    const tpl = freeTextTemplate('Ski')
    const result = matchTemplate(tpl, threadsInScope(s))

    expect(result.hits).toHaveLength(0)
    expect(result.aboveThreshold).toBe(false)
    expect(classifyIncomingQuery(result, false, true)).toEqual({ surface: false, outcome: 'no-match' })
  })
})
