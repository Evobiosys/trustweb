/** Wave 7: the Manage outliner row (outliner_fields.ts): TrustWeb icon, favourite link. */
import { Channel, Ring } from '../../src/model.ts'
import { ChatDirection } from '../../src/chat.ts'
import { favouriteLink, presence } from '../../src/outliner_fields.ts'

const DAY = 86_400_000
const person = (o = {}) => ({ id: 'p', name: 'Anna Maria Meier', context: 'Hub', ring: Ring.Friend, metAt: 0, lines: [], ...o })

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
  const fav = (id, extra = {}) => person({ fields: { ['tw-favourite']: id, ...extra.fields }, channels: extra.channels })
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
