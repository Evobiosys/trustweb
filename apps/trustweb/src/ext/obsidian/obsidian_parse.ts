// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 41 obsidian-sync: one Obsidian note (markdown with optional YAML frontmatter) -> the few facts TrustWeb reads from it. Pure, no DOM, no storage;
 * runs in the Web Worker and in tests. The frontmatter reader handles the subset Obsidian writes (scalars, inline lists, block lists), nothing more.
 * Only a short excerpt of the body is kept, never the whole text.
 */
export const EXCERPT_MAX = 280

export interface ParsedNote {
  /** Vault-relative, forward slashes. */
  path: string
  title: string
  /** Frontmatter `name`, else the title. */
  name: string
  /** Folder names above the note, outermost first. */
  folders: string[]
  /** Frontmatter and inline tags without `#`, once each. */
  tags: string[]
  aliases: string[]
  emails: string[]
  phones: string[]
  /** Frontmatter `org` / `company` / `organization`. */
  org?: string
  /** Frontmatter `type` (lower-case). */
  type?: string
  /** Names of the notes this note links to ([[Name|alias#heading]] -> Name), once each. */
  links: string[]
  excerpt: string
}

type Data = Record<string, string | string[]>

// Lines and keys are bounded and split with indexOf: a regex over a line of spaces inside the fences was quadratic.
const LINE_MAX = 2000
const KEY = /^[A-Za-z][\w -]{0,63}$/
const ATTACHMENT = /\.(?:png|jpe?g|gif|webp|svg|pdf|mp3|mp4|m4a|wav|mov|zip|csv|xlsx|docx|pptx|canvas)$/i

const unquote = (v: string): string => v.trim().replace(/^(["'])(.*)\1$/, '$2').trim()
const inline = (v: string): string[] => v.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean)

/** The frontmatter block at the very start of the text (after an optional BOM) and the body behind it. A block with no closing line is no frontmatter. */
export function parseFrontmatter(text: string): { data: Data; body: string } {
  const t = text.replace(/^﻿/, '')
  const m = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(t)
  if (!m) return { data: {}, body: text }
  const data: Data = {}
  let list: string[] | null = null
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    if (line.length > LINE_MAX) { list = null; continue }
    const item = /^\s+-\s+(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line)
    if (item && list) { list.push(unquote(item[1])); continue }
    const colon = line.indexOf(':')
    const name = colon > 0 ? line.slice(0, colon).trim() : ''
    list = null
    if (!KEY.test(name)) continue
    const key = name.toLowerCase()
    const raw = line.slice(colon + 1).trim()
    if (raw === '') { list = []; data[key] = list } else if (raw.startsWith('[')) data[key] = inline(raw)
    else data[key] = unquote(raw)
  }
  for (const [k, v] of Object.entries(data)) if (Array.isArray(v) && !v.length) delete data[k]
  return { data, body: t.slice(m[0].length) }
}

const asList = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : v.split(/[,;]/).map(unquote)).map((x) => x.trim()).filter(Boolean)
const once = (xs: readonly string[]): string[] => [...new Set(xs)]

// Bounded quantifiers: a note can hold a megabyte of base64 or one endless word, and an open-ended scan from every position would be quadratic.
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/g
const STRIP_CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g
const INLINE_TAG = /(?:^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_/-]{0,99})/gu
const WIKILINK = /(?<!!)\[\[([^\]|#\n]{1,200})(?:#[^\]|\n]{0,200})?(?:\|[^\]\n]{0,200})?\]\]/g

function tagsIn(body: string): string[] {
  const out: string[] = []
  for (const m of body.replace(STRIP_CODE, ' ').matchAll(INLINE_TAG)) {
    const tag = m[1].replace(/[/-]+$/, '')
    if (tag && !/^\d+$/.test(tag)) out.push(tag)
  }
  return out
}

function linksIn(body: string): string[] {
  const out: string[] = []
  for (const m of body.matchAll(WIKILINK)) {
    const name = m[1].replace(/\\+$/, '').trim().split('/').pop()!.trim()
    if (!name || ATTACHMENT.test(name)) continue
    out.push(name.replace(/\.md$/i, ''))
  }
  return out
}

const excerptOf = (body: string): string => {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length <= EXCERPT_MAX ? flat : `${flat.slice(0, EXCERPT_MAX - 1).trimEnd()}…`
}

/** The frontmatter's addresses; the body's only when the frontmatter has none and the body names exactly one (cc lines hold other people's). */
function emailsOf(fm: readonly string[], body: string): string[] {
  const own = once(fm.map((e) => e.toLowerCase()))
  if (own.length) return own
  const found = once((body.replace(STRIP_CODE, ' ').match(EMAIL) ?? []).map((e) => e.toLowerCase()))
  return found.length === 1 ? found : []
}

export function parseNote(path: string, text: string): ParsedNote {
  const { data, body } = parseFrontmatter(text)
  const parts = path.split('/')
  const title = (parts.pop() ?? path).replace(/\.md$/i, '')
  const fmTags = asList(data.tags ?? data.tag).flatMap((t) => t.split(/\s+/)).map((t) => t.replace(/^#/, '')).filter(Boolean)
  const type = typeof data.type === 'string' ? data.type.toLowerCase() : undefined
  const phones = asList(data.phones ?? data.phone ?? data.tel ?? data.mobile)
  const note: ParsedNote = {
    path, title, name: (typeof data.name === 'string' && data.name.trim()) || title, folders: parts,
    tags: once([...fmTags, ...tagsIn(body)]),
    aliases: once(asList(data.aliases ?? data.alias)),
    emails: emailsOf(asList(data.emails ?? data.email ?? data.mail), body),
    phones: once(phones),
    links: once(linksIn(body)),
    excerpt: excerptOf(body),
  }
  const org = asList(data.org ?? data.organization ?? data.company)[0]
  if (org) note.org = org
  if (type) note.type = type
  return note
}
