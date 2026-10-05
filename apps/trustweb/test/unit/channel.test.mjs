/**
 * Contact links (src/channel.ts): every messenger, typed and pasted forms,
 * and malformed input. The link must open the app (https universal links).
 */
import { channelLink, normalizeHandle, toE164 } from '../../src/channel.ts'
import { Channel } from '../../src/model.ts'

const link = (ch, input) => {
  const v = normalizeHandle(ch, input)
  return v === null ? null : channelLink(ch, v)
}

describe('toE164', () => {
  it('accepts spaced, dashed and 00-prefixed numbers', () => {
    expect(toE164('+43 660 123 4567')).toBe('+436601234567')
    expect(toE164('0043-660-123-4567')).toBe('+436601234567')
    expect(toE164('+43 (660) 123.4567')).toBe('+436601234567')
  })
  it('refuses national or too-short numbers', () => {
    expect(toE164('0660 1234567')).toBeNull()
    expect(toE164('+43 12')).toBeNull()
    expect(toE164('hello')).toBeNull()
  })
})

describe('Signal', () => {
  it('links a phone number', () => expect(link(Channel.Signal, '+43 660 1234567')).toBe('https://signal.me/#p/+436601234567'))
  it('keeps a pasted signal.me link', () => expect(link(Channel.Signal, 'https://signal.me/#eu/abcDEF123')).toBe('https://signal.me/#eu/abcDEF123'))
  it('refuses a bare username (Signal cannot link one)', () => expect(link(Channel.Signal, 'lena.42')).toBeNull())
})

describe('WhatsApp', () => {
  it('links a phone number', () => expect(link(Channel.WhatsApp, '0043 660 1234567')).toBe('https://wa.me/436601234567'))
  it('reads a pasted wa.me link', () => expect(link(Channel.WhatsApp, 'https://wa.me/436601234567')).toBe('https://wa.me/436601234567'))
  it('refuses text', () => expect(link(Channel.WhatsApp, 'lena')).toBeNull())
})

describe('Matrix', () => {
  it('links a Matrix ID', () => expect(link(Channel.Matrix, '@lena:matrix.org')).toBe('https://matrix.to/#/@lena:matrix.org'))
  it('reads a pasted matrix.to link', () => expect(link(Channel.Matrix, 'https://matrix.to/#/@lena:example.org')).toBe('https://matrix.to/#/@lena:example.org'))
  it('refuses an ID without a server', () => expect(link(Channel.Matrix, '@lena')).toBeNull())
  it('refuses a link to another host', () => expect(link(Channel.Matrix, 'https://evil.example/#/@lena:matrix.org')).toBeNull())
})

describe('Delta Chat', () => {
  it('keeps a pasted invite link', () => {
    const invite = 'https://i.delta.chat/#ABCDEF0123456789&a=lena%40example.org&n=Lena'
    expect(link(Channel.Delta, invite)).toBe(invite)
  })
  it('turns an address into mailto:', () => expect(link(Channel.Delta, 'Lena@Example.org')).toBe('mailto:lena@example.org'))
  it('refuses an invite link without its fragment', () => expect(link(Channel.Delta, 'https://i.delta.chat/')).toBeNull())
})

describe('Telegram', () => {
  it('links a username, with or without @', () => {
    expect(link(Channel.Telegram, '@lena_tw')).toBe('https://t.me/lena_tw')
    expect(link(Channel.Telegram, 'lena_tw')).toBe('https://t.me/lena_tw')
  })
  it('links a phone number', () => expect(link(Channel.Telegram, '+43 660 1234567')).toBe('https://t.me/+436601234567'))
  it('reads a pasted t.me link', () => expect(link(Channel.Telegram, 'https://t.me/lena_tw')).toBe('https://t.me/lena_tw'))
  it('refuses a too-short username', () => expect(link(Channel.Telegram, '@ab')).toBeNull())
})

describe('Messenger', () => {
  it('links a username', () => expect(link(Channel.Messenger, 'lena.example')).toBe('https://m.me/lena.example'))
  it('reads a pasted m.me link', () => expect(link(Channel.Messenger, 'https://m.me/lena.example')).toBe('https://m.me/lena.example'))
  it('refuses a username with spaces', () => expect(link(Channel.Messenger, 'lena example')).toBeNull())
})

describe('empty input', () => {
  it('is never a handle', () => {
    for (const ch of Object.values(Channel)) expect(normalizeHandle(ch, '   ')).toBeNull()
  })
})
