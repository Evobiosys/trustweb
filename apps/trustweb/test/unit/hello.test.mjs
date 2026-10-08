/** "Hello" (src/hello.ts, wave 6b): the name a connected phone tells, the way it is read back, and that nothing else rides along. */
import { cleanHelloName, helloText, isHelloText, parseHelloText, wantsHelloName, NAMELESS_PEER, HELLO_NAME_MAX, HELLO_TEXT_MAX } from '../../src/hello.ts'
import { routeText, TextKind } from '../../src/chat.ts'

const APP = 'https://app.trustintheweb.org/'

describe('helloText / parseHelloText', () => {
  it('round-trips a name, including spaces, umlauts and symbols that need escaping', () => {
    for (const name of ['Ada', 'Ada Lovelace', 'Jörg & Zoë #1', 'N=1&x=2']) {
      expect(parseHelloText(APP, helloText(APP, name))).toBe(name)
    }
  })
  it('has nothing to say without a name', () => {
    expect(helloText(APP, '')).toBeNull()
    expect(helloText(APP, '   ')).toBeNull()
    expect(helloText(APP, '‮\u0007')).toBeNull()
  })
  it('carries only the name: no other key', () => {
    const t = helloText(APP, 'Ada')
    expect(t).toBe(`${APP}?hello=1#n=Ada`)
  })
  it('bounds and cleans what it sends and what it reads', () => {
    expect(cleanHelloName('x'.repeat(100))).toHaveLength(HELLO_NAME_MAX)
    expect(cleanHelloName('A‮B\u0000C')).toBe('ABC')
    expect(cleanHelloName('  A \n B  ')).toBe('A B')
    expect(parseHelloText(APP, `${APP}?hello=1#n=${encodeURIComponent('Ada‮\u0007')}`)).toBe('Ada')
  })
  it.each([
    ['another prefix', 'https://evil.example/?hello=1#n=Ada'], ['no fragment', `${APP}?hello=1`], ['no name', `${APP}?hello=1#x=1`],
    ['an empty name', `${APP}?hello=1#n=`], ['only hidden characters', `${APP}?hello=1#n=%E2%80%AE`], ['a number', 7], ['too long', `${APP}?hello=1#n=${'a'.repeat(500)}`],
    ['plain chat', 'hello there'],
  ])('reads nothing from %s, without throwing', (_n, text) => expect(parseHelloText(APP, text)).toBeNull())
  it('does not throw on malformed escapes', () => expect(() => parseHelloText(APP, `${APP}?hello=1#n=%E0%A4%A`)).not.toThrow())
})

describe('isHelloText and the router', () => {
  it('a hello is routed as Hello, never as chat', () => {
    expect(isHelloText(APP, helloText(APP, 'Ada'))).toBe(true)
    expect(routeText(APP, helloText(APP, 'Ada'))).toBe(TextKind.Hello)
  })
  it('a malformed hello is Ignore (shown nowhere), not chat', () => {
    expect(routeText(APP, `${APP}?hello=1#n=`)).toBe(TextKind.Ignore)
    expect(routeText(APP, `${APP}?hello=2`)).toBe(TextKind.Ignore)
  })
  it('ordinary chat and the other protocol texts are untouched', () => {
    expect(routeText(APP, 'see you at five')).toBe(TextKind.Chat)
    expect(routeText(APP, `${APP}?keep=ask`)).toBe(TextKind.Keep)
  })
})

describe('wantsHelloName', () => {
  it('only a name this phone does not have yet is replaced', () => {
    expect(wantsHelloName(undefined)).toBe(true)
    expect(wantsHelloName('')).toBe(true)
    expect(wantsHelloName(NAMELESS_PEER)).toBe(true)
    expect(wantsHelloName('Ada')).toBe(false)
  })
})

describe('review 6b: invisible names, long encoded names, names from links and acks', () => {
  const APP = 'https://app.example.test/'
  it('a name of only zero-width or joiner characters is no name', () => {
    expect(cleanHelloName('​')).toBe('')
    expect(cleanHelloName('‍‌ ﻿')).toBe('')
    expect(parseHelloText(APP, `${APP}?hello=1#n=%E2%80%8B`)).toBeNull()
  })
  it('emoji joiners inside a visible name stay; invisible separators go', () => {
    expect(cleanHelloName('Ada \u{1F469}‍\u{1F4BB}')).toBe('Ada \u{1F469}‍\u{1F4BB}')
    expect(cleanHelloName('A​da ')).toBe('Ada')
  })
  it('a 40-emoji name still makes a hello the other side reads (cut to fit the text cap)', () => {
    const name = '\u{1F600}'.repeat(40)
    const text = helloText(APP, name)
    expect(text).not.toBeNull()
    expect(text.length).toBeLessThanOrEqual(HELLO_TEXT_MAX)
    const back = parseHelloText(APP, text)
    expect(back && back.length > 0 && name.startsWith(back)).toBe(true)
  })
  it('the bound counts characters, not UTF-16 units (an emoji is never cut in half)', () => {
    const out = cleanHelloName('x'.repeat(39) + '\u{1F600}\u{1F600}')
    expect([...out]).toHaveLength(40)
    expect(out.endsWith('\u{1F600}')).toBe(true)
  })
})
