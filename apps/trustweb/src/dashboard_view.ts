// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 home-dashboard: the Dashboard of one affiliation (community, other group, event, tag): members, requests to me, live now and, when
 * the scope offers a feed, the feed. A chooser in the header lists every affiliation. "Live now" flashes once when the screen opens and then
 * stays still; Refresh plays it again (affiliation.ts createFlash). Managed or unmanaged shows here only inside the Settings of a community or
 * other group (never on the card), through the community module's own rule (canEditSettings, setKind).
 */
import { el } from '../../demo/src/ui/dom'
import { affiliationById, createFlash, dashboardOf, listAffiliations, managedSettingScope, type Affiliation } from './affiliation'
import { loadColourTags } from './colour_tags'
import { eventTagSlug as eventTag } from './event_tag'
import { MODULE_ID, canEditSettings, metaOf, parseCommunity, setKind, type CommunityKind } from './ext/community-mighty/community_data'
import type { AppState } from './model'
import { S } from './strings'

export interface DashboardDeps {
  st: () => AppState
  save: () => void
  redraw: () => void
  /** Is the Feed part switched on (the scope's "offers.feed")? */
  feedOn: () => boolean
  openFeed: () => void
  /** The affiliation shown now (module state of the host), and its setter. */
  current: () => string | undefined
  choose: (id: string) => void
}

const flash = createFlash()
/** The screen was opened: "live now" flashes once again. */
export const dashboardOpened = (): void => flash.replay()

export function createDashboard(d: DashboardDeps): HTMLElement {
  const s = d.st()
  const data = parseCommunity((s.extData as Record<string, unknown> | undefined)?.[MODULE_ID])
  const list = listAffiliations({ eventTag, data, tags: loadColourTags(), events: s.events, people: s.people })
  const root: HTMLElement = el('section', { class: 'dash', 'data-dashboard': '' }, [])
  if (!list.length) { root.append(el('p', { class: 'empty', 'data-dashboard-none': '' }, [S.dashboard.none])); return root }
  const a = affiliationById(list, d.current() ?? '') ?? list[0]
  const info = dashboardOf(a, { eventTag, people: s.people, events: s.events, awayAsks: s.awayAsks, now: Date.now(), feed: d.feedOn() })

  const chooser = el('select', { class: 'dash-chooser', 'aria-label': S.dashboard.chooser, 'data-dashboard-chooser': '', onchange: (e: Event) => { d.choose((e.target as HTMLSelectElement).value); d.redraw() } },
    list.map((x) => el('option', { value: x.id, ...(x.id === a.id ? { selected: '' } : {}) }, [`${x.name} · ${S.dashboard.kinds[x.kind]}`])))

  const dot = el('span', { class: 'dash-dot' + (flash.on ? ' flash' : ''), 'data-dashboard-flash': flash.on ? 'on' : 'off', 'aria-hidden': 'true' })
  dot.addEventListener('animationend', () => { flash.ended(); dot.classList.remove('flash'); dot.setAttribute('data-dashboard-flash', 'off') })
  const refresh = el('button', { class: 'lnk', type: 'button', 'data-dashboard-refresh': '', onclick: () => { flash.replay(); void dot.offsetWidth; dot.classList.add('flash'); dot.setAttribute('data-dashboard-flash', 'on') } }, [S.dashboard.refresh])

  const tiles: Record<string, HTMLElement> = {
    members: el('div', { class: 'card tile', 'data-dashboard-tile': 'members' }, [el('b', {}, [S.dashboard.members]), el('span', { class: 'meta' }, [S.dashboard.memberCount(info.members)])]),
    requests: el('div', { class: 'card tile', 'data-dashboard-tile': 'requests' }, [el('b', {}, [S.dashboard.requests]), el('span', { class: 'meta' }, [S.dashboard.requestCount(info.requests)])]),
    live: el('div', { class: 'card tile', 'data-dashboard-tile': 'live' }, [el('b', {}, [dot, S.dashboard.live]), el('span', { class: 'meta' }, [S.dashboard.liveCount(info.live)]), refresh]),
    feed: el('button', { class: 'card tile', type: 'button', 'data-dashboard-tile': 'feed', onclick: () => d.openFeed() }, [el('b', {}, [S.dashboard.feed])]),
  }
  root.append(
    el('div', { class: 'row wrap dash-head' }, [chooser]),
    el('div', { class: 'grid dash-tiles' }, info.tiles.map((t) => tiles[t])),
    settingsFor(a, d, data) ?? '',
  )
  return root
}

/** Managed or unmanaged, only here: Settings of a community or other group. */
function settingsFor(a: Affiliation, d: DashboardDeps, data: ReturnType<typeof parseCommunity>): HTMLElement | null {
  if (managedSettingScope(a.kind) !== 'settings') return null
  const tag = a.id.slice(a.id.indexOf(':') + 1)
  const m = metaOf(data, tag)
  const can = canEditSettings(data, tag)
  const w = S.w42
  const pick = (kind: CommunityKind, label: string): HTMLElement => el('option', { value: kind, ...(m.kind === kind ? { selected: '' } : {}) }, [label])
  return el('details', { class: 'dash-settings', 'data-dashboard-settings': '' }, [
    el('summary', {}, [w.settings]),
    el('label', { class: 'meta' }, [w.kindLabel, ' ', el('select', {
      'data-dashboard-kind': '', ...(can ? {} : { disabled: '' }),
      onchange: (e: Event) => {
        const s = d.st()
        s.extData = { ...s.extData, [MODULE_ID]: setKind(data, tag, (e.target as HTMLSelectElement).value as CommunityKind) }
        d.save(); d.redraw()
      },
    }, [pick('informal', w.kindInformal), pick('managed', w.kindManaged)])]),
    el('p', { class: 'meta' }, [m.kind === 'managed' ? w.kindHintManaged : w.kindHintInformal]),
  ])
}
