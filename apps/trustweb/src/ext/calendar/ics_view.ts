// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Calendar module view (wave 24, cal6): the Export / Import row. The file goes to the share sheet or a download; nothing is sent anywhere. */
import { el } from '../../../../demo/src/ui/dom'
import { S } from '../../strings'
import type { ExtHooks } from '../registry'
import { fromIcs, importIcs, toIcs } from './ics'

const FILE = 'trustweb-calendar.ics'

async function hand(text: string): Promise<void> {
  const file = new File([text], FILE, { type: 'text/calendar' })
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return } catch (e) { if ((e as Error).name === 'AbortError') return }
  }
  const a = el('a', { href: URL.createObjectURL(file), download: FILE })
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

export function createIcs(h: ExtHooks): { row: () => HTMLElement } {
  const pick = el('input', { type: 'file', accept: '.ics,text/calendar', hidden: '', 'data-cal-import-file': '' }) as HTMLInputElement
  pick.addEventListener('change', () => {
    const f = pick.files?.[0]
    pick.value = ''
    if (!f) return
    void f.text().then((t) => {
      const parsed = fromIcs(t)
      const { added, updated } = importIcs(h.state(), parsed, h.newId, Date.now())
      h.save(); h.redraw()
      h.toast(S.cal.icsImported(added, updated) + (parsed.skipped ? S.cal.icsSkipped(parsed.skipped) : ''))
    }, () => h.toast(S.cal.icsFailed))
  })
  return {
    row: () => el('div', { class: 'cal-ics' }, [
      el('div', { class: 'cal-modes' }, [
        el('button', { class: 'btn btn-ghost btn-sm', 'data-cal-export': '', onclick: () => { void hand(toIcs(h.state().events ?? [], h.state().tasks ?? [], Date.now())) } }, [S.cal.icsExport]),
        el('button', { class: 'btn btn-ghost btn-sm', 'data-cal-import': '', onclick: () => pick.click() }, [S.cal.icsImport]),
        pick,
      ]),
      el('p', { class: 'meta' }, [S.cal.icsHint]),
    ]),
  }
}
