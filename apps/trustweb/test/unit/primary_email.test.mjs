// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { PROVIDERS, guessProvider, validateEmail, composeHref, senderHint } from '../../src/primary_email.ts'

describe('primary email (primary_email.ts)', () => {
  it('lists providers in the owner order', () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(['proton', 'gmail', 'hotmail-outlook', 'ik-me', 'apple-icloud', 'thunderbird', 'other'])
  })
  it('guesses the provider from the domain; Thunderbird is never guessed', () => {
    expect(guessProvider('a@proton.me')).toBe('proton')
    expect(guessProvider('a@pm.me')).toBe('proton')
    expect(guessProvider('a@protonmail.com')).toBe('proton')
    expect(guessProvider('a@googlemail.com')).toBe('gmail')
    expect(guessProvider('a@Gmail.com')).toBe('gmail')
    expect(guessProvider('a@hotmail.de')).toBe('hotmail-outlook')
    expect(guessProvider('a@outlook.com')).toBe('hotmail-outlook')
    expect(guessProvider('a@live.at')).toBe('hotmail-outlook')
    expect(guessProvider('a@ik.me')).toBe('ik-me')
    expect(guessProvider('a@icloud.com')).toBe('apple-icloud')
    expect(guessProvider('a@me.com')).toBe('apple-icloud')
    expect(guessProvider('a@example.org')).toBe('other')
    expect(guessProvider('nonsense')).toBe('other')
  })
  it('validates and normalises an address', () => {
    expect(validateEmail('  Anna@Example.org ')).toBe('anna@example.org')
    expect(validateEmail('a@b')).toBeNull()
    expect(validateEmail('a@b.org?subject=x')).toBeNull()
    expect(validateEmail('')).toBeNull()
  })
  it('builds a web compose link where the provider has one, else mailto', () => {
    const to = 'a@x.org'
    // own card: no recipient prefilled
    expect(composeHref({ provider: 'gmail', address: to })).toBe('https://mail.google.com/mail/?view=cm&to=')
    expect(composeHref({ provider: 'hotmail-outlook', address: to })).toBe('https://outlook.live.com/mail/0/deeplink/compose?to=')
    expect(composeHref({ provider: 'gmail', address: to }, 'b&c@y.org')).toBe('https://mail.google.com/mail/?view=cm&to=b%26c%40y.org')
    for (const p of ['proton', 'apple-icloud', 'ik-me']) expect(composeHref({ provider: p, address: to })).toBe('mailto:')
    expect(composeHref({ provider: 'proton', address: to }, 'b@y.org')).toBe('mailto:b@y.org')
    expect(composeHref({ provider: 'thunderbird', address: to })).toBe('mailto:')
    expect(composeHref({ provider: 'other', address: to })).toBe('mailto:')
  })
  it('words the sender hint', () => {
    expect(senderHint({ provider: 'proton', address: 'a@x.org' })).toBe('Sent from a@x.org (Proton)')
  })
  it('a Me with and without primaryEmail survives a JSON round trip (backup) unchanged', () => {
    const a = { id: 'x', displayName: 'A', primaryEmail: { provider: 'proton', address: 'a@x.org' } }
    const b = { id: 'x', displayName: 'A' }
    expect(JSON.parse(JSON.stringify(a))).toEqual(a)
    expect(JSON.parse(JSON.stringify(b))).toEqual(b)
  })
})
