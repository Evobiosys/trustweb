/** Dismissible notices (src/notices.ts, wave 15): per-note dismissal, the general switch, the cap, and an emptied list being dropped. */
import { ALL_NOTICES, DISMISSED_MAX, PASS_ON_DEFAULT_NOTICE, dismissNotice, namePreviousId, passOnDefaultNoticeDue, noticeShown, noticesOff, setNoticesOff } from '../../src/notices.ts'

describe('notices', () => {
  it('shows a note until its id is dismissed; other notes stay', () => {
    const s = {}
    expect(noticeShown(s, namePreviousId('ada'))).toBe(true)
    dismissNotice(s, namePreviousId('ada'))
    dismissNotice(s, namePreviousId('ada'))
    expect(s.dismissed).toEqual(['name-previous:ada'])
    expect(noticeShown(s, namePreviousId('ada'))).toBe(false)
    expect(noticeShown(s, namePreviousId('bob'))).toBe(true)
  })
  it('"all-notices" silences every note; switching it off restores them and drops an empty list', () => {
    const s = {}
    setNoticesOff(s, true)
    expect(s.dismissed).toEqual([ALL_NOTICES])
    expect(noticesOff(s)).toBe(true)
    expect(noticeShown(s, namePreviousId('x'))).toBe(false)
    setNoticesOff(s, false)
    expect(s).not.toHaveProperty('dismissed')
    expect(noticeShown(s, namePreviousId('x'))).toBe(true)
  })
  it('switching off keeps single dismissals; the list is capped, the switch survives the cap', () => {
    const s = { dismissed: ['name-previous:a'] }
    setNoticesOff(s, true)
    setNoticesOff(s, false)
    expect(s.dismissed).toEqual(['name-previous:a'])
    for (let i = 0; i < DISMISSED_MAX + 20; i += 1) dismissNotice(s, `n:${i}`)
    expect(s.dismissed).toHaveLength(DISMISSED_MAX)
    setNoticesOff(s, true)
    expect(s.dismissed).toHaveLength(DISMISSED_MAX)
    expect(noticesOff(s)).toBe(true)
  })
})

describe('pass-on default notice (wave 27, D2)', () => {
  const p = (ring, extra) => ({ id: 'x', name: 'x', ring, peerId: 'q', ...extra })
  it('is due once for a connected person whose pass-on was never set and whose zone lost the default', () => {
    const s = { people: [p('friend')] }
    expect(passOnDefaultNoticeDue(s)).toBe(true)
    dismissNotice(s, PASS_ON_DEFAULT_NOTICE)
    expect(passOnDefaultNoticeDue(s)).toBe(false)
  })
  it('is not due when nobody was affected (Close/Closest, an explicit value, not connected) or notices are off', () => {
    expect(passOnDefaultNoticeDue({ people: [p('close'), p('closest'), p('friend', { passOn: false }), p('friend', { peerId: undefined })] })).toBe(false)
    expect(passOnDefaultNoticeDue({ people: [p('friend')], dismissed: [ALL_NOTICES] })).toBe(false)
  })
})
