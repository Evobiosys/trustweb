/**
 * Wave 2 (2026-10-07), the pure parts:
 *   item 4 (P22, P26): who can ask about a line: the three tiers and "Only me";
 *     each tier admits itself and everyone closer; an unknown value admits nobody.
 *   item 6 (P29, P32): contact methods: QR code and link now, a moving QR code
 *     soon, NFC / Bluetooth / AirDrop later, never "UWB".
 *   item 7 (B8): the web search links: encoded, blank = none, https only, capped.
 *   item 8 (B4, B7): unreviewed / mass-imported / created step by step; "Reviewed"
 *     and "Mark all reviewed"; never in an answer; Undo import is not blocked by it.
 */
import { Audience, AUDIENCES, audienceAdmits, LineStatus, Provenance, ProvenanceState, Ring, sharedItems, threadsForRing } from '../../src/model.ts'
import { markBatchReviewed, markReviewed, provenanceState } from '../../src/provenance.ts'
import { applyImport, parseImportFile, planImport, undoImport } from '../../src/inventory_import.ts'
import { S } from '../../src/strings.ts'
import { webSearchUrl } from '../../src/web_search.ts'
import { SEARCH_ENGINES, SearchEngine } from '../../src/model.ts'

const NOW = Date.UTC(2026, 9, 7, 10, 0, 0)

function phone(inventory, lines = []) {
  return {
    v: 1, me: { id: 'me', displayName: 'Jakob' }, peers: [], log: [], notificationsOn: false,
    inventory,
    people: [{ id: 'p1', name: 'Kaya', context: 'Impact Hub', ring: Ring.Friend, metAt: NOW, lines }],
  }
}
const item = (id, audience, included = true) => ({ id, text: `thing ${id}`, audience, included, createdAt: NOW })
const matched = (s, ring) => threadsForRing(s, ring).threads.map((t) => t.id).sort()

describe('item 4: the three tiers and "Only me"', () => {
  it('offers all four, widest first', () => {
    expect(AUDIENCES).toEqual([Audience.FriendsOfFriends, Audience.Friends, Audience.Close, Audience.OnlyMe])
    expect(new Set(AUDIENCES).size).toBe(4)
  })
  it('each tier admits itself and everyone closer; Only me admits nobody; someone you only plan to meet, nothing', () => {
    const table = {
      [Audience.FriendsOfFriends]: { close: true, friend: true, acquaintance: true, intending: false },
      [Audience.Friends]: { close: true, friend: true, acquaintance: false, intending: false },
      [Audience.Close]: { close: true, friend: false, acquaintance: false, intending: false },
      [Audience.OnlyMe]: { close: false, friend: false, acquaintance: false, intending: false },
    }
    for (const a of AUDIENCES) for (const r of [Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending]) {
      expect([a, r, audienceAdmits(a, r)]).toEqual([a, r, table[a][r]])
    }
  })
  it('a value this build does not know admits nobody (fail closed), as an older build reads "close"', () => {
    for (const r of [Ring.Close, Ring.Friend, Ring.Acquaintance]) expect(audienceAdmits('someday', r)).toBe(false)
  })
  it('what an asker is matched against follows the tier, for things and for notes about people', () => {
    const s = phone(
      [item('a', Audience.FriendsOfFriends), item('f', Audience.Friends), item('c', Audience.Close), item('m', Audience.OnlyMe), item('off', Audience.FriendsOfFriends, false)],
      [{ id: 'l1', text: 'Offers a body-work session', tag: 'offer', audience: Audience.Close, status: LineStatus.Current, notedAt: NOW, checkedAt: NOW }],
    )
    expect(matched(s, Ring.Acquaintance)).toEqual(['inv:a'])
    expect(matched(s, Ring.Friend)).toEqual(['inv:a', 'inv:f'])
    expect(matched(s, Ring.Close).length).toBe(4)
    expect(matched(s, Ring.Close)).toContain('inv:c')
    expect(matched(s, Ring.Close).some((id) => id.includes('l1'))).toBe(true)
    expect(matched(s, Ring.Friend).some((id) => id.includes('l1'))).toBe(false)
  })
})

describe('item 6: how people connect, said plainly', () => {
  const all = JSON.stringify(S, (_k, v) => (typeof v === 'function' ? v.toString() : v))
  it('never says UWB; the code button says QR code and link', () => {
    expect(/UWB/i.test(all)).toBe(false)
    expect(S.qrOpen).toBe('Show my code (QR code and link)')
    expect(/QR or NFC/.test(all)).toBe(false)
  })
  it('a moving QR code is "coming soon"; NFC, Bluetooth and AirDrop are "coming later"', () => {
    expect(S.meetWaysSoon).toMatch(/Coming soon: a moving QR code/)
    expect(S.meetWaysLater).toMatch(/Coming later: NFC, Bluetooth and AirDrop/)
    expect(S.hintText.qr).toMatch(/moving QR code is coming soon; NFC, Bluetooth and AirDrop come later/)
  })
})

describe('item 7: "Search the web instead"', () => {
  it('builds each engine\'s https search link with the words encoded', () => {
    expect(SEARCH_ENGINES).toEqual([SearchEngine.Google, SearchEngine.Ecosia, SearchEngine.Qwant, SearchEngine.Brave])
    expect(webSearchUrl(SearchEngine.Google, 'cargo bike & <trailer>')).toBe('https://www.google.com/search?q=cargo%20bike%20%26%20%3Ctrailer%3E')
    expect(webSearchUrl(SearchEngine.Ecosia, 'a/b?c=d#e')).toBe('https://www.ecosia.org/search?q=a%2Fb%3Fc%3Dd%23e')
    expect(webSearchUrl(SearchEngine.Qwant, 'Wien')).toBe('https://www.qwant.com/?q=Wien')
    expect(webSearchUrl(SearchEngine.Brave, 'Räder')).toBe('https://search.brave.com/search?q=R%C3%A4der')
    for (const e of SEARCH_ENGINES) expect(webSearchUrl(e, 'x').startsWith('https://')).toBe(true)
  })
  it('no words, no link; spaces collapsed; at most 200 characters go out', () => {
    for (const e of SEARCH_ENGINES) expect(webSearchUrl(e, '  \n\t ')).toBe(null)
    expect(webSearchUrl(SearchEngine.Google, '  two   words \n')).toBe('https://www.google.com/search?q=two%20words')
    expect(decodeURIComponent(webSearchUrl(SearchEngine.Google, 'y'.repeat(500)).split('q=')[1]).length).toBe(200)
  })
})

describe('item 8: the three provenance states', () => {
  const importFile = (items) => JSON.stringify({ format: 'trustweb-inventory-import', version: 1, exportedOn: '2026-10-07', items })
  function imported() {
    const s = { ...phone([item('t', Audience.Friends)]), inventory: [{ ...item('t', Audience.Friends), source: { kind: Provenance.Typed } }] }
    let n = 0
    const parsed = parseImportFile(importFile([{ key: '0123456789abcdef', text: 'Knows the Graz housing co-op board' }, { key: 'fedcba9876543210', text: 'Can lend a cargo bike' }]))
    const batch = applyImport(s, planImport(s, parsed), NOW, () => 'id' + ++n)
    return { s, batch }
  }
  it('imported lines are unreviewed; recorded and typed ones were created step by step; demo and shared have none', () => {
    expect(provenanceState({ kind: Provenance.Tana, ref: 'x' })).toBe(ProvenanceState.Unreviewed)
    expect(provenanceState({ kind: Provenance.Tana, ref: 'x', reviewedAt: NOW })).toBe(ProvenanceState.MassImported)
    for (const kind of [Provenance.RecordedSolo, Provenance.RecordedMeeting, Provenance.Typed]) expect(provenanceState({ kind })).toBe(ProvenanceState.StepByStep)
    for (const kind of [Provenance.Demo, Provenance.SharedByPerson]) expect(provenanceState({ kind })).toBe(null)
    expect(provenanceState(undefined)).toBe(null)
  })
  it('"Reviewed" keeps an imported line, once; nothing else is touched', () => {
    const { s } = imported()
    const line = s.inventory.find((i) => i.source?.kind === Provenance.Tana)
    expect(markReviewed(line, NOW + 1)).toBe(true)
    expect(provenanceState(line.source)).toBe(ProvenanceState.MassImported)
    expect(markReviewed(line, NOW + 2)).toBe(false)
    expect(line.source.reviewedAt).toBe(NOW + 1)
    const typed = s.inventory.find((i) => i.source?.kind === Provenance.Typed)
    expect(markReviewed(typed, NOW)).toBe(false)
    expect('reviewedAt' in typed.source).toBe(false)
  })
  it('"Mark all reviewed" does one import\'s lines; an unknown batch does nothing', () => {
    const { s, batch } = imported()
    expect(markBatchReviewed(s, batch.id, NOW)).toBe(2)
    expect(markBatchReviewed(s, batch.id, NOW)).toBe(0)
    expect(markBatchReviewed(s, 'nope', NOW)).toBe(0)
    expect(s.inventory.filter((i) => provenanceState(i.source) === ProvenanceState.MassImported).length).toBe(2)
  })
  it('DECISION: reviewing is not a change, so Undo import still removes the unchanged lines', () => {
    const { s, batch } = imported()
    markBatchReviewed(s, batch.id, NOW)
    expect(undoImport(s, batch.id)).toEqual({ removed: 2, kept: 0 })
    expect(s.inventory.length).toBe(1)
  })
  it('the review state never reaches an answer (an answer carries text, context and a coarse date only)', () => {
    const { s, batch } = imported()
    for (const i of s.inventory) i.audience = Audience.FriendsOfFriends
    const before = JSON.stringify(sharedItems([...threadsForRing(s, Ring.Friend).refs.values()]))
    markBatchReviewed(s, batch.id, NOW)
    const after = JSON.stringify(sharedItems([...threadsForRing(s, Ring.Friend).refs.values()]))
    expect(after).toBe(before)
    expect(/reviewed|tana|0123456789abcdef/i.test(after)).toBe(false)
  })
})
