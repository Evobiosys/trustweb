/**
 * "Hello" (wave 6b): the sharer's own name, sent to a phone that just connected to them. A connect code (connect_code.ts) or a
 * bare DID can reach a phone with no name in it; the cleartext connect-ack only travels scanner -> sharer, so this one short text
 * travels back inside the encrypted chat envelope of the paired peer (the pattern of contact_share.ts and account_keep.ts):
 *     <app url>?hello=1#n=<name>
 * It carries a name and nothing else, so it goes whatever the Advanced choice of the Meet page is. A phone that does not know the
 * text (an older build) shows nothing, because routeText (chat.ts) files it as protocol text. Everything received is untrusted:
 * control and bidi characters are stripped, the name is bounded to 40 characters (what a name field takes), and it only ever
 * replaces a name the receiving phone does not have yet (see wantsHelloName).
 * Pure and DOM-free.
 */
import { stripUnsafe } from './safe_text'

export const HELLO_PARAM = 'hello'
/** What a peer is called until its own name is known (net.ts uses the same word for a link without one). */
export const NAMELESS_PEER = 'Someone'
/** The longest name a name field takes. */
export const HELLO_NAME_MAX = 40

function prefix(appUrl: string): string {
  return `${appUrl}?${HELLO_PARAM}=1#`
}

/** A name fit to show: no hidden characters, trimmed, bounded; '' when nothing is left. */
export function cleanHelloName(raw: string): string {
  return stripUnsafe(raw).replace(/\s+/g, ' ').trim().slice(0, HELLO_NAME_MAX)
}

/** The text that tells a new connection who I am, or null when I have no name to tell. */
export function helloText(appUrl: string, myName: string): string | null {
  const name = cleanHelloName(myName)
  return name ? `${prefix(appUrl)}n=${encodeURIComponent(name)}` : null
}

/** Does this text claim to be a hello (whether or not it is well formed)? */
export function isHelloText(appUrl: string, text: string): boolean {
  return typeof text === 'string' && text.startsWith(`${appUrl}?${HELLO_PARAM}=`)
}

/** The name in a hello text; null for anything else or a text with no usable name. Never throws. */
export function parseHelloText(appUrl: string, text: string): string | null {
  if (typeof text !== 'string' || !text.startsWith(prefix(appUrl)) || text.length > 400) return null
  try {
    const raw = new URLSearchParams(text.slice(prefix(appUrl).length)).get('n')
    const name = raw === null ? '' : cleanHelloName(raw)
    return name || null
  } catch {
    return null
  }
}

/** A hello names a peer only while this phone has no name for it. */
export function wantsHelloName(currentName: string | undefined): boolean {
  return !currentName || currentName === NAMELESS_PEER
}
