/**
 * Past meetings and demo content (src/model.ts, owner 2026-10-06): stored
 * meetings come back newest first; notes saved before meetings were stored
 * are listed by person and day, so an earlier meeting with its place is found
 * again; demo content is marked and, for a demo account, is all that can be
 * matched while the setting says so.
 */
import {
  AboutKind, Audience, LineStatus, Ring, Tag, audienceAdmits, demoAccountScope, demoOnlyForDemoAccounts,
  isDemoItem, isDemoPerson, pastMeetings, threadIsDemo, threadsForRing,
} from '../../src/model.ts'

const DAY = 86_400_000
const line = (text, notedAt, audience = Audience.Friends) => ({ id: text, text, tag: Tag.Note, audience, status: LineStatus.Current, notedAt, checkedAt: notedAt })
const max = { id: 'max', name: 'Max', context: 'Café Prückel', ring: Ring.Friend, metAt: 1_000_000, lines: [line('Knows a 3D printer to borrow', 10 * DAY + 100), line('Looks for a flat', 10 * DAY + 200), line('Older note', 2 * DAY)] }
const anna = { id: 'anna', name: 'Anna', context: '', ring: Ring.Acquaintance, metAt: 0, lines: [] }
const state = () => ({
  v: 1, me: { id: 'me', displayName: 'Jakob' }, peers: [], people: [max, anna], log: [], notificationsOn: false,
  inventory: [{ id: 'bike', text: 'Motorbike', audience: Audience.FriendsOfFriends, included: true, createdAt: 1 }, { id: 'ladder', text: 'Ladder', audience: Audience.FriendsOfFriends, included: true, createdAt: 2 }],
})

describe('pastMeetings', () => {
  it('lists notes saved before meetings existed by person and day, with the place', () => {
    const list = pastMeetings({ people: [max, anna] })
    expect(list.map((m) => m.id)).toEqual(['notes:max:10', 'notes:max:2'])
    expect(list[0]).toMatchObject({ about: 'Max', personId: 'max', where: 'Café Prückel', kind: AboutKind.Who, meeting: false, transcript: [] })
    expect(list[0].lines.map((l) => l.text)).toEqual(['Knows a 3D printer to borrow', 'Looks for a flat'])
    expect(list[0].startedAt).toBe(10 * DAY + 100)
  })
  it('a stored meeting replaces the derived entry for the same person and day, newest first', () => {
    const stored = { id: 'm1', about: 'Max', kind: AboutKind.Who, personId: 'max', where: 'Café Prückel', startedAt: 10 * DAY, endedAt: 10 * DAY + 1000, durationMs: 1000, meeting: true, lines: [], transcript: [{ speaker: 1, atMs: 0, text: 'hello' }] }
    const list = pastMeetings({ people: [max], meetings: [stored] })
    expect(list.map((m) => m.id)).toEqual(['m1', 'notes:max:2'])
  })
  it('a person without notes makes no entry', () => expect(pastMeetings({ people: [anna] })).toEqual([]))
  it('a day whose notes all came from a stored meeting is not listed again once that meeting is deleted (review P1); typed notes still are', () => {
    const line = (id, text, day, source) => ({ id, text, tag: 'note', audience: 'friends', status: 'current', notedAt: day * DAY + 5, checkedAt: day * DAY, source })
    const lea = { id: 'lea', name: 'Lea', context: 'Vienna', ring: 'friend', metAt: 0, lines: [
      line('a', 'From the deleted meeting', 20, { kind: 'recorded-meeting', meetingId: 'gone' }),
      line('b', 'Also from it', 20, { kind: 'recorded-meeting', meetingId: 'gone', atMs: 5 }),
      line('c', 'Typed that day', 21, { kind: 'typed' }),
      line('d', 'From the meeting', 21, { kind: 'recorded-meeting', meetingId: 'gone' }),
    ] }
    expect(pastMeetings({ people: [lea] }).map((m) => m.id)).toEqual(['notes:lea:21'])
  })
})

describe('demo content', () => {
  const demo = { people: ['anna'], inventory: ['bike'] }
  it('marks the people and items the demo added', () => {
    expect(isDemoPerson({ demo }, 'anna')).toBe(true)
    expect(isDemoPerson({ demo }, 'max')).toBe(false)
    expect(isDemoItem({ demo }, 'bike')).toBe(true)
    expect(isDemoPerson({}, 'anna')).toBe(false)
  })
  it('reads a matcher thread id', () => {
    expect(threadIsDemo({ demo }, 'inv:bike')).toBe(true)
    expect(threadIsDemo({ demo }, 'note:anna:x')).toBe(true)
    expect(threadIsDemo({ demo }, 'note:max:x')).toBe(false)
  })
  it('demo accounts see only the demo content by default, and only while demo content is on', () => {
    expect(demoOnlyForDemoAccounts({})).toBe(true)
    expect(demoOnlyForDemoAccounts({ demoOnlyForDemoAccounts: false })).toBe(false)
    expect(demoAccountScope({})).toBeUndefined()
    expect(demoAccountScope({ demo, demoOnlyForDemoAccounts: false })).toBeUndefined()
    const scope = demoAccountScope({ demo })
    expect([...scope.people]).toEqual(['anna'])
    expect([...scope.inventory]).toEqual(['bike'])
  })
  it('a scoped match input holds the demo lines only: Max is not part of the demo', () => {
    const s = state()
    const all = threadsForRing(s, Ring.Friend).threads.map((t) => t.id)
    expect(all).toEqual(['inv:bike', 'inv:ladder', 'note:max:Knows a 3D printer to borrow', 'note:max:Looks for a flat', 'note:max:Older note'])
    const scoped = threadsForRing(s, Ring.Friend, demoAccountScope({ ...s, demo })).threads.map((t) => t.id)
    expect(scoped).toEqual(['inv:bike'])
    expect(audienceAdmits(Audience.Friends, Ring.Acquaintance)).toBe(false)
  })
})
