/**
 * The two small pieces of the Meet page that go with the Advanced choice (connect_modes.ts), DOM and words only:
 *   - the sharing line: one plain sentence saying whether a scan also hands over the Signal link, and why not when it does not,
 *     with the tick (the caller passes the controls) one tap away
 *   - the Advanced disclosure (collapsed by default) with the three choices
 */
import { el } from '../../demo/src/ui/dom'
import { cleanUsername } from './connect_code'
import type { ClaimOutcome } from './connect_code'
import { CONNECT_MODES, ConnectMode, SignalSharing } from './connect_modes'
import { S } from './strings'

export interface SharingLineOptions {
  sharing: () => SignalSharing
  /** The provider + tick controls (main.ts shareControlsFor) when a Signal link is saved. */
  controls: () => HTMLElement | null
  /** Opens the Signal link editor (save, change). */
  editSignal: () => void
}

export interface SharingLine {
  el: HTMLElement
  refresh(): void
}

export function createSharingLine(o: SharingLineOptions): SharingLine {
  const text = el('p', { class: 'meta', 'data-signal-sharing': '' })
  const controls = el('div', { class: 'sharing-controls' })
  const edit = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-act': 'edit-signal', onclick: () => o.editSignal() })
  const root = el('div', { class: 'sharing-line' }, [text, controls, edit])
  const refresh = (): void => {
    const s = o.sharing()
    text.textContent = S.sharingLine[s]
    text.setAttribute('data-signal-sharing', s)
    const c = s === SignalSharing.Off || s === SignalSharing.NoLink ? null : o.controls()
    controls.replaceChildren(...(c ? [c] : []))
    edit.hidden = s === SignalSharing.Off
    edit.textContent = s === SignalSharing.NoLink ? S.sharingAddSignal : S.sharingEditSignal
  }
  refresh()
  return { el: root, refresh }
}

export interface AdvancedOptions {
  /** "Signal", "Molly" or "Signal or Molly": the provider word of the wave 6 setting. */
  providerWord: () => string
  getMode: () => ConnectMode
  setMode: (m: ConnectMode) => void
  /** Is a Signal link saved? (Only Molly/Signal needs one.) */
  hasSignal: () => boolean
  /** Does the saved link hold a phone number (the QR then needs the camera app)? */
  cameraOnly: () => boolean
  editSignal: () => void
  /** The optional username on our server (V1 POST /name). `available` is false until this phone holds a code there. */
  username: { available: () => boolean; current: () => string; claim: (name: string) => Promise<ClaimOutcome> }
}

export interface AdvancedView {
  el: HTMLElement
  refresh(): void
}

export function createAdvanced(o: AdvancedOptions): AdvancedView {
  const toggle = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-act': 'advanced', 'aria-expanded': 'false' }, [S.advancedLabel + ' ▾'])
  const panel = el('div', { class: 'advanced-panel', role: 'radiogroup', 'aria-label': S.advancedLabel, hidden: true })
  const root = el('div', { class: 'advanced' }, [toggle, panel])
  toggle.addEventListener('click', () => {
    const open = panel.hidden
    panel.hidden = !open
    toggle.setAttribute('aria-expanded', String(open))
    toggle.textContent = S.advancedLabel + (open ? ' ▴' : ' ▾')
  })

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

  const refresh = (): void => {
    const word = o.providerWord()
    const mode = o.getMode()
    const choices = CONNECT_MODES.map((m) => el('button', {
      class: 'radio' + (mode === m ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(mode === m), 'data-mode': m,
      onclick: () => { o.setMode(m) },
    }, [el('b', {}, [S.advancedMode[m](word)]), el('small', {}, [S.advancedModeHint[m](word)])]))
    const notes: HTMLElement[] = []
    if (mode === ConnectMode.OnlyMolly) {
      if (!o.hasSignal()) {
        notes.push(el('p', { class: 'meta', 'data-adv-note': 'no-link' }, [S.advancedMollyNone]))
        notes.push(el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => o.editSignal() }, [S.sharingAddSignal]))
      } else {
        notes.push(el('p', { class: 'meta', 'data-adv-note': 'camera' }, [S.advancedMollyNote]))
        if (o.cameraOnly()) notes.push(el('p', { class: 'meta', 'data-scan': 'camera-only' }, [S.meetScanCameraNote]))
      }
    }
    notes.push(el('p', { class: 'meta' }, [S.advancedFollow]))
    // Built once, so a redraw of the choices never clears what is being typed.
    if (o.username.available()) { username ??= usernameRow() } else username = null
    panel.replaceChildren(...choices, ...notes, ...(username ? [username] : []))
  }
  refresh()
  return { el: root, refresh }
}
