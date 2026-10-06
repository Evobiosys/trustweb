/**
 * Demo (test) accounts (src/demo_account.ts): the account name, the link
 * fragment round trip, and the untrusted shapes it must refuse.
 */
import { demoFragment, isDemoPeerRef, isTestAccountName, parseDemoFragment, testAccountName } from '../../src/demo_account.ts'

const DID = 'did:peer:2.Vz6Mk' + 'a'.repeat(40) + '.Ez6LS' + 'b'.repeat(40) + '.SeyJ0IjoiZG0ifQ'

describe('testAccountName', () => {
  it('appends -test to a trimmed first name', () => expect(testAccountName('  Anna ')).toBe('Anna-test'))
  it('collapses inner whitespace', () => expect(testAccountName('Anna  Maria')).toBe('Anna Maria-test'))
  it('never doubles the suffix', () => expect(testAccountName('Anna-test')).toBe('Anna-test'))
  it('is empty for an empty name', () => expect(testAccountName('   ')).toBe(''))
  it('caps very long names', () => expect(testAccountName('x'.repeat(80))).toBe('x'.repeat(30) + '-test'))
})

describe('isTestAccountName', () => {
  it('accepts <name>-test, any case', () => { expect(isTestAccountName('Anna-test')).toBe(true); expect(isTestAccountName('BEN-TEST')).toBe(true) })
  it('refuses a bare suffix or no suffix', () => { expect(isTestAccountName('-test')).toBe(false); expect(isTestAccountName('Anna')).toBe(false) })
})

describe('demoFragment / parseDemoFragment', () => {
  it('round-trips an account without a peer', () => {
    const f = demoFragment({ account: 'Anna-test' })
    expect(f).toBe('t=Anna-test')
    expect(parseDemoFragment('#' + f)).toEqual({ account: 'Anna-test' })
  })
  it('round-trips an account with the demo inventory peer', () => {
    const peer = { did: DID, id: 'peer1234', name: 'Demo inventory' }
    const parsed = parseDemoFragment('#' + demoFragment({ account: 'Ben-test', peer }))
    expect(parsed).toEqual({ account: 'Ben-test', peer })
  })
  it('keeps the account and drops a half-formed peer', () => {
    expect(parseDemoFragment('t=Ben-test&p=' + DID + '&pn=Demo')).toEqual({ account: 'Ben-test' })
    expect(parseDemoFragment('t=Ben-test&p=not-a-did&pi=x&pn=Demo')).toEqual({ account: 'Ben-test' })
  })
  it('is null for ordinary visits, notes-only fragments and non-test names', () => {
    expect(parseDemoFragment('')).toBeNull()
    expect(parseDemoFragment('#n=some%20notes')).toBeNull()
    expect(parseDemoFragment('#t=Anna')).toBeNull()
    expect(parseDemoFragment('#t=' + 'x'.repeat(60) + '-test')).toBeNull()
  })
  it('percent-encodes what needs it', () => {
    const f = demoFragment({ account: 'Zoë Ö-test' })
    expect(f).not.toContain('ë')
    expect(parseDemoFragment(f)).toEqual({ account: 'Zoë Ö-test' })
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
