// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 39 community-mighty: what the dynamic import yields: the Community view and its rows under Settings > Extensions > Community. */
import { el } from '../../../../demo/src/ui/dom'
import { loadColourTags } from '../../colour_tags'
import { S } from '../../strings'
import { communityTags } from '../../trustzones'
import type { TwCtx, TwModuleBody } from '../tw_registry'
import { MODULE_ID, NAV, communityTagOf, type NavId } from './community_model'
import { mountCommunity, readData, writeData } from './community_view'

function settingsRows(ctx: TwCtx): Node[] {
  const t = ctx.strings.community
  const s = ctx.store()
  const d = readData(s)
  const tags = communityTags(loadColourTags())
  const cur = communityTagOf(d, s, loadColourTags())
  const tagSelect = el('select', {
    'data-community-tag': '', 'aria-label': t.setTag,
    onchange: (e: Event) => { writeData(ctx, { ...readData(ctx.store()), tag: (e.target as HTMLSelectElement).value }) },
  }, tags.length ? tags.map((tag) => el('option', { value: tag.id, ...(tag.id === cur ? { selected: '' } : {}) }, [tag.label ?? tag.id])) : [el('option', { value: '' }, [t.setTagNone])])
  const navRow = (n: NavId): HTMLElement => el('label', { class: 'radio', 'data-community-nav-toggle': n }, [
    el('input', {
      type: 'checkbox', ...(d.navOff?.includes(n) ? {} : { checked: '' }),
      onchange: (e: Event) => {
        const now = readData(ctx.store())
        const off = new Set(now.navOff ?? [])
        if ((e.target as HTMLInputElement).checked) off.delete(n); else off.add(n)
        writeData(ctx, { ...now, navOff: NAV.filter((x) => off.has(x)) })
      },
    }),
    el('b', {}, [t.nav[n]]),
  ])
  const done = el('small', { class: 'meta', hidden: true }, [t.setResetDone])
  return [
    el('label', { class: 'community-set-tag' }, [el('b', {}, [t.setTag]), ' ', tagSelect]),
    el('p', { class: 'meta' }, [t.setNav]),
    ...NAV.map(navRow),
    el('button', {
      class: 'linkbtn', 'data-community-reset-consent': '',
      onclick: () => { const now = readData(ctx.store()); delete now.docsConsent; delete now.telegramConsent; writeData(ctx, now); done.hidden = false },
    }, [t.setReset]),
    done,
  ]
}

export const body: TwModuleBody = {
  views: [{ id: 'community', title: S.community.title, icon: 'users', mount: mountCommunity }],
  settings: (ctx) => [{ id: MODULE_ID, title: ctx.strings.community.title, rows: () => settingsRows(ctx) }],
}
