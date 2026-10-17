/**
 * Contact links (src/channel.ts): every messenger, typed and pasted forms,
 * and malformed input. The link must open the app (https universal links).
 */
import {
  channelLink, isWhatsAppQrLink, normalizeHandle, revealsNumberOn, revealsWhatsAppNumber, toE164, whatsAppQrPayload,
} from '../../src/channel.ts'
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
  it('turns a pasted sgnl:// link into the https form', () => {
    expect(link(Channel.Signal, 'sgnl://signal.me/#eu/abcDEF123')).toBe('https://signal.me/#eu/abcDEF123')
  })
  it('keeps a pasted phone link', () => expect(link(Channel.Signal, 'https://signal.me/#p/+436601234567')).toBe('https://signal.me/#p/+436601234567'))
  it('refuses a signal.me link Signal could not open', () => {
    for (const bad of ['https://signal.me/', 'https://signal.me/#', 'https://signal.me/#xyz', 'https://signal.me/#p/12', 'https://signal.me/#eu/', 'https://signal.me/#eu/a b']) {
      expect(normalizeHandle(Channel.Signal, bad)).toBeNull()
    }
  })
  it('refuses another scheme or another host', () => {
    expect(normalizeHandle(Channel.Signal, 'http://signal.me/#eu/abcDEF123')).toBeNull()
    expect(normalizeHandle(Channel.Signal, 'https://signal.me.evil.example/#eu/abcDEF123')).toBeNull()
    expect(normalizeHandle(Channel.Signal, 'sgnl://evil.example/#eu/abcDEF123')).toBeNull()
  })
  it('refuses a bare username (Signal cannot link one)', () => expect(link(Channel.Signal, 'lena.42')).toBeNull())
})

describe('WhatsApp', () => {
  it('links a phone number', () => expect(link(Channel.WhatsApp, '0043 660 1234567')).toBe('https://wa.me/436601234567'))
  it('reads a pasted wa.me link', () => expect(link(Channel.WhatsApp, 'https://wa.me/436601234567')).toBe('https://wa.me/436601234567'))
  it('refuses text', () => expect(link(Channel.WhatsApp, 'lena')).toBeNull())
  it('stores a number as E.164 and a wa.me link of a number the same way', () => {
    expect(normalizeHandle(Channel.WhatsApp, '+43 000 000 0000')).toBe('+430000000000')
    expect(normalizeHandle(Channel.WhatsApp, 'https://wa.me/430000000000')).toBe('+430000000000')
    expect(normalizeHandle(Channel.WhatsApp, 'https://wa.me/430000000000/')).toBe('+430000000000')
  })
  it('keeps a WhatsApp Business short link whole: wa.me/message/<code>, no number in it', () => {
    const biz = 'https://wa.me/message/ABCDEFGH12345'
    expect(normalizeHandle(Channel.WhatsApp, biz)).toBe(biz)
    expect(isWhatsAppQrLink(biz)).toBe(true)
    expect(revealsWhatsAppNumber(biz)).toBe(false)
    expect(link(Channel.WhatsApp, biz)).toBe(biz)
    expect(normalizeHandle(Channel.WhatsApp, biz + '?x=1')).toBeNull()
  })
  it('keeps WhatsApp\'s own share-QR link whole: wa.me/qr/<code>, no number in it', () => {
    expect(normalizeHandle(Channel.WhatsApp, 'https://wa.me/qr/ABCDEFGH12345')).toBe('https://wa.me/qr/ABCDEFGH12345')
    expect(link(Channel.WhatsApp, 'https://wa.me/qr/ABCDEFGH12345')).toBe('https://wa.me/qr/ABCDEFGH12345')
    expect(isWhatsAppQrLink('https://wa.me/qr/ABCDEFGH12345')).toBe(true)
  })
  it('a share-QR code made of many digits is NOT read as a phone number (the old digit strip did)', () => {
    expect(normalizeHandle(Channel.WhatsApp, 'https://wa.me/qr/12345678901')).toBe('https://wa.me/qr/12345678901')
    expect(revealsWhatsAppNumber('https://wa.me/qr/12345678901')).toBe(false)
  })
  it('refuses every other shape: query string, hash, other path, other host, http, short code, odd characters', () => {
    for (const bad of [
      'https://wa.me/qr/ABCDEFGH12345?text=hi', 'https://wa.me/qr/ABCDEFGH12345#x', 'https://wa.me/430000000000?text=hi', 'https://wa.me/430000000000#x',
      'https://wa.me/qr/', 'https://wa.me/qr/ABC', 'https://wa.me/qr/ABCDEFGH12345/extra', 'https://wa.me/',
      'http://wa.me/qr/ABCDEFGH12345', 'https://wa.me.evil.test/qr/ABCDEFGH12345', 'https://api.whatsapp.com/send?phone=430000000000', 'https://wa.me/qr/ABCD-EFGH12345',
      'https://wa.me/qr/ABCDEFGH12345?', 'ftp://wa.me/430000000000',
    ]) expect(normalizeHandle(Channel.WhatsApp, bad), bad).toBeNull()
  })
  it('whatsAppQrPayload: the wa.me link of a number or the share-QR link, null for anything else', () => {
    expect(whatsAppQrPayload('+430000000000')).toBe('https://wa.me/430000000000')
    expect(whatsAppQrPayload('https://wa.me/qr/ABCDEFGH12345')).toBe('https://wa.me/qr/ABCDEFGH12345')
    expect(whatsAppQrPayload('lena')).toBeNull()
    expect(whatsAppQrPayload('')).toBeNull()
  })
  it('revealsNumberOn: Signal numbers and WhatsApp numbers yes, links without a number and other channels no', () => {
    expect(revealsNumberOn(Channel.WhatsApp, '+430000000000')).toBe(true)
    expect(revealsNumberOn(Channel.WhatsApp, 'https://wa.me/qr/ABCDEFGH12345')).toBe(false)
    expect(revealsNumberOn(Channel.Signal, '+430000000000')).toBe(true)
    expect(revealsNumberOn(Channel.Signal, 'https://signal.me/#eu/abcDEF123_-xyz')).toBe(false)
    expect(revealsNumberOn(Channel.Matrix, '@lena:matrix.org')).toBe(false)
  })
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
