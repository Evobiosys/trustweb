/**
 * The pieces of the Meet page that go with the share modes (share_modes.ts), DOM and words only:
 *   - the share row: THREE buttons, the primary mode, the secondary mode and an arrow that opens Advanced
 *   - the sharing line: one plain sentence saying what a scan hands over in the mode on show, with the tick one tap away
 *   - the Advanced panel: the names block (the contact box sits on the Meet page itself, owner 2026-10-17)
 */
import { el } from '../../demo/src/ui/dom'
import { ShareMode, ModeSharing } from './share_modes'
import { Channel } from './model'
import { S } from './strings'

export interface SharingLineOptions {
  sharing: () => ModeSharing
  /** The channel the mode is about (null for Only TrustWeb): names the sentence. */
  channel: () => Channel | null
  /** The tick of that channel (the hook's share controls) when a link is saved. */
  controls: () => HTMLElement | null
  /** Opens the contact box on that channel (Advanced) so the link can be saved or changed. */
  addLink: (channel: Channel) => void
}

export interface SharingLine {
  el: HTMLElement
  refresh(): void
}

export function createSharingLine(o: SharingLineOptions): SharingLine {
  const text = el('p', { class: 'meta', 'data-signal-sharing': '' })
  const controls = el('div', { class: 'sharing-controls' })
  const edit = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-act': 'edit-link' })
  edit.addEventListener('click', () => { const ch = o.channel(); if (ch) o.addLink(ch) })
  const root = el('div', { class: 'sharing-line' }, [text, controls, edit])
  const refresh = (): void => {
    const s = o.sharing()
    const ch = o.channel()
    const name = ch ? S.chLabel[ch] : ''
    text.textContent = S.sharingLine[s](name)
    text.setAttribute('data-signal-sharing', s)
    const c = s === ModeSharing.Off || s === ModeSharing.NoLink ? null : o.controls()
    controls.replaceChildren(...(c ? [c] : []))
    edit.hidden = s === ModeSharing.Off || ch === null
    edit.textContent = s === ModeSharing.NoLink ? S.sharingAddLink(name) : S.sharingEditLink(name)
  }
  refresh()
  return { el: root, refresh }
}

export interface ShareRowOptions {
  /** The modes on the two buttons, in order (share_modes.ts rowModes). */
  modes: () => ShareMode[]
  current: () => ShareMode
  pick: (mode: ShareMode) => void
  /** The Advanced panel is open: the arrow shows it. */
  isOpen: () => boolean
  toggleAdvanced: () => void
}

export interface ShareRow {
  el: HTMLElement
  refresh(): void
}

/** [primary][secondary][arrow down]: the pinned modes in pin order, and the way into Advanced. */
export function createShareRow(o: ShareRowOptions): ShareRow {
  const row = el('div', { class: 'seg share-row', role: 'group', 'aria-label': S.shareRowLabel, 'data-share-row': '' })
  const now = el('p', { class: 'meta', 'data-share-now': '', hidden: true })
  const root = el('div', { class: 'share-row-wrap' }, [row, now])
  const refresh = (): void => {
    const shown = o.modes()
    const cur = o.current()
    const buttons = shown.map((m, i) => el('button', {
      class: cur === m ? 'on' : '', type: 'button', 'aria-pressed': String(cur === m), 'data-mode': m, 'data-slot': i === 0 ? 'primary' : 'secondary',
      onclick: () => o.pick(m),
    }, [S.shareMode[m]]))
    const open = o.isOpen()
    const hidden = !shown.includes(cur)
    const arrow = el('button', {
      class: 'share-arrow' + (hidden ? ' on' : ''), type: 'button', 'data-act': 'advanced', 'aria-expanded': String(open), 'aria-label': S.advancedLabel,
      onclick: () => o.toggleAdvanced(),
    }, [open ? '▴' : '▾'])
    row.replaceChildren(...buttons, arrow)
    // The remembered mode may sit outside the two buttons (Only Signal, for one): it must still show as the one in force.
    now.hidden = !hidden
    now.textContent = hidden ? S.shareModeNow(S.shareMode[cur]) : ''
  }
  refresh()
  return { el: root, refresh }
}

export interface AdvancedOptions {
  /** The names block (names_view.ts). `available` is false until this phone holds a code on the server. */
  names: { available: () => boolean; el: HTMLElement }
}

export interface AdvancedView {
  el: HTMLElement
  refresh(): void
  setOpen(open: boolean): void
  isOpen(): boolean
}

export function createAdvanced(o: AdvancedOptions): AdvancedView {
  const panel = el('div', { class: 'advanced-panel', role: 'group', 'aria-label': S.advancedLabel, hidden: true, 'data-advanced-panel': '' })
  const root = el('div', { class: 'advanced' }, [panel])

  const refresh = (): void => {
    // The names block is built once and only moved here, so a redraw never clears what is being typed.
    panel.replaceChildren(...(o.names.available() ? [o.names.el] : []))
  }
  refresh()
  return {
    el: root,
    refresh,
    setOpen: (open) => { panel.hidden = !open },
    isOpen: () => !panel.hidden,
  }
}
