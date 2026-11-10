// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 feed-events: what the dynamic import yields: the Events view and its rows under Settings > Extensions > Events. */
import { el } from '../../../../demo/src/ui/dom'
import { S } from '../../strings'
import type { TwCtx, TwModuleBody } from '../tw_registry'
import { DEFAULT_MAP_URL, MODULE_ID, mapEmbedUrl } from './events_model'
import { mountEvents, readEvents, writeEvents, writeMapConsent } from './events_view'

function settingsRows(ctx: TwCtx): Node[] {
  const t = ctx.strings.eventsView
  const d = readEvents(ctx.store())
  const input = el('input', { type: 'url', value: d.mapUrl ?? DEFAULT_MAP_URL, placeholder: t.mapPh, 'aria-label': t.setMap, 'data-events-set-map': '' }) as HTMLInputElement
  const note = el('small', { class: 'meta', hidden: true }, [])
  return [
    el('label', { class: 'events-set-map' }, [el('b', {}, [t.setMap]), ' ', input]),
    el('button', {
      class: 'linkbtn', type: 'button', 'data-events-set-save': '',
      onclick: () => {
        const next = readEvents(ctx.store())
        const raw = input.value.trim()
        const url = raw ? mapEmbedUrl(raw) : null
        note.hidden = false
        if (raw && !url) { note.textContent = t.mapBad; return }
        if (url) next.mapUrl = url; else delete next.mapUrl
        writeEvents(ctx, next)
        note.textContent = t.save
      },
    }, [t.save]),
    note,
    el('button', { class: 'linkbtn', type: 'button', 'data-events-reset-consent': '', onclick: () => writeMapConsent(false) }, [t.setReset]),
  ]
}

export const body: TwModuleBody = {
  views: [{ id: MODULE_ID, title: S.eventsView.viewTitle, icon: 'calendar', mount: mountEvents }],
  settings: (ctx) => [{ id: MODULE_ID, title: ctx.strings.eventsView.title, rows: () => settingsRows(ctx) }],
}
