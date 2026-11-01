// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 28 (sovereign-import): the export-mail watcher, the pure part. A service mails "your export is ready" with a link; the watcher
 * moves one service through waiting -> link_seen -> importing -> done, or expired. The mail feed itself is NOT built: there is no
 * mail route in this app yet (see sovereign_switch_view.ts), so today the owner taps "The mail arrived"; `watchStep` takes the same
 * event a mail feed would send, so the feed plugs in without a change here. Only sender, subject and link of a mail are ever read.
 * Ported in spirit from the owner's sovereign-takeout watcher.py (its states: export_requested -> awaiting_archive -> downloaded).
 */
import type { RtbfService } from './data/services_rtbf'

export type WatchState = 'waiting' | 'link_seen' | 'importing' | 'done' | 'expired'

export interface Watch {
  state: WatchState
  startedAt: number
  /** When the link mail was seen, and the link in it. */
  linkAt?: number
  url?: string
}

export interface ExportMail { from: string; subject: string; url?: string }

export type WatchEvent =
  | { type: 'tick' }
  | { type: 'mail'; mail: ExportMail }
  | { type: 'import' }
  | { type: 'imported' }
  | { type: 'failed' }

const DAY_MS = 86_400_000
/** GUESS: services keep the link about a week (Google: 7 days); the slowest services take up to 30 days to send it. */
export const LINK_TTL_MS = 7 * DAY_MS
export const WAIT_MAX_MS = 31 * DAY_MS

export const startWatch = (now: number): Watch => ({ state: 'waiting', startedAt: now })

/** Is this the export-ready mail of this service: sender domain (or subdomain) listed, an https link, and a subject about the export. */
export function matchMail(svc: Pick<RtbfService, 'mailFrom'>, mail: ExportMail): boolean {
  const domain = mail.from.split('@').pop()?.toLowerCase() ?? ''
  const fromOk = (svc.mailFrom ?? []).some((d) => domain === d || domain.endsWith('.' + d))
  return fromOk && /^https:\/\//.test(mail.url ?? '') && /export|download|archive|data|takeout|ready/i.test(mail.subject)
}

export function watchStep(w: Watch, ev: WatchEvent, now: number): Watch {
  if (w.state === 'done' || w.state === 'expired') return w
  if (w.state === 'waiting' && now - w.startedAt > WAIT_MAX_MS) return { ...w, state: 'expired' }
  if (w.state === 'link_seen' && w.linkAt !== undefined && now - w.linkAt > LINK_TTL_MS) return { ...w, state: 'expired' }
  switch (ev.type) {
    case 'mail': return w.state === 'waiting' ? { ...w, state: 'link_seen', linkAt: now, url: ev.mail.url } : w
    case 'import': return w.state === 'link_seen' ? { ...w, state: 'importing' } : w
    case 'imported': return w.state === 'importing' ? { ...w, state: 'done' } : w
    case 'failed': return w.state === 'importing' ? { ...w, state: 'link_seen' } : w
    default: return w
  }
}
