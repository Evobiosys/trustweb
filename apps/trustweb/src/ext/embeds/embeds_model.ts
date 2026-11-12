// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 small-ui-c: the embeds module's pure rules (Google Docs frame, Telegram link) and its slice of the record
 * (`AppState.extData.embeds`: one Docs and one Telegram link per community tag). Small on purpose: the always-loaded stub (index.ts) registers the
 * merge, the panes and the view load only when the module is on. community-mighty uses the same rules and panes (no copy).
 */
export const MODULE_ID = 'embeds'
/** The record key while no community tag exists. */
export const NO_TAG = '*'

/** http(s) only; the normalised link or null. */
export function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch { return null }
}

const DOCS_KINDS = /^\/(document|spreadsheets|presentation|forms)\/d\/(e\/)?[\w-]+/

/** A Google Doc on docs.google.com: a published link (…/pub) becomes …/pub?embedded=true, an …/edit link its …/preview page (a …/preview link stays, so a stored link reads back unchanged). Null for anything else. */
export function docsEmbedUrl(raw: string): string | null {
  const href = safeUrl(raw)
  if (!href) return null
  const u = new URL(href)
  if (u.protocol !== 'https:' || u.host !== 'docs.google.com' || u.username || u.password || !DOCS_KINDS.test(u.pathname)) return null
  if (/\/pub$/.test(u.pathname)) { u.search = '?embedded=true'; u.hash = ''; return u.href }
  if (/\/(edit|preview)$/.test(u.pathname) && !u.pathname.includes('/d/e/')) { u.pathname = u.pathname.replace(/\/edit$/, '/preview'); u.search = ''; u.hash = ''; return u.href }
  return null
}

const TELEGRAM_HOSTS = new Set(['t.me', 'telegram.me', 'telegram.org', 'web.telegram.org'])

/** A Telegram link (https on t.me, telegram.me, telegram.org or web.telegram.org); a bare "t.me/x" gets https. Null for anything else. */
export function telegramUrl(raw: string): string | null {
  const t = raw.trim()
  const href = safeUrl(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`)
  if (!href) return null
  const u = new URL(href)
  return u.protocol === 'https:' && !u.username && !u.password && TELEGRAM_HOSTS.has(u.host) ? u.href : null
}

export interface EmbedsEntry { docsUrl?: string; telegramUrl?: string }
export interface EmbedsData { byTag?: Record<string, EmbedsEntry> }

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function parseEntry(v: unknown): EmbedsEntry {
  const o = isRec(v) ? v : {}
  const docs = typeof o.docsUrl === 'string' ? docsEmbedUrl(o.docsUrl) : null
  const tg = typeof o.telegramUrl === 'string' ? telegramUrl(o.telegramUrl) : null
  return { ...(docs ? { docsUrl: docs } : {}), ...(tg ? { telegramUrl: tg } : {}) }
}

/** Every link checked again (the slice rides the device sync like any setting); unknown fields and empty tags dropped. */
export function parseEmbeds(raw: unknown): EmbedsData {
  const src = isRec(raw) && isRec(raw.byTag) ? raw.byTag : {}
  const byTag: Record<string, EmbedsEntry> = {}
  for (const tag of Object.keys(src)) {
    const e = parseEntry(src[tag])
    if (tag !== '__proto__' && (e.docsUrl || e.telegramUrl)) byTag[tag] = e
  }
  return Object.keys(byTag).length ? { byTag } : {}
}

export const entryFor = (d: EmbedsData, tag: string): EmbedsEntry => d.byTag?.[tag] ?? {}

/** `patch`: a link sets it (checked), null clears it. Returns a new record. */
export function withEntry(d: EmbedsData, tag: string, patch: { docsUrl?: string | null; telegramUrl?: string | null }): EmbedsData {
  const cur = { ...entryFor(d, tag) }
  for (const k of ['docsUrl', 'telegramUrl'] as const) {
    if (patch[k] === null) delete cur[k]
    else if (typeof patch[k] === 'string') cur[k] = patch[k]
  }
  return parseEmbeds({ byTag: { ...d.byTag, [tag]: cur } })
}

/** Two of my devices: tags join; per tag and link the incoming one wins where it has one. */
export function mergeEmbeds(mine: unknown, theirs: unknown): EmbedsData {
  const a = parseEmbeds(mine)
  const b = parseEmbeds(theirs)
  const byTag: Record<string, EmbedsEntry> = { ...a.byTag }
  for (const [tag, e] of Object.entries(b.byTag ?? {})) byTag[tag] = { ...byTag[tag], ...e }
  return parseEmbeds({ byTag })
}
