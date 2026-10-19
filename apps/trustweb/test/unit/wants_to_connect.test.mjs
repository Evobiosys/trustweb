/** Wave 16 "Wants to connect": a reach-out makes a row, not a person; Add makes the Person; Dismiss archives; Restore puts the row back. */
import { Ring } from '../../src/model.ts'
import { acceptWant, addWant, dismissWant } from '../../src/wants_to_connect.ts'

const fresh = () => ({ people: [] })
const ada = { peerId: 'p1', name: 'Ada', at: 1000 }

describe('wants to connect', () => {
  it('a reach-out adds one row and no person; the same peer again keeps one row', () => {
    const s = fresh()
    addWant(s, ada)
    addWant(s, { ...ada, at: 2000 })
    expect(s.wantsToConnect).toEqual([ada])
    expect(s.people).toEqual([])
  })

  it('Add makes the Person on the picked ring with the peerId and drops the row', () => {
    const s = fresh()
    addWant(s, ada)
    const p = acceptWant(s, 'p1', '', Ring.Friend, 'id1')
    expect(p).toMatchObject({ id: 'id1', name: 'Ada', ring: Ring.Friend, peerId: 'p1' })
    expect(s.people).toEqual([p])
    expect(s.wantsToConnect).toBeUndefined()
    expect(acceptWant(s, 'p1', '', Ring.Friend, 'id2')).toBeNull()
  })

  it('Dismiss makes a not-connected archive entry carrying the row; Restore (addWant of it) brings the row back', () => {
    const s = fresh()
    addWant(s, ada)
    addWant(s, { peerId: 'p2', name: 'Ben', at: 3000 })
    const p = dismissWant(s, 'p1', 'id1')
    expect(p.peerId).toBeUndefined()
    expect(p.wantsToConnect).toEqual(ada)
    expect(s.wantsToConnect.map((w) => w.peerId)).toEqual(['p2'])
    addWant(s, p.wantsToConnect)
    expect(s.wantsToConnect.map((w) => w.peerId)).toEqual(['p2', 'p1'])
  })
})
