// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 feed-events: what the dynamic import yields: the Feed view and its row under Settings > Extensions > Feed. */
import { el } from '../../../../demo/src/ui/dom'
import { S } from '../../strings'
import type { TwCtx, TwModuleBody } from '../tw_registry'
import { MODULE_ID } from './feed_model'
import { mountFeed, readFeed, writeFeed } from './feed_view'

function settingsRows(ctx: TwCtx): Node[] {
  const t = ctx.strings.feedView
  const on = readFeed(ctx.store()).preview === true
  return [
    el('label', { class: 'radio', 'data-feed-preview-toggle': '' }, [
      el('input', {
        type: 'checkbox', ...(on ? { checked: '' } : {}),
        onchange: (e: Event) => {
          const d = readFeed(ctx.store())
          if ((e.target as HTMLInputElement).checked) d.preview = true; else delete d.preview
          writeFeed(ctx, d)
        },
      }),
      el('b', {}, [t.previewSet]),
    ]),
    el('p', { class: 'meta' }, [t.previewHint]),
  ]
}

export const body: TwModuleBody = {
  views: [{ id: MODULE_ID, title: S.feedView.viewTitle, icon: 'feed', mount: mountFeed }],
  settings: (ctx) => [{ id: MODULE_ID, title: ctx.strings.feedView.title, rows: () => settingsRows(ctx) }],
}
