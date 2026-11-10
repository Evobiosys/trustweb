// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 small-ui-c: what the dynamic import yields: the "Docs & chat" view and its row under Settings > Extensions. */
import { el } from '../../../../demo/src/ui/dom'
import { S } from '../../strings'
import type { TwCtx, TwModuleBody } from '../tw_registry'
import { writeConsent } from './embeds_data'
import { MODULE_ID } from './embeds_model'
import { mountEmbeds } from './embeds_view'

function settingsRows(ctx: TwCtx): Node[] {
  const t = ctx.strings.embeds
  const done = el('small', { class: 'meta', hidden: true }, [t.setResetDone])
  return [
    el('button', { class: 'linkbtn', 'data-embeds-reset-consent': '', onclick: () => { writeConsent({}); done.hidden = false } }, [t.setReset]),
    done,
  ]
}

export const body: TwModuleBody = {
  views: [{ id: 'docs-chat', title: S.embeds.title, icon: 'inventory', mount: mountEmbeds }],
  settings: (ctx) => [{ id: MODULE_ID, title: ctx.strings.embeds.title, rows: () => settingsRows(ctx) }],
}
