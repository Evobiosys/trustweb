/**
 * The pieces of the Meet page that go with the share modes (share_modes.ts), DOM and words only:
 *   - the share row: THREE buttons, the primary mode, the secondary mode and an arrow that opens Advanced
 *   - the sharing line: one plain sentence saying what a scan hands over in the mode on show, with the tick one tap away
 *   - the Advanced panel: EVERY mode with a pin toggle, the notes of the mode on show, the contact box, then the names block
 */
import { el } from '../../demo/src/ui/dom'
import { cleanUsername } from './connect_code'
import type { ClaimOutcome } from './connect_code'
import { ShareMode, SHARE_MODES, ModeSharing, channelOf } from './share_modes'
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
  current: () => ShareMode
  pins: () => ShareMode[]
  pick: (mode: ShareMode) => void
  /** Pins or unpins; returns false when a third pin was refused. */
  togglePin: (mode: ShareMode) => boolean
  /** Is the channel of this mode saved? (Only TrustWeb needs none.) */
  available: (mode: ShareMode) => boolean
  /** Does the code of the mode on show hold a phone number (the QR then needs the camera app)? */
  cameraOnly: () => boolean
  /** The contact box (one for Meet > Advanced and Settings). */
  contactBox: HTMLElement
  /** The optional username on our server (V1 POST /name). `available` is false until this phone holds a code there. */
  username: { available: () => boolean; current: () => string; claim: (name: string) => Promise<ClaimOutcome> }
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

  const usernameRow = (): HTMLElement => {
    const input = el('input', {
      class: 'field', maxlength: '30', placeholder: S.usernamePh, 'aria-label': S.usernameLabel, 'data-username': '',
      autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', value: o.username.current(),
    })
    const status = el('p', { class: 'meta', role: 'status', 'data-username-status': '' }, [o.username.current() ? S.usernameHeld(o.username.current()) : ''])
    const go = async (raw: string): Promise<void> => {
      const out = await o.username.claim(cleanUsername(raw))
      if (out.ok) {
        input.value = out.name
        status.textContent = out.name ? S.usernameHeld(out.name) : S.usernameReleased
      } else status.textContent = S.usernameFailed[out.error]
    }
    return el('div', { class: 'username-row', 'data-username-row': '' }, [
      el('h4', { class: 'eyebrow' }, [S.usernameLabel]),
      input,
      el('div', { class: 'row-actions' }, [
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-act': 'claim-name', onclick: () => void go(input.value) }, [S.usernameClaim]),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-act': 'release-name', onclick: () => void go('') }, [S.usernameRelease]),
      ]),
      status,
      el('p', { class: 'meta' }, [S.usernameHint]),
    ])
  }
  let username: HTMLElement | null = null
  const pinNote = el('p', { class: 'meta', role: 'status', 'data-pin-note': '' })

  const modeRow = (m: ShareMode): HTMLElement => {
    const cur = o.current() === m
    const pinIndex = o.pins().indexOf(m)
    const channel = channelOf(m)
    return el('div', { class: 'mode-row', 'data-mode-row': m }, [
      el('button', {
        class: 'radio' + (cur ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(cur), 'data-mode': m,
        onclick: () => o.pick(m),
      }, [el('b', {}, [S.shareMode[m]]), el('small', {}, [S.shareModeHint[m]]), channel && !o.available(m) ? el('small', { 'data-mode-missing': m }, [S.shareModeMissing(S.chLabel[channel])]) : null]),
      el('button', {
        class: 'btn btn-ghost btn-sm pin' + (pinIndex >= 0 ? ' on' : ''), type: 'button', 'aria-pressed': String(pinIndex >= 0), 'data-pin': m,
        onclick: () => { pinNote.textContent = o.togglePin(m) ? '' : S.pinRefused },
      }, [pinIndex >= 0 ? S.pinPinned(pinIndex + 1) : S.pinPin]),
    ])
  }

  const refresh = (): void => {
    const cur = o.current()
    const notes: HTMLElement[] = []
    if (o.cameraOnly()) notes.push(el('p', { class: 'meta', 'data-scan': 'camera-only' }, [S.meetScanCameraNote]))
    else if (cur === ShareMode.OnlySignal || cur === ShareMode.OnlyWhatsApp) notes.push(el('p', { class: 'meta', 'data-adv-note': 'camera' }, [S.advancedOnlyNote]))
    notes.push(el('p', { class: 'meta' }, [S.advancedFollow]))
    // Built once, so a redraw of the choices never clears what is being typed.
    if (o.username.available()) { username ??= usernameRow() } else username = null
    panel.replaceChildren(
      el('p', { class: 'meta' }, [S.pinLead]),
      ...SHARE_MODES.map(modeRow), pinNote, ...notes, o.contactBox, ...(username ? [username] : []),
    )
  }
  refresh()
  return {
    el: root,
    refresh,
    setOpen: (open) => { panel.hidden = !open },
    isOpen: () => !panel.hidden,
  }
}
