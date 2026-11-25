// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-bubble-connect-2: the gate end to end between three fake phones. Requester = dragged, acceptor = dropped onto. */
import { createBubbleConnect } from '../../src/bubble_connect_view.ts'
import { parseGateText } from '../../src/bubble_gate.ts'

vi.mock('../../../demo/src/ui/dom', () => ({
  el: (tag, attrs = {}, kids = []) => ({ tag, attrs, kids }),
}))
globalThis.document = { createElementNS: () => ({}) }

const app = 'https://app.test/'
const peers = [{ id: 'peer-a', did: 'did:peer:2.a', displayName: 'Ada' }, { id: 'peer-b', did: 'did:peer:2.b', displayName: 'Ben' }]
const P = (id, extra = {}) => ({ id, name: id === 'a' ? 'Ada' : 'Ben', ring: 'friend', peerId: `peer-${id}`, ...extra })
const flat = (n) => (n.kids ?? []).flatMap((k) => (typeof k === 'string' ? [k] : [k, ...flat(k)]))
const button = (sheet, attr) => flat(sheet[0]).find((n) => n.attrs && attr in n.attrs)

function phone(state) {
  const out = { protocol: [], chat: [], toasts: [], sheet: null, connected: [] }
  const d = {
    st: () => state, save: () => {}, render: () => {}, openSheet: (n) => { out.sheet = n }, closeSheet: () => { out.sheet = null }, toast: (m) => out.toasts.push(m), appUrl: app,
    send: async (peerId, text) => { out.chat.push({ peerId, text }); return true },
    sendProtocol: async (peerId, text) => { out.protocol.push({ peerId, text }) },
    connectVia: (link) => out.connected.push(link),
  }
  return { out, bc: createBubbleConnect(d), state }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('introduction gate: the dragged one asks, the dropped-onto one accepts', () => {
  const introducer = () => phone({ me: { id: 'me', displayName: 'Jakob' }, people: [P('a'), P('b')], peers, log: [] })

  it('the sheet names the direction; Ask sends ONLY the request to the acceptor, the requester is told, no code yet', async () => {
    const m = introducer()
    m.bc.introduce('a', 'b')
    expect(flat(m.out.sheet[0]).some((n) => typeof n === 'string' && n.includes('Introduce Ada to Ben?'))).toBe(true)
    button(m.out.sheet, 'data-introduce-yes').attrs.onclick()
    await tick(); await tick()
    expect(m.out.protocol).toHaveLength(1)
    expect(m.out.protocol[0].peerId).toBe('peer-b')
    const req = parseGateText(app, m.out.protocol[0].text)
    expect(req).toMatchObject({ k: 'req', name: 'Ada' })
    expect(req.link).toContain(encodeURIComponent('did:peer:2.a'))
    expect(m.out.chat).toHaveLength(1)
    expect(m.out.chat[0].peerId).toBe('peer-a')
    expect(m.out.chat[0].text).toContain('asked Ben for you')
    expect(m.out.chat[0].text).not.toContain('did')
    expect(m.state.introPending).toHaveLength(1)
  })

  it('acceptance gate: the requester gets the acceptor\'s code only after the yes, and only from the acceptor', async () => {
    const m = introducer()
    m.bc.introduce('a', 'b')
    button(m.out.sheet, 'data-introduce-yes').attrs.onclick()
    await tick(); await tick()
    const id = parseGateText(app, m.out.protocol[0].text).id
    const yes = `${app}?introduce=1#k=ok&i=${id}`
    m.bc.receive('peer-a', yes) // not the acceptor: ignored
    expect(m.out.chat).toHaveLength(1)
    expect(m.state.introPending).toHaveLength(1)
    m.bc.receive('peer-b', yes)
    expect(m.out.chat).toHaveLength(2)
    expect(m.out.chat[1].peerId).toBe('peer-a')
    expect(m.out.chat[1].text).toContain(encodeURIComponent('did:peer:2.b'))
    expect(m.out.chat[1].text).toContain('acq=1')
    expect(m.state.introPending).toBeUndefined()
    m.bc.receive('peer-b', yes) // a replay does nothing
    expect(m.out.chat).toHaveLength(2)
  })

  it('a decline sends no code to anyone', async () => {
    const m = introducer()
    m.bc.introduce('a', 'b')
    button(m.out.sheet, 'data-introduce-yes').attrs.onclick()
    await tick(); await tick()
    const id = parseGateText(app, m.out.protocol[0].text).id
    m.bc.receive('peer-b', `${app}?introduce=1#k=no&i=${id}`)
    expect(m.out.chat).toHaveLength(1)
    expect(m.out.toasts.at(-1)).toContain('declined')
    expect(m.state.introPending).toBeUndefined()
  })

  // wave47 invite-fits-chat: the notice names why it could not go out; "No connection" (S.chatOffline) is for the transport alone, where the message really waits.
  for (const [thrown, says] of [['blocked', 'You blocked this person'], ['no peer', 'not connected with this person'], ['relay exploded', 'could not be sent']]) {
    it(`when the request cannot go out (${thrown}) nothing stays pending, the requester is not told, and the notice says why`, async () => {
      const f = phone({ me: { id: 'me', displayName: 'Jakob' }, people: [P('a'), P('b')], peers, log: [] })
      const bad = createBubbleConnect({ ...{ st: () => f.state, save() {}, render() {}, openSheet: (n) => { f.out.sheet = n }, closeSheet() {}, toast: (x) => f.out.toasts.push(x), appUrl: app, send: async () => true, connectVia() {} }, sendProtocol: async () => { throw new Error(thrown) } })
      bad.introduce('a', 'b')
      button(f.out.sheet, 'data-introduce-yes').attrs.onclick()
      await tick(); await tick()
      expect(f.state.introPending).toBeUndefined()
      expect(f.out.toasts.at(-1)).toContain(says)
      expect(f.out.toasts.at(-1)).not.toContain('No connection')
    })
  }

  it('the acceptor sees "<requester> would like to connect with you, introduced by <me>"; Accept answers ok and connects the requester', async () => {
    const link = `${app}?connect=${encodeURIComponent('did:peer:2.a')}&id=peer-a&name=Ada&acq=1`
    const b = phone({ me: { id: 'bme', displayName: 'Ben' }, people: [{ id: 'j', name: 'Jakob', ring: 'friend', peerId: 'peer-j' }], peers: [{ id: 'peer-j', did: 'did:peer:2.j', displayName: 'Jakob' }], log: [] })
    const text = `${app}?introduce=1#k=req&i=i1&n=Ada&c=${encodeURIComponent(link)}`
    b.bc.receive('peer-j', text)
    expect(flat(b.out.sheet[0]).some((n) => typeof n === 'string' && n.includes('Ada would like to connect with you, introduced by Jakob'))).toBe(true)
    expect(b.out.connected).toHaveLength(0) // nothing before the tap
    button(b.out.sheet, 'data-introduce-accept').attrs.onclick()
    await tick(); await tick()
    expect(parseGateText(app, b.out.protocol[0].text)).toEqual({ k: 'ok', id: 'i1' })
    expect(b.out.protocol[0].peerId).toBe('peer-j')
    expect(b.out.connected).toEqual([link])
    expect(b.state.introInbox).toBeUndefined()
  })

  it('Decline answers no and connects nobody; a request with a foreign link is ignored', async () => {
    const link = `${app}?connect=${encodeURIComponent('did:peer:2.a')}&id=peer-a&name=Ada&acq=1`
    const b = phone({ me: { id: 'bme', displayName: 'Ben' }, people: [], peers: [], log: [] })
    b.bc.receive('peer-j', `${app}?introduce=1#k=req&i=i2&n=Ada&c=${encodeURIComponent(`${app}?nothing=1`)}`)
    expect(b.out.sheet).toBeNull()
    b.bc.receive('peer-j', `${app}?introduce=1#k=req&i=i1&n=Ada&c=${encodeURIComponent(link)}`)
    button(b.out.sheet, 'data-introduce-decline').attrs.onclick()
    await tick(); await tick()
    expect(parseGateText(app, b.out.protocol[0].text)).toEqual({ k: 'no', id: 'i1' })
    expect(b.out.connected).toHaveLength(0)
  })
})
