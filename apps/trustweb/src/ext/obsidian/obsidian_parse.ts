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

const unquote = (v: string): string => v.trim().replace(/^(["'])(.*)\1$/, '$2').trim()
const inline = (v: string): string[] => v.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean)

/** The frontmatter block at the very start of the text (after an optional BOM) and the body behind it. A block with no closing line is no frontmatter. */
export function parseFrontmatter(text: string): { data: Data; body: string } {
  const t = text.replace(/^﻿/, '')
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(t)
  if (!m) return { data: {}, body: text }
  const data: Data = {}
  let list: string[] | null = null
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line)
    if (item && list) { list.push(unquote(item[1])); continue }
    const kv = /^([A-Za-z][\w -]*?)\s*:\s*(.*)$/.exec(line)
    list = null
    if (!kv) continue
    const key = kv[1].toLowerCase()
    const raw = kv[2].trim()
    if (raw === '') { list = []; data[key] = list } else if (raw.startsWith('[')) data[key] = inline(raw)
    else data[key] = unquote(raw)
  }
  for (const [k, v] of Object.entries(data)) if (Array.isArray(v) && !v.length) delete data[k]
  return { data, body: t.slice(m[0].length) }
}

const asList = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : v.split(/[,;]/).map(unquote)).map((x) => x.trim()).filter(Boolean)
const once = (xs: readonly string[]): string[] => [...new Set(xs)]

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const STRIP_CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g
const INLINE_TAG = /(?:^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu
const WIKILINK = /(?<!!)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g

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
    const name = m[1].trim().split('/').pop()!.trim()
    if (!name) continue
    if (/\.[A-Za-z0-9]{2,5}$/.test(name) && !/\.md$/i.test(name)) continue
    out.push(name.replace(/\.md$/i, ''))
  }
  return out
}

const excerptOf = (body: string): string => {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length <= EXCERPT_MAX ? flat : `${flat.slice(0, EXCERPT_MAX - 1).trimEnd()}…`
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
    emails: once([...asList(data.emails ?? data.email ?? data.mail), ...(body.replace(STRIP_CODE, ' ').match(EMAIL) ?? [])].map((e) => e.toLowerCase())),
    phones: once(phones),
    links: once(linksIn(body)),
    excerpt: excerptOf(body),
  }
  const org = asList(data.org ?? data.organization ?? data.company)[0]
  if (org) note.org = org
  if (type) note.type = type
  return note
}
