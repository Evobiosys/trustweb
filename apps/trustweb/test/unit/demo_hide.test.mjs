/** Hide / show demo content without losing it (src/demo_hide.ts, Jakob 2026-10-19: "show or hide demo content"). */
import { Audience, Ring } from '../../src/model.ts'
import { hideDemoContent, showDemoContent } from '../../src/demo_hide.ts'

const NOW = 1_760_000_000_000
const person = (id, extra = {}) => ({ id, name: id, context: '', ring: Ring.Friend, metAt: NOW, lines: [], ...extra })
const thing = (id) => ({ id, text: id, audience: Audience.Friends, included: true, createdAt: NOW })
const state = () => ({
  v: 1, me: { id: 'me', displayName: 'J' }, peers: [], log: [], notificationsOn: false,
  people: [person('real'), person('dummy-a'), person('dummy-b', { lines: [{ id: 'l', text: 'note on a dummy' }] }), person('linked', { peerId: 'peer-1' })],
  inventory: [thing('mine'), thing('demo-thing')],
  demo: { people: ['dummy-a', 'dummy-b', 'linked'], inventory: ['demo-thing'] },
})

describe('hide and show demo content', () => {
  it('hide takes the demo-marked people and things out of view and keeps them, with their notes, in the stash', () => {
    const s = state()
    expect(hideDemoContent(s)).toBe(true)
    expect(s.people.map((p) => p.id)).toEqual(['real', 'linked'])  // a connected person (peerId) is never demo content
    expect(s.inventory.map((i) => i.id)).toEqual(['mine'])
    expect(s.demoHidden.people.map((p) => p.id)).toEqual(['dummy-a', 'dummy-b'])
    expect(s.demoHidden.people[1].lines[0].text).toBe('note on a dummy')
    expect(s.demo).toEqual(state().demo)  // the marking stays, so isDemoPerson keeps saying so
  })
  it('show puts them back; both are no-ops when there is nothing to do', () => {
    const s = state()
    hideDemoContent(s)
    expect(hideDemoContent(s)).toBe(false)
    expect(showDemoContent(s)).toBe(true)
    expect(s.demoHidden).toBeUndefined()
    expect(s.people.map((p) => p.id).sort()).toEqual(['dummy-a', 'dummy-b', 'linked', 'real'])
    expect(s.inventory.map((i) => i.id).sort()).toEqual(['demo-thing', 'mine'])
    expect(showDemoContent(s)).toBe(false)
    const none = { ...state(), demo: undefined }
    expect(hideDemoContent(none)).toBe(false)
    expect(none.demoHidden).toBeUndefined()
  })
})
