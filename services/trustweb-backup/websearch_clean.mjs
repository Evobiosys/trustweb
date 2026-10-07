// Turns an engine's raw result list into the shape the app may render: plain text, http(s) urls only, hard length caps.
// Pure functions, no I/O. Everything an engine sends is untrusted data (HTML, javascript: urls, huge strings, odd types).

export const MAX_RESULTS = 10
export const MAX_TITLE = 200
export const MAX_SNIPPET = 400
export const MAX_URL = 2000

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const CONTROL = /[\p{C}\p{Zl}\p{Zp}]/gu // control, format (zero-width, bidi, BOM), private-use, line and paragraph separators

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' '
    }
    return ENTITIES[body.toLowerCase()] ?? whole
  })
}

/** Plain text from a possibly HTML-bearing string: tags dropped, entities decoded once, whitespace collapsed, capped. */
export function plainText(value, max) {
  if (typeof value !== 'string') return ''
  const noTags = value.slice(0, max * 8).replace(/<[^>]*>?/g, ' ')
  const text = decodeEntities(noTags).replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('').trimEnd()}…`
}

/** The url when it is an absolute http(s) address without credentials, else null (javascript:, data:, relative, user@host all dropped). */
export function safeUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL) return null
  let parsed
  try {
    parsed = new URL(value.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (parsed.username !== '' || parsed.password !== '' || parsed.hostname === '') return null
  return parsed.href.length <= MAX_URL ? parsed.href : null
}

/** raw: array of {title, url, snippet} candidates (any types). Returns at most MAX_RESULTS clean {title,url,snippet}, no duplicate urls. */
export function cleanResults(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const item of raw) {
    if (out.length >= MAX_RESULTS) break
    if (item === null || typeof item !== 'object') continue
    const url = safeUrl(item.url)
    if (url === null || seen.has(url)) continue
    const title = plainText(item.title, MAX_TITLE)
    seen.add(url)
    out.push({ title: title === '' ? new URL(url).hostname : title, url, snippet: plainText(item.snippet, MAX_SNIPPET) })
  }
  return out
}
