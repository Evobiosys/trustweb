// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 feed-look: the pure parts of a Mastodon-style Feed row (pattern only): compact age, handle, first link. No I/O. */
const MIN = 60_000
const H = 60 * MIN
const D = 24 * H

/** "now", "5m", "12h", "3d", "1mo", "2y": the short age at the right of the head line. */
export function ageCompact(at: number, now: number): string {
  const ms = now - at
  if (ms < MIN) return 'now'
  if (ms < H) return `${Math.floor(ms / MIN)}m`
  if (ms < D) return `${Math.floor(ms / H)}h`
  const days = Math.floor(ms / D)
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}

const HANDLE_RE = /^@?([A-Za-z0-9_.-]{1,64})@([A-Za-z0-9.-]+\.[A-Za-z]{2,63})$/

/** "@user@host" for a post from the fediverse (explicit `handle`, a remote post's context, a followed account's label); null for local posts. */
export function handleOf(p: { kind: string; who: string | null; context?: string; handle?: string }): string | null {
  const raw = p.handle ?? (p.kind === 'remote' ? p.context : p.kind === 'follow' ? p.who ?? undefined : undefined)
  const m = raw ? HANDLE_RE.exec(raw.trim()) : null
  return m ? `@${m[1]}@${m[2].toLowerCase()}` : null
}

/** The first http(s) link of a text and its domain (no "www."); the card shows only this, nothing is fetched. */
export function firstLink(text: string): { url: string; domain: string } | null {
  const m = /https?:\/\/[^\s<>"]+/i.exec(text)
  if (!m) return null
  const url = m[0].replace(/[).,;:!?\]]+$/, '')
  try { return { url, domain: new URL(url).hostname.replace(/^www\./, '') } } catch { return null }
}
