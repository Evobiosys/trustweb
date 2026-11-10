// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 41 community-mode: the DOM side. The host app (main.ts) hands over a few callbacks; this file builds the Personal | Community pill,
 * the Community bottom row, the "you are at an event" notice and the Settings > Variations rows. It never imports main.ts.
 * The interface picked in this session lives in sessionStorage; the default per profile in AppState.twSettings.interfaces.
 */
import { el } from '../../../../demo/src/ui/dom'
import { ICONS } from '../../icons'
import type { AppState } from '../../model'
import { S } from '../../strings'
import { alphaHeading } from '../../alpha_heading'
import { parseCommunity } from '../community-mighty/community_data'
import { isEnabled, profileOf, TW_PROFILES, twRegistry, type TwCtx, type UiInterface } from '../registry'
import {
  COMM_ICON, COMM_ITEMS, MODE_ID, communityBar, dismissSuggestion, moveItem, parseInterface, parseModeData, removeVersion, resolveInterface,
  restoreVersion, saveVersion, setDefaultInterface, suggestForEvent, toggleItem, type CommItem, type ModeData,
} from './mode'

const PICK_KEY = 'trustweb.ui.interface'
const COMMUNITY_MODULE = 'community-mighty'

export interface ModeHost {
  state: () => AppState | null
  save: () => void
  ctx: () => TwCtx
  /** A Personal|Community switch may show on the screen now (Web, People, the Community view). */
  overview: () => boolean
  tabButton: (target: string, label: string, iconSvg: string, onclick: () => void) => HTMLElement
  tabsEl: () => HTMLElement
  /** The bottom row and the screen follow a change. */
  changed: () => void
  /** Shows the Community view (mounted at once), or Web for 'web'. */
  openItem: (item: CommItem) => void
  /** Back to the Personal shell's Web screen. */
  openPersonal: () => void
  /** Redraws an open Settings sheet. */
  settings: () => void
  newId: () => string
}

const sessionPick = (): string | null => { try { return sessionStorage.getItem(PICK_KEY) } catch { return null } }
const remember = (m: UiInterface): void => { try { sessionStorage.setItem(PICK_KEY, m) } catch { /* the switch holds until the next redraw only */ } }

export function createModeShell(host: ModeHost) {
  let section: { nav: string; chat: boolean } = { nav: 'home', chat: false }
  const on = (): boolean => isEnabled(MODE_ID)
  const data = (): ModeData => parseModeData(host.state()?.extData?.[MODE_ID])
  const write = (d: ModeData): void => {
    const s = host.state()
    if (!s) return
    s.extData = { ...s.extData, [MODE_ID]: d }
    host.save()
  }
  const navOff = (): string[] => parseCommunity(host.state()?.extData?.[COMMUNITY_MODULE]).navOff ?? []
  const now = (): UiInterface => (on() ? resolveInterface(host.state()?.twSettings, sessionPick()) : 'personal')
  const label = (i: CommItem): string => (i === 'web' ? S.mode.web : S.community.nav[i])

  /** The Community view needs its module on; it loads on first use. */
  async function pick(mode: UiInterface, item: CommItem = 'home'): Promise<void> {
    remember(mode)
    if (mode === 'community') {
      if (!isEnabled(COMMUNITY_MODULE)) await twRegistry.setEnabled(COMMUNITY_MODULE, true)
      host.changed()
      host.openItem(item)
    } else {
      host.changed()
      host.openPersonal()
    }
  }

  function pill(): HTMLElement {
    const cur = now()
    const b = (m: UiInterface): HTMLElement => el('button', {
      type: 'button', role: 'radio', class: 'mode-opt' + (m === cur ? ' on' : ''), 'aria-checked': String(m === cur), 'data-mode': m,
      onclick: () => { if (m !== cur) void pick(m) },
    }, [S.mode[m]])
    return el('div', { class: 'mode-pill', role: 'radiogroup', 'aria-label': S.mode.pickAria, 'data-mode-pill': '' }, [b('personal'), b('community')])
  }

  /** The suggestion line for an event I am going to that is on today; null when none, answered, or already in Community. */
  function notice(): HTMLElement | null {
    const s = host.state()
    if (!s) return null
    const rsvp = (s.extData?.['events-view'] as { rsvp?: Record<string, string> } | undefined)?.rsvp
    const hit = suggestForEvent({ mode: now(), events: s.events, rsvp, data: data(), now: Date.now() })
    if (!hit) return null
    const answer = (kind: 'later' | 'never'): void => { write(dismissSuggestion(data(), hit.id, kind, Date.now())); host.changed() }
    return el('div', { class: 'mode-notice', role: 'status', 'data-mode-notice': hit.id }, [
      el('span', {}, [S.mode.atEvent(hit.name)]),
      el('button', { type: 'button', class: 'mode-act strong', 'data-mode-switch': '', onclick: () => { void pick('community', 'events') } }, [S.mode.switch]),
      el('button', { type: 'button', class: 'mode-act', 'data-mode-later': '', onclick: () => answer('later') }, [S.mode.notNow]),
      el('button', { type: 'button', class: 'mode-act', 'data-mode-never': '', onclick: () => answer('never') }, [S.mode.never]),
    ])
  }

  /** Marks the current section's button; `webScreen` = the Web screen is showing. */
  function mark(webScreen: boolean, extScreen: boolean): void {
    host.tabsEl().querySelectorAll<HTMLElement>('[data-go^="community:"]').forEach((b) => {
      const item = b.getAttribute('data-go')!.slice('community:'.length)
      b.classList.toggle('on', item === 'web' ? webScreen : item === 'chat' ? extScreen && section.chat : extScreen && item === section.nav)
    })
  }

  return {
    now,
    /** Called after every screen draw: the switch beside the TrustZone heading (or in a row of its own), and the notice under the header. */
    mount(screen: HTMLElement): void {
      if (!on()) return
      const hdr = screen.querySelector('.hdr')
      if (host.overview()) {
        const row = screen.querySelector('.web-view-row')
        if (row) row.prepend(pill()); else hdr?.after(el('div', { class: 'web-view-row mode-row' }, [pill()]))
      }
      const n = notice()
      if (n) (screen.querySelector('.mode-row') ?? screen.querySelector('.web-view-row') ?? hdr)?.after(n)
    },
    /** The Community bottom row, or null in the Personal shell. */
    tabs(): HTMLElement[] | null {
      if (now() !== 'community') return null
      return communityBar(data(), navOff()).map((i) => host.tabButton(`community:${i}`, label(i), ICONS[COMM_ICON[i]], () => host.openItem(i)))
    },
    mark,
    /** Boot: listens to the Community view's section and, when the default is Community, makes sure its module is on. */
    start(): void {
      host.ctx().bus.on('community-section', (v) => {
        const o = v as { nav?: string; chat?: boolean } | undefined
        section = { nav: o?.nav ?? 'home', chat: o?.chat === true }
        mark(false, true)
      })
      if (now() === 'community' && !isEnabled(COMMUNITY_MODULE)) void twRegistry.setEnabled(COMMUNITY_MODULE, true).then(host.changed)
    },
    /** Settings > Variations: the default interface per variation, the Community layout, my versions. */
    settingsRows(): Node[] {
      const s = host.state()
      if (!s || !on()) return []
      const d = data()
      const redo = (next: ModeData): void => { write(next); host.changed(); host.settings() }
      const cur = profileOf(s.twSettings)
      const defaultRow = (id: (typeof TW_PROFILES)[number]['id']): HTMLElement => {
        const val = s.twSettings?.interfaces?.[id] ?? 'personal'
        const sel = el('select', {
          class: 'field', 'aria-label': `${S.mode.defaultTitle}: ${S.var.names[id]}`, 'data-mode-default': id,
          onchange: (e: Event) => {
            const m = parseInterface((e.target as HTMLSelectElement).value)
            if (!m) return
            s.twSettings = setDefaultInterface(s.twSettings, id, m)
            host.save()
            if (id === cur) { remember(m); void pick(m).then(host.settings) } else host.settings()
          },
        }, (['personal', 'community'] as const).map((m) => el('option', { value: m, ...(m === val ? { selected: '' } : {}) }, [S.mode[m]])))
        return el('label', { class: 'mode-default-row' }, [el('span', {}, [S.var.names[id] + (id === cur ? ` · ${S.var.current}` : '')]), sel])
      }
      const row = communityBar(d, [])
      const layoutRow = (i: CommItem): HTMLElement => {
        const shown = row.includes(i)
        const mv = (dir: -1 | 1, glyph: string): HTMLElement => el('button', {
          type: 'button', class: 'mode-act', 'data-mode-move': `${i}:${dir}`, 'aria-label': (dir < 0 ? S.mode.left : S.mode.right)(label(i)),
          ...(shown ? {} : { disabled: '' }), onclick: () => redo(moveItem(d, i, dir)),
        }, [glyph])
        return el('div', { class: 'mode-layout-row' }, [
          el('label', {}, [el('input', { type: 'checkbox', 'data-mode-item': i, ...(shown ? { checked: '' } : {}), onchange: () => redo(toggleItem(d, i)) }), ' ', label(i)]),
          mv(-1, '←'), mv(1, '→'),
        ])
      }
      const name = el('input', { type: 'text', class: 'field', maxlength: '40', placeholder: S.mode.versionName, 'aria-label': S.mode.versionName, 'data-mode-version-name': '' })
      const versions = d.versions ?? []
      return [
        el('h4', { class: 'eyebrow' }, alphaHeading(S.mode.defaultTitle)),
        el('p', { class: 'meta' }, [S.mode.defaultHint]),
        ...TW_PROFILES.map((p) => defaultRow(p.id)),
        el('h4', { class: 'eyebrow' }, alphaHeading(S.mode.layoutTitle)),
        el('p', { class: 'meta' }, [S.mode.layoutHint]),
        ...[...row, ...COMM_ITEMS.filter((i) => !row.includes(i))].map(layoutRow),
        el('div', { class: 'mode-save' }, [name, el('button', {
          type: 'button', class: 'mode-act strong', 'data-mode-save': '', onclick: () => redo(saveVersion(d, name.value, host.newId())),
        }, [S.mode.saveVersion])]),
        ...(versions.length ? [el('h4', { class: 'eyebrow' }, [S.mode.versionsTitle])] : []),
        ...versions.map((v) => el('div', { class: 'mode-version', 'data-mode-version': v.id }, [
          el('b', {}, [v.name]),
          el('button', { type: 'button', class: 'mode-act', 'data-mode-use': v.id, onclick: () => redo(restoreVersion(d, v.id)) }, [S.mode.use]),
          el('button', { type: 'button', class: 'mode-act', 'data-mode-remove': v.id, onclick: () => redo(removeVersion(d, v.id)) }, [S.mode.remove]),
        ])),
      ]
    },
  }
}
