/** Wave 7: intending to connect is always allowed; a plain reminder shows only what is true (contact details here, a message already sent). */
import { ChatDirection } from '../../src/chat.ts'
import { EMAIL_FIELD, intendingReminder, knownWays, lastMessagedAt } from '../../src/intending_reminder.ts'

describe('intending reminder', () => {
  it('names the ways already known: email field, Curator points, typed or shared messengers', () => {
    expect(knownWays({})).toEqual([])
    expect(knownWays({ fields: { [EMAIL_FIELD]: 'a@b.eu' } })).toEqual(['email'])
    expect(knownWays({ channels: { signal: 'x' }, theirChannels: { matrix: '@a:b.c' } }, [{ kind: 'phone' }])).toEqual(['phone', 'Signal', 'Matrix'])
  })
  it('the last message I sent', () => {
    expect(lastMessagedAt(undefined)).toBe(0)
    expect(lastMessagedAt({ unread: 0, messages: [{ dir: ChatDirection.Out, at: 5 }, { dir: ChatDirection.In, at: 9 }, { dir: ChatDirection.Out, at: 7 }] })).toBe(7)
  })
  it('only the true lines, plain text', () => {
    expect(intendingReminder('Anna', [], 0)).toEqual([])
    expect(intendingReminder('Anna', ['email', 'Signal'], 0)).toEqual(['You already have contact details for Anna (email / Signal)'])
    expect(intendingReminder('Anna', [], Date.UTC(2026, 9, 3))).toEqual(['You already messaged Anna here (2026-10-03)'])
  })
})
