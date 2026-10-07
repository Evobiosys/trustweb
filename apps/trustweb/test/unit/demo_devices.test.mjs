/**
 * Removing a device (src/demo_devices.ts, wave 5 item g): which personas are open, which can go, and that the current
 * device (the first one, or the demo account a tab runs as) never does.
 */
import { Persona } from '../../src/seed.ts'
import {
  RemoveVerdict, canEndDemoAccount, nextDevice, parseDevices, removeVerdict, serializeDevices, withoutDevice,
} from '../../src/demo_devices.ts'

const ORDER = [Persona.Holder, Persona.Seeker, Persona.Third, Persona.Fourth]

describe('parseDevices / serializeDevices', () => {
  it('nothing stored: the first device only', () => {
    expect(parseDevices(null, ORDER)).toEqual([Persona.Holder])
    expect(parseDevices('', ORDER)).toEqual([Persona.Holder])
  })
  it('the old format, a bare count, means the first n personas', () => {
    expect(parseDevices('1', ORDER)).toEqual([Persona.Holder])
    expect(parseDevices('3', ORDER)).toEqual([Persona.Holder, Persona.Seeker, Persona.Third])
    expect(parseDevices('4', ORDER)).toEqual(ORDER)
  })
  it('a count out of range or garbage reads as the first device only', () => {
    for (const bad of ['0', '5', '-1', '2.5', 'abc', 'null', ',,,']) expect(parseDevices(bad, ORDER)).toEqual([Persona.Holder])
  })
  it('a list keeps its order, drops unknown names and duplicates, and always starts with the first device', () => {
    expect(parseDevices('holder,fourth,seeker', ORDER)).toEqual([Persona.Holder, Persona.Fourth, Persona.Seeker])
    expect(parseDevices('fourth,holder,fourth,bogus', ORDER)).toEqual([Persona.Holder, Persona.Fourth])
    expect(parseDevices('seeker', ORDER)).toEqual([Persona.Holder, Persona.Seeker])
  })
  it('serialises as a comma list that parses back to the same devices', () => {
    const open = [Persona.Holder, Persona.Third, Persona.Fourth]
    expect(serializeDevices(open)).toBe('holder,third,fourth')
    expect(parseDevices(serializeDevices(open), ORDER)).toEqual(open)
  })
})

describe('nextDevice', () => {
  it('opens the first persona that is not open, so a removed middle phone is reused and none is ever opened twice', () => {
    expect(nextDevice([Persona.Holder], ORDER)).toBe(Persona.Seeker)
    expect(nextDevice([Persona.Holder, Persona.Third], ORDER)).toBe(Persona.Seeker)
    expect(nextDevice([Persona.Holder, Persona.Seeker, Persona.Fourth], ORDER)).toBe(Persona.Third)
  })
  it('null when all four are open', () => {
    expect(nextDevice(ORDER, ORDER)).toBeNull()
  })
})

describe('removeVerdict / withoutDevice', () => {
  const open = [Persona.Holder, Persona.Seeker, Persona.Third]
  it('the first device is the current one and is never removable', () => {
    expect(removeVerdict(open, Persona.Holder, ORDER)).toBe(RemoveVerdict.FirstDevice)
    expect(removeVerdict([Persona.Holder], Persona.Holder, ORDER)).toBe(RemoveVerdict.FirstDevice)
  })
  it('an open later device is removable, a closed one is not open', () => {
    expect(removeVerdict(open, Persona.Seeker, ORDER)).toBe(RemoveVerdict.Removable)
    expect(removeVerdict(open, Persona.Fourth, ORDER)).toBe(RemoveVerdict.NotOpen)
  })
  it('withoutDevice drops only that one and keeps the order; removing then adding again reuses the freed persona', () => {
    const rest = withoutDevice(open, Persona.Seeker)
    expect(rest).toEqual([Persona.Holder, Persona.Third])
    expect(nextDevice(rest, ORDER)).toBe(Persona.Seeker)
    expect(withoutDevice(rest, Persona.Fourth)).toEqual(rest)
  })
  it('does not change the list it was given', () => {
    const before = [...open]
    withoutDevice(open, Persona.Third)
    expect(open).toEqual(before)
  })
})

describe('canEndDemoAccount (the real app)', () => {
  it('a normal phone (no testOf) may end any of its demo accounts', () => {
    expect(canEndDemoAccount(undefined, 'acct-1')).toBe(true)
  })
  it('a tab that IS a demo account never ends its own, but may end another id', () => {
    const me = { name: 'Jakob', createdAt: 1, accountId: 'acct-1' }
    expect(canEndDemoAccount(me, 'acct-1')).toBe(false)
    expect(canEndDemoAccount(me, 'acct-2')).toBe(true)
  })
})
