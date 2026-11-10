// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39 small-ui-b: "Connect my mail", the part that needs no mail server. The person pastes the "your export is ready" mail; only
 * the sender, the subject and the first https link are read from it (never the rest of the text) and handed to export_watch.ts.
 * Pure, no DOM.
 */
import { matchMail, type ExportMail, type Watch } from './export_watch'
import type { RtbfService } from './data/services_rtbf'

const FROM = /^from:.*?<?([^\s<>@]+@[^\s<>]+)>?\s*$/im
const SUBJECT = /^subject:\s*(.+)$/im
const LINK = /https:\/\/[^\s<>"')]+/i

/** The three fields a mail watcher may read. Empty strings where the pasted text has none. */
export function parseExportMail(raw: string): ExportMail {
  return { from: raw.match(FROM)?.[1] ?? '', subject: raw.match(SUBJECT)?.[1].trim() ?? '', url: raw.match(LINK)?.[0] }
}

/** The mail as the watcher event wants it, or null when it is not this service's export mail (sender, subject, https link). */
export function pastedMail(svc: Pick<RtbfService, 'mailFrom'>, raw: string): ExportMail | null {
  const mail = parseExportMail(raw)
  return matchMail(svc, mail) ? mail : null
}

/** Which service a pasted mail belongs to: the first whose sender domain matches and that is not already past "waiting" (a link seen, importing or done stays). */
export function pasteTarget(services: readonly (Pick<RtbfService, 'id' | 'mailFrom'>)[], raw: string, watches: Record<string, Watch> | undefined): { id: string; mail: ExportMail } | null {
  for (const svc of services) {
    const state = watches?.[svc.id]?.state
    if (state && state !== 'waiting' && state !== 'expired') continue
    const mail = pastedMail(svc, raw)
    if (mail) return { id: svc.id, mail }
  }
  return null
}
