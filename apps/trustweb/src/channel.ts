/**
 * Contact links: turn what a person types (a phone number, a handle, or a
 * pasted link) into one canonical value per messenger, and that value into an
 * https link that opens the messenger's app where it is installed and its web
 * page where it is not. https, not custom schemes: a scheme like sgnl:// fails
 * silently when the app is missing.
 *
 * Linking out only, never embedding a messenger (WoT decision 2026-08-25:
 * "channel-linking OK, embedding never").
 */
import { Channel } from './model'

/** "+43 660 123 4567", "0043 660...", "+43-660-..." -> "+436601234567"; null if not E.164. */
export function toE164(input: string): string | null {
  let s = input.trim().replace(/[\s\-().]/g, '')
  if (s.startsWith('00')) s = '+' + s.slice(2)
  return /^\+[1-9]\d{6,14}$/.test(s) ? s : null
}

const MATRIX_ID = /^@[a-z0-9._=\-/+]+:[a-z0-9.-]+\.[a-z]{2,}(:\d{1,5})?$/i
const TELEGRAM_USER = /^[a-z][a-z0-9_]{4,31}$/i
const MESSENGER_USER = /^[a-z0-9.]{5,50}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

function linkOn(input: string, hosts: readonly string[]): URL | null {
  try {
    const u = new URL(input.trim())
    return u.protocol === 'https:' && hosts.includes(u.hostname.toLowerCase()) ? u : null
  } catch {
    return null
  }
}

/**
 * The canonical value to store, or null if the input is not a valid way to
 * reach someone on this channel.
 */
export function normalizeHandle(channel: Channel, input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  switch (channel) {
    case Channel.Signal: {
      const link = linkOn(raw, ['signal.me'])
      if (link) return link.href
      return toE164(raw)
    }
    case Channel.WhatsApp: {
      const link = linkOn(raw, ['wa.me'])
      const digits = link ? link.pathname.replace(/\D/g, '') : null
      return digits ? toE164('+' + digits) : toE164(raw)
    }
    case Channel.Matrix: {
      const link = linkOn(raw, ['matrix.to'])
      const id = link ? decodeURIComponent(link.hash.replace(/^#\/?/, '')) : raw
      return MATRIX_ID.test(id) ? id : null
    }
    case Channel.Delta: {
      const link = linkOn(raw, ['i.delta.chat'])
      if (link && link.hash.length > 1) return link.href
      return EMAIL.test(raw) ? raw.toLowerCase() : null
    }
    case Channel.Telegram: {
      const link = linkOn(raw, ['t.me', 'telegram.me'])
      const part = link ? link.pathname.replace(/^\//, '') : raw.replace(/^@/, '')
      if (part.startsWith('+')) return toE164(part)
      return TELEGRAM_USER.test(part) ? part : toE164(raw)
    }
    case Channel.Messenger: {
      const link = linkOn(raw, ['m.me'])
      const user = link ? link.pathname.replace(/^\//, '') : raw.replace(/^@/, '')
      return MESSENGER_USER.test(user) ? user : null
    }
  }
}

/** The link that opens this contact in the messenger. */
export function channelLink(channel: Channel, value: string): string {
  switch (channel) {
    case Channel.Signal:
      return value.startsWith('https://') ? value : `https://signal.me/#p/${value}`
    case Channel.WhatsApp:
      return `https://wa.me/${value.replace(/\D/g, '')}`
    case Channel.Matrix:
      return `https://matrix.to/#/${value}`
    case Channel.Delta:
      // A bare address can only become mailto:, which opens Delta Chat only
      // where it is the default mail app; an i.delta.chat invite always does.
      return value.startsWith('https://') ? value : `mailto:${value}`
    case Channel.Telegram:
      return `https://t.me/${value}`
    case Channel.Messenger:
      return `https://m.me/${value}`
  }
}
