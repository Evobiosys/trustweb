/** Wave 7: the Manage outliner's fields (outliner_fields.ts): placement, values, TrustWeb icon, favourite link. */
import { Channel, Ring } from '../../src/model.ts'
import { ChatDirection } from '../../src/chat.ts'
import { F_CONTEXT, F_FAVOURITE, F_FIRST, F_LAST, F_RING, SLOTS, favouriteLink, moveField, presence, reconcile, sections, setValue, value } from '../../src/outliner_fields.ts'

const DAY = 86_400_000
const person = (o = {}) => ({ id: 'p', name: 'Anna Maria Meier', context: 'Hub', ring: Ring.Friend, metAt: 0, lines: [], ...o })

describe('layout', () => {
  it('defaults: five simple fields, every other field advanced, each once, Tana Last Name replaced', () => {
    const l = reconcile(null)
    expect(l.simple).toEqual([F_FIRST, F_LAST, F_CONTEXT, F_RING, F_FAVOURITE])
    expect(l.simple.length + l.advanced.length).toBe(SLOTS.length)
    expect(l.advanced).not.toContain('kb0JInYEW2lD')
  })
  it('drops unknown and duplicate ids, adds missing ones', () => {
    const l = reconcile({ simple: [F_RING, 'nope', F_RING], advanced: [F_FIRST] })
    expect(l.simple).toEqual([F_RING, F_LAST, F_CONTEXT, F_FAVOURITE])
    expect(l.advanced[0]).toBe(F_FIRST)
  })
  it('moves within and across sections', () => {
    const l = reconcile(null)
    const adv = l.advanced[0]
    const across = moveField(l, adv, 'simple', F_LAST)
    expect(across.simple.indexOf(adv)).toBe(1)
    expect(across.advanced).not.toContain(adv)
    expect(moveField(l, F_RING, 'simple', F_FIRST).simple[0]).toBe(F_RING)
    expect(moveField(l, F_RING, 'advanced', null).advanced.at(-1)).toBe(F_RING)
  })
  it('a field with a value shows in simple too, otherwise stays advanced', () => {
    const p = person({ fields: { Bxw7k4FWptqp: 'a@b.eu' } })
    const s = sections(p, reconcile(null))
    expect(s.simple.at(-1)).toBe('Bxw7k4FWptqp')
    expect(s.advanced).not.toContain('Bxw7k4FWptqp')
    expect(sections(person(), reconcile(null)).advanced).toContain('Bxw7k4FWptqp')
  })
})

describe('values', () => {
  it('first and last name come from and go back into the name', () => {
    const p = person()
    expect([value(p, F_FIRST), value(p, F_LAST)]).toEqual(['Anna', 'Maria Meier'])
    setValue(p, F_LAST, 'Huber')
    expect(p.name).toBe('Anna Huber')
  })
  it('other fields land in fields, empty removes, old records need nothing', () => {
    const p = person()
    setValue(p, 'tw-phone', ' +43 660 1 ')
    expect(p.fields).toEqual({ 'tw-phone': '+43 660 1' })
    setValue(p, 'tw-phone', '')
    expect(p.fields).toEqual({})
    expect(value(person(), 'tw-phone')).toBe('')
  })
})

describe('presence', () => {
  const now = 100 * DAY
  const chats = (at) => ({ q: { unread: 0, messages: [{ dir: ChatDirection.In, at }, { dir: ChatDirection.Out, at: now }] } })
  it('none without a peer; active within seven days of their last message; else quiet', () => {
    expect(presence({}, person(), now)).toBeNull()
    expect(presence({ chats: chats(now - 6 * DAY) }, person({ peerId: 'q' }), now)).toBe('active')
    expect(presence({ chats: chats(now - 8 * DAY) }, person({ peerId: 'q' }), now)).toBe('quiet')
    expect(presence({}, person({ peerId: 'q' }), now)).toBe('quiet')
  })
})

describe('favourite link', () => {
  const fav = (id, extra = {}) => person({ fields: { [F_FAVOURITE]: id, ...extra.fields }, channels: extra.channels })
  it('builds the deep link per way', () => {
    expect(favouriteLink(fav('email', { fields: { Bxw7k4FWptqp: 'A@B.eu' } })).href).toBe('mailto:a@b.eu')
    expect(favouriteLink(fav('call', { fields: { 'tw-phone': '+43 660 1234567' } })).href).toBe('tel:+436601234567')
    expect(favouriteLink(fav('sms', { fields: { 'tw-phone': '+436601234567' } })).href).toBe('sms:+436601234567')
    expect(favouriteLink(fav('signal', { channels: { [Channel.Signal]: '+436601234567' } })).href).toBe('https://signal.me/#p/+436601234567')
    expect(favouriteLink(fav('whatsapp', { channels: { [Channel.WhatsApp]: '+436601234567' } })).href).toBe('https://wa.me/436601234567')
    expect(favouriteLink(fav('matrix', { channels: { [Channel.Matrix]: '@a:b.org' } })).href).toBe('https://matrix.to/#/@a:b.org')
  })
  it('none when no favourite, or its value is missing or unusable', () => {
    expect(favouriteLink(person())).toBeNull()
    expect(favouriteLink(fav('call'))).toBeNull()
    expect(favouriteLink(fav('email', { fields: { Bxw7k4FWptqp: 'x?body=1@b.eu' } }))).toBeNull()
    expect(favouriteLink(fav('signal'))).toBeNull()
  })
})
