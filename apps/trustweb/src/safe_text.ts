/**
 * Text from outside this phone (a fediverse post, an imported file) before it
 * is shown or kept (review-app-b, wave 1733): bidirectional overrides and
 * isolates (which can make a line display in a spoofed order) and C0/C1
 * control characters (hidden bytes) are dropped. Line breaks and tabs stay.
 */

const UNSAFE_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/g

export function stripUnsafe(text: string): string {
  return text.replace(UNSAFE_CHARS_RE, '')
}

/** A short fingerprint of a text (FNV-1a, 32 bit, hex): enough to tell "changed since" apart, never to recover the text. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
