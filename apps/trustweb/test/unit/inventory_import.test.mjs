/**
 * Import inventory file (wave 1733 round B, A4 + A8 f): the file is checked
 * (format, version, size, shape), lines land as "Only me" from Tana with the
 * key kept, re-import is idempotent by key (even after an edit) and by text,
 * Undo removes exactly what the import added and the person did not change,
 * and nothing of an imported line (key, provenance) can reach an answer.
 */
import { applyImport, IMPORTS_KEPT, ImportProblem, lastImport, normalise, parseImportFile, planImport, undoImport } from '../../src/inventory_import.ts'
import { Audience, Ring, sharedItems, threadsForRing } from '../../src/model.ts'

const file = (items, extra = {}) => JSON.stringify({ format: 'trustweb-inventory-import', version: 1, exportedOn: '2026-10-06', items, ...extra })
const ln = (key, text, allowedInAdvance = false) => ({ key, text, audience: 'me', provenance: 'tana', allowedInAdvance })
const K1 = '0123456789abcdef'
const K2 = 'fedcba9876543210'
const K3 = 'aaaaaaaaaaaaaaaa'
const state = () => ({ v: 1, me: { id: 'me', displayName: 'Jakob' }, people: [], peers: [], inventory: [{ id: 'own', text: 'Motorbike, weekends', audience: 'fof', included: true, createdAt: 1, source: { kind: 'typed' } }], log: [], notificationsOn: false })
let n = 0
const ids = () => 'id' + ++n

describe('import file', () => {
  it('refuses anything else, plainly', () => {
    expect(parseImportFile('not json')).toBe(ImportProblem.NotJson)
    expect(parseImportFile(JSON.stringify({ format: 'other', version: 1, items: [] }))).toBe(ImportProblem.WrongFormat)
    expect(parseImportFile(file([ln(K1, 'x y z')], { version: 2 }))).toBe(ImportProblem.WrongVersion)
    expect(parseImportFile(file([{ key: 'short', text: 'x' }, { key: K1, text: '   ' }]))).toBe(ImportProblem.Empty)
    expect(parseImportFile('x'.repeat(1_000_001))).toBe(ImportProblem.TooBig)
  })
  it('reads the lines, cuts text at 160, counts what it could not read, ignores unknown fields', () => {
    const p = parseImportFile(file([ln(K1, 'a'.repeat(200), true), { nope: 1 }, { ...ln(K2, 'Second'), later: 'field' }]))
    expect(p.lines.map((l) => [l.key, l.text.length, l.allowedInAdvance])).toEqual([[K1, 160, true], [K2, 6, false]])
    expect(p.unreadable).toBe(1)
    expect(p.exportedOn).toBe('2026-10-06')
  })
  it('normalises like the Mac side', () => {
    expect(normalise('  **Knows**  the [[Graz]]   co-op ')).toBe('knows the graz co-op')
  })
})

describe('import into the inventory', () => {
  it('a summary first (nothing written), then Only me, from Tana, the key kept', () => {
    const s = state()
    const plan = planImport(s, parseImportFile(file([ln(K1, 'Knows the Graz co-op'), ln(K2, 'motorbike,  weekends'), ln(K3, 'Knows the Graz co-op')])))
    expect(plan.add.map((l) => l.key)).toEqual([K1])
    expect(plan.already).toBe(2)
    expect(s.inventory.length).toBe(1)
    const batch = applyImport(s, plan, 5, ids)
    const item = s.inventory[0]
    expect(item).toMatchObject({ text: 'Knows the Graz co-op', audience: Audience.OnlyMe, included: true, createdAt: 5, source: { kind: 'tana', ref: K1 } })
    expect(s.imports[0]).toBe(batch)
    expect(batch.items).toEqual([{ itemId: item.id, key: K1, text: 'Knows the Graz co-op', audience: 'me' }])
  })
  it('re-import is idempotent, by key even after the text was edited', () => {
    const s = state()
    applyImport(s, planImport(s, parseImportFile(file([ln(K1, 'Knows the Graz co-op')]))), 5, ids)
    s.inventory[0].text = 'Knows the Graz co-op board (edited)'
    const again = planImport(s, parseImportFile(file([ln(K1, 'Knows the Graz co-op'), ln(K2, 'New line here')])))
    expect(again.add.map((l) => l.key)).toEqual([K2])
    expect(again.already).toBe(1)
  })
  it('Undo removes exactly what it added and the person did not change', () => {
    const s = state()
    const b = applyImport(s, planImport(s, parseImportFile(file([ln(K1, 'One line'), ln(K2, 'Two line'), ln(K3, 'Three line')]))), 5, ids)
    const two = s.inventory.find((i) => i.text === 'Two line')
    two.audience = Audience.Friends
    const three = s.inventory.find((i) => i.text === 'Three line')
    three.text = 'Three line, edited'
    expect(undoImport(s, b.id)).toEqual({ removed: 1, kept: 2 })
    expect(s.inventory.map((i) => i.text).sort()).toEqual(['Motorbike, weekends', 'Three line, edited', 'Two line'])
    expect(s.imports).toBe(undefined)
    expect(undoImport(s, b.id)).toEqual({ removed: 0, kept: 0 })
  })
  it('keeps the last batches only, and reads odd shapes without throwing', () => {
    const s = state()
    for (let i = 0; i < IMPORTS_KEPT + 3; i++) applyImport(s, { exportedOn: '', add: [{ key: (i + 1e15).toString(16).padStart(16, '0').slice(-16), text: 'line ' + i, allowedInAdvance: false }], already: 0, unreadable: 0, allowedInAdvance: 0 }, i, ids)
    expect(s.imports.length).toBe(IMPORTS_KEPT)
    expect(lastImport({ imports: [null, { id: 'x', items: [] }] })?.id).toBe('x')
    expect(lastImport({ imports: 'odd' })).toBe(null)
    expect(lastImport({})).toBe(null)
  })
  it('an imported line never reaches an answer as it lands (Only me), and its key or provenance never does', () => {
    const s = state()
    applyImport(s, planImport(s, parseImportFile(file([ln(K1, 'Knows the Graz co-op')]))), 5, ids)
    expect(threadsForRing(s, Ring.Close).threads.some((t) => /Graz/.test(t.messages[0].text))).toBe(false)
    s.inventory[0].audience = Audience.FriendsOfFriends
    const { refs } = threadsForRing(s, Ring.Close)
    const out = JSON.stringify(sharedItems([...refs.values()]))
    expect(out).toContain('Graz')
    expect(out).not.toContain(K1)
    expect(out).not.toContain('tana')
  })
})
