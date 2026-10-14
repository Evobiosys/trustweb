/** How a person's name shows when it is really an email address: never the address itself (it stays in `title`, for a long press). */
export interface DisplayName { text: string; glyph: string; title: string }

const HUMAN_LOCAL = /^[A-Za-z][A-Za-z.]{1,29}$/
const ENVELOPE = '✉'

export function displayName(name: string): DisplayName {
  const at = name.indexOf('@')
  if (at < 0) return { text: name, glyph: '', title: '' }
  const local = name.slice(0, at)
  return HUMAN_LOCAL.test(local) ? { text: local, glyph: '', title: name } : { text: 'Calendar', glyph: ENVELOPE, title: name }
}
