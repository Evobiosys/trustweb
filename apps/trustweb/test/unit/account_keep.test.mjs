/**
 * Wave 6 (U4 f, N5): a guest account stays (src/account_keep.ts). The HARD GUARD first: nothing changes for an account that is not kept.
 */
import { DEMO_LIFETIME_MS, timeLeft } from '../../src/demo_account.ts'
import {
  KEPT_HORIZON_MS, KeepNotice, dueForTakeDown, guestAsk, guestAsked, guestEnded, guestGranted, guestKept, isKept, isKeepText,
  keepAccount, keepText, parseKeepText, unkeepAccount,
} from '../../src/account_keep.ts'
import { routeText, TextKind } from '../../src/chat.ts'

const APP = 'https://app.example.test/'
const NOW = Date.UTC(2026, 9, 8)
const DAY = 86_400_000

/** The owner's end of an account, as main.ts demoExpiresAt reads it. */
const endOf = (a) => a.expiresAt ?? a.createdAt + DEMO_LIFETIME_MS

describe('the hard guard: an account that is not kept behaves exactly as before', () => {
  it('a record without `keep` is not kept, expires at its end, and an old one without an end reads as a week after creation', () => {
    const fresh = { id: 'a', name: 'Anna-demo', createdAt: NOW - 8 * DAY, expiresAt: NOW - DAY }
    const old = { id: 'b', name: 'Ben-test', createdAt: NOW - 8 * DAY }
    const young = { id: 'c', name: 'Cleo-demo', createdAt: NOW - DAY, expiresAt: NOW + 6 * DAY }
    expect([fresh, old, young].map(isKept)).toEqual([false, false, false])
    expect(dueForTakeDown([fresh, old, young], NOW, endOf).map((a) => a.id)).toEqual(['a', 'b'])
  })

  it('only the exact value true keeps: a truthy string or number from a hand-edited record does not', () => {
    for (const v of ['true', 1, 'yes', {}, null, undefined, false]) expect(isKept({ keep: v })).toBe(false)
    expect(isKept({ keep: true })).toBe(true)
  })

  it('the record round-trips: keeping adds only `keep` and a far end, nothing else changes', () => {
    const a = { id: 'a', name: 'Anna-demo', createdAt: NOW, expiresAt: NOW + 3 * DAY, peerId: 'p1' }
    const before = JSON.stringify(a)
    expect(keepAccount(a, NOW)).toBe(true)
    expect(Object.keys(a).sort()).toEqual(['createdAt', 'expiresAt', 'id', 'keep', 'name', 'peerId'])
    expect(a.expiresAt).toBe(NOW + KEPT_HORIZON_MS)
    expect(JSON.parse(before)).toMatchObject({ id: 'a', name: 'Anna-demo', createdAt: NOW, peerId: 'p1' })
  })
})

describe('the hard guard, exhaustively: the sweep takes down exactly the accounts the build before took down', () => {
  it('for 600 records without `keep` (with and without an end, past and future, odd values), the old rule and the new one agree', () => {
    const ends = [undefined, NOW - 400 * DAY, NOW - 1, NOW, NOW + 1, NOW + 7 * DAY, NOW + 1000 * DAY, Number.NaN]
    const created = [NOW - 900 * DAY, NOW - 8 * DAY, NOW - 6 * DAY, NOW]
    const records = []
    for (const e of ends) for (const c of created) for (let i = 0; i < 18; i++) {
      records.push({ id: `${records.length}`, name: 'x-demo', createdAt: c, ...(e === undefined ? {} : { expiresAt: e }), ...(i % 3 === 0 ? { peerId: 'p' } : {}) })
    }
    expect(records.length).toBeGreaterThanOrEqual(576)
    const old = records.filter((t) => endOf(t) <= NOW).map((t) => t.id)
    expect(dueForTakeDown(records, NOW, endOf).map((t) => t.id)).toEqual(old)
  })
})

describe('keeping and un-keeping', () => {
  it('a kept account is never due, however old; keeping twice changes nothing the second time', () => {
    const a = { id: 'a', name: 'Anna-demo', createdAt: NOW - 400 * DAY, expiresAt: NOW - 390 * DAY }
    expect(dueForTakeDown([a], NOW, endOf).length).toBe(1)
    expect(keepAccount(a, NOW)).toBe(true)
    expect(keepAccount(a, NOW + 5)).toBe(false)
    expect(a.expiresAt).toBe(NOW + KEPT_HORIZON_MS)
    expect(dueForTakeDown([a], NOW + 50 * 365 * DAY, endOf)).toEqual([])
    // even a build that ignores `keep` (it reads only the end) keeps it for a century
    expect(timeLeft(a.expiresAt, NOW + 50 * 365 * DAY).ended).toBe(false)
  })

  it('un-keeping gives a fresh week and removes `keep`; on an account that is not kept it does nothing', () => {
    const a = { id: 'a', name: 'Anna-demo', createdAt: NOW, expiresAt: NOW + DAY }
    expect(unkeepAccount(a, NOW, DEMO_LIFETIME_MS)).toBe(false)
    expect(a.expiresAt).toBe(NOW + DAY)
    keepAccount(a, NOW)
    expect(unkeepAccount(a, NOW + DAY, DEMO_LIFETIME_MS)).toBe(true)
    expect('keep' in a).toBe(false)
    expect(a.expiresAt).toBe(NOW + DAY + DEMO_LIFETIME_MS)
  })
})

describe('the guest\'s phone', () => {
  it('asks once; its own end stays until the owner says yes', () => {
    const t = { name: 'Jakob', createdAt: NOW, expiresAt: NOW + 2 * DAY }
    expect(guestAsk(t)).toBe(true)
    expect(guestAsk(t)).toBe(false)
    expect(guestAsked(t)).toBe(true)
    expect(t.expiresAt).toBe(NOW + 2 * DAY)
    expect(guestEnded(t, NOW + 3 * DAY)).toBe(true)
  })

  it('on the owner\'s yes the end goes and the account is kept; repeated yes changes nothing', () => {
    const t = { name: 'Jakob', createdAt: NOW, expiresAt: NOW + 2 * DAY, keepAsked: true }
    expect(guestGranted(t)).toBe(true)
    expect(t).toEqual({ name: 'Jakob', createdAt: NOW, kept: true })
    expect(guestKept(t)).toBe(true)
    expect(guestGranted(t)).toBe(false)
    expect(guestEnded(t, NOW + 1000 * DAY)).toBe(false)
    expect(guestAsk(t)).toBe(false)
  })

  it('a link without an end never ends by the clock', () => {
    expect(guestEnded({ name: 'J', createdAt: NOW }, NOW + 1000 * DAY)).toBe(false)
  })
})

describe('the two texts', () => {
  it('round-trip, and only the exact two are notices', () => {
    for (const n of [KeepNotice.Ask, KeepNotice.Yes]) expect(parseKeepText(APP, keepText(APP, n))).toBe(n)
    expect(parseKeepText(APP, `${APP}?keep=maybe`)).toBeNull()
    expect(parseKeepText(APP, `${APP}?keep=yes&x=1`)).toBeNull()
    expect(parseKeepText(APP, `${APP}?keep=`)).toBeNull()
    expect(parseKeepText(APP, 'keep=yes')).toBeNull()
    expect(parseKeepText(APP, 5)).toBeNull()
    expect(isKeepText(APP, `${APP}?keep=maybe`)).toBe(true)
  })

  it('routeText: a keep notice is a keep notice; a malformed one is shown nowhere; ordinary text stays chat', () => {
    expect(routeText(APP, keepText(APP, KeepNotice.Ask))).toBe(TextKind.Keep)
    expect(routeText(APP, keepText(APP, KeepNotice.Yes))).toBe(TextKind.Keep)
    expect(routeText(APP, `${APP}?keep=nope`)).toBe(TextKind.Ignore)
    expect(routeText(APP, 'please keep it')).toBe(TextKind.Chat)
  })
})
