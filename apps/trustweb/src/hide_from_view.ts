// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44b hide-from-crypto, the screens: the sealed line under "Hide from" and the asker's notice + inbox row for a verified report. */
import { el } from '../../demo/src/ui/dom'
import type { HideReportEntry } from './hide_reports'
import { inboxId, inboxPut, newItem } from './notify_inbox'
import { S } from './strings'

/** Under the "Hide from" row of an ask that travels: a lock and one line. */
export function hideSealedLine(): HTMLElement {
  return el('p', { class: 'hint hide-sealed', 'data-hide-sealed': '' }, [el('span', { 'aria-hidden': 'true' }, ['🔒 ']), S.hideFrom.sealed])
}

export function hideReportText(e: HideReportEntry): { title: string; body: string } {
  return { title: S.hideFrom.noticeTitle, body: e.why === 'unsupported' ? S.hideFrom.unsupported(e.step) : S.hideFrom.tampered(e.step) }
}

/** The asker's side of a verified report: one inbox row (kind ask) and the notice. */
export function announceHideReport(e: HideReportEntry, notice: (title: string, body: string) => void): void {
  const t = hideReportText(e)
  void inboxPut(newItem('ask', t.title, t.body, e.at, inboxId(e.at, 0)))
  notice(t.title, t.body)
}
