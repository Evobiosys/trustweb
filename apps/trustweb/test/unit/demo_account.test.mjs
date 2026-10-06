/**
 * Demo accounts (src/demo_account.ts): the account name ("<name>-demo", suffix
 * erasable, "-demo" alone is nothing), the link fragment round trip (account,
 * id, end, own, peer), the hand-over fragment, personas and the countdown.
 */
import {
  DEMO_LIFETIME_MS, demoAccountName, demoFragment, demoPersona, handoverFragment, isDemoPeerRef, isDemoPersona,
  parseDemoFragment, parseHandoverFragment, timeLeft,
} from '../../src/demo_account.ts'

const DID = 'did:peer:2.Vz6Mk' + 'a'.repeat(40) + '.Ez6LS' + 'b'.repeat(40) + '.SeyJ0IjoiZG0ifQ'
const KEY = 'TW1R-ABCDE-FGHJK-MNPQR-STVWX-YZ012-3456A-BCDEF-GHJKM-NPQRS-TVWXY-Z'

describe('demoAccountName', () => {
  it('keeps what was typed in front of the prefilled suffix', () => expect(demoAccountName('Anna-demo')).toBe('Anna-demo'))
  it('allows the suffix to be erased', () => expect(demoAccountName('Anna')).toBe('Anna'))
  it('keeps older -test names working', () => expect(demoAccountName('Ben-test')).toBe('Ben-test'))
  it('trims and collapses whitespace', () => expect(demoAccountName('  Anna  Maria -demo ')).toBe('Anna Maria -demo'))
  it('is nothing for the bare suffix or no letter/digit', () => {
    expect(demoAccountName('-demo')).toBe('')
    expect(demoAccountName('   ')).toBe('')
    expect(demoAccountName('--')).toBe('')
  })
  it('caps very long names', () => expect(demoAccountName('x'.repeat(80)).length).toBe(40))
})

describe('demoPersona / isDemoPersona', () => {
  it('derives a lower-case persona from the account id', () => expect(demoPersona('Ab12Cd34')).toBe('demo-ab12cd34'))
  it('accepts only its own shape', () => {
    expect(isDemoPersona('demo-ab12cd34')).toBe(true)
    expect(isDemoPersona('demo-AB12')).toBe(false)
    expect(isDemoPersona('holder')).toBe(false)
    expect(isDemoPersona('demo-')).toBe(false)
    expect(isDemoPersona(null)).toBe(false)
  })
})

describe('timeLeft', () => {
  it('counts days, hours, minutes and knows an end', () => {
    expect(timeLeft(1000 + 6.5 * 86_400_000, 1000)).toMatchObject({ ended: false, days: 7 })
    expect(timeLeft(1000 + 7 * 86_400_000, 1000)).toMatchObject({ ended: false, days: 7 })
    expect(timeLeft(1000 + 5 * 3_600_000, 1000)).toMatchObject({ ended: false, days: 0, hours: 5 })
    expect(timeLeft(1000 + 90_000, 1000)).toMatchObject({ ended: false, hours: 0, minutes: 2 })
    expect(timeLeft(1000, 1000).ended).toBe(true)
    expect(DEMO_LIFETIME_MS).toBe(7 * 86_400_000)
  })
})

describe('demoFragment / parseDemoFragment', () => {
  it('round-trips the account alone (an older link)', () => {
    const f = demoFragment({ account: 'Anna-test' })
    expect(f).toBe('t=Anna-test')
    expect(parseDemoFragment('#' + f)).toEqual({ account: 'Anna-test' })
  })
  it('round-trips account, id, end and the own-phone flag', () => {
    const link = { account: 'Anna-demo', accountId: 'Ab12Cd34', expiresAt: 1_800_000_000_000, own: true }
    expect(parseDemoFragment('#' + demoFragment(link))).toEqual(link)
  })
  it('round-trips the demo inventory peer', () => {
    const peer = { did: DID, id: 'peer1234', name: 'Demo inventory' }
    expect(parseDemoFragment('#' + demoFragment({ account: 'Ben-demo', peer }))).toEqual({ account: 'Ben-demo', peer })
  })
  it('drops a half-formed peer, a bad id or a bad end, keeps the account', () => {
    expect(parseDemoFragment('t=Ben-demo&p=' + DID + '&pn=Demo')).toEqual({ account: 'Ben-demo' })
    expect(parseDemoFragment('t=Ben-demo&a=no!&x=soon')).toEqual({ account: 'Ben-demo' })
  })
  it('is null for ordinary visits, notes-only fragments and empty names', () => {
    expect(parseDemoFragment('')).toBeNull()
    expect(parseDemoFragment('#n=some%20notes')).toBeNull()
    expect(parseDemoFragment('#t=-demo')).toBeNull()
  })
  it('percent-encodes what needs it', () => {
    const f = demoFragment({ account: 'Zoë Ö-demo' })
    expect(f).not.toContain('ë')
    expect(parseDemoFragment(f)).toEqual({ account: 'Zoë Ö-demo' })
  })
})

describe('handoverFragment / parseHandoverFragment', () => {
  it('round-trips key, id and account', () => {
    const h = { keyText: KEY, accountId: 'Ab12Cd34', account: 'Anna-demo' }
    expect(parseHandoverFragment('#' + handoverFragment(h))).toEqual(h)
  })
  it('refuses a non-key, a bad id or a missing account', () => {
    expect(parseHandoverFragment('k=hello&a=Ab12Cd34&t=Anna-demo')).toBeNull()
    expect(parseHandoverFragment('k=' + KEY + '&a=!&t=Anna-demo')).toBeNull()
    expect(parseHandoverFragment('k=' + KEY + '&a=Ab12Cd34')).toBeNull()
  })
})

describe('isDemoPeerRef (demo-peer.json is untrusted)', () => {
  it('accepts a well-formed card', () => expect(isDemoPeerRef({ did: DID, id: 'abc', name: 'Demo inventory' })).toBe(true))
  it('refuses missing or oversized fields and non did:peer ids', () => {
    expect(isDemoPeerRef(null)).toBe(false)
    expect(isDemoPeerRef({ did: DID, id: '', name: 'x' })).toBe(false)
    expect(isDemoPeerRef({ did: 'https://evil.example', id: 'a', name: 'x' })).toBe(false)
    expect(isDemoPeerRef({ did: DID, id: 'a', name: 'x'.repeat(41) })).toBe(false)
    expect(isDemoPeerRef({ did: 'did:peer:' + 'z'.repeat(700), id: 'a', name: 'x' })).toBe(false)
  })
})
