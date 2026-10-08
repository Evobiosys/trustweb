/**
 * The link under the Meet page's QR (wave 6b): ONE link. Once the server answered it is the connect code
 * (https://<host>/c/<code>, connect_code.ts); until then, and in an embedded demo phone, it is the long connect link.
 * The QR, Copy, and NFC all carry whatever is on show (current()). "Show the long link" stays one tap away and
 * always works without our server.
 *
 * DOM and words only: what to register and when is connect_code.ts, what the QR carries per mode is connect_modes.ts.
 */
import { el } from '../../demo/src/ui/dom'
import { canRegister } from './connect_code'
import type { ConnectKeeper } from './connect_code'
import { S } from './strings'

export interface ConnectViewOptions {
  /** location.origin: decides whether a code is asked for at all (connect_code.ts canRegister). */
  origin: string
  /** False where the code must not be asked for (an embedded demo phone, a demo account's tab), whatever the origin. */
  offer: boolean
  keeper: ConnectKeeper
  /** The QR holder: its data-payload follows the link on show and its canvas is redrawn. */
  qr: HTMLElement
  renderQr: (target: HTMLElement, payload: string) => Promise<void>
  /** Copies a text and says so (the app's toast). */
  copy: (text: string) => void
}

export interface ConnectView {
  el: HTMLElement
  /** The long link is ready (or changed). `frag` is the fragment a meeting adds (notes, key), '' for none. Asks the server for the code once. */
  setLink(long: string, frag: string): void
  /** What the link on show is right now: the code link while the server's copy is current, else the long one. '' before setLink. */
  current(): string
  /** The long link, with its fragment: what works without our server. '' before setLink. */
  longLink(): string
  /** True when the code link (not the long one) is on show. */
  isShort(): boolean
}

export function createConnectView(o: ConnectViewOptions): ConnectView {
  let long = ''
  let frag = ''
  let shown = ''
  let short = false
  let attached = false

  const codeLine = el('p', { class: 'short-link', 'data-link': 'code', hidden: true })
  const status = el('p', { class: 'meta', role: 'status', 'data-code-status': '' })
  const note = el('p', { class: 'meta', 'data-code-note': '', hidden: true }, [S.connectCodeNote])
  const longBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-act': 'long', 'aria-expanded': 'false', hidden: true }, [S.shortLinkShowLong])
  const longText = el('code', { class: 'long-link', 'data-link': 'long' })
  const longCopy = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-act': 'copy-long', onclick: () => { if (long) o.copy(long + (frag ? '#' + frag : '')) } }, [S.shortLinkCopyLong])
  const longBox = el('div', { class: 'long-box', hidden: true }, [longText, longCopy])
  const root = el('div', { class: 'link-choice', 'data-connect-view': '' }, [codeLine, status, note, longBtn, longBox])

  const withFrag = (link: string): string => (frag ? `${link}#${frag}` : link)

  const showQr = (payload: string): void => {
    // renderQr swaps the canvas in at once, so the latest call is always the one on screen.
    o.qr.setAttribute('data-payload', payload)
    void o.renderQr(o.qr, payload)
  }

  const refresh = (): void => {
    if (!long) return
    const code = o.offer ? o.keeper.shortFor(long) : null
    const next = withFrag(code ?? long)
    short = code !== null
    codeLine.hidden = !short
    codeLine.textContent = short ? next : ''
    note.hidden = !short
    status.textContent = !short && o.offer && canRegister(o.origin) ? S.connectCodePending : ''
    longText.textContent = withFrag(long)
    if (next !== shown) { shown = next; showQr(next) }
  }

  longBtn.addEventListener('click', () => {
    const open = longBox.hidden
    longBox.hidden = !open
    longBtn.setAttribute('aria-expanded', String(open))
    longBtn.textContent = open ? S.shortLinkHideLong : S.shortLinkShowLong
  })

  const off = o.offer ? o.keeper.onChange(() => {
    if (root.isConnected) attached = true
    else if (attached) { off(); return }
    refresh()
  }) : (): void => {}

  return {
    el: root,
    current: () => shown,
    isShort: () => short,
    longLink: () => (long ? withFrag(long) : ''),
    setLink(nextLong: string, nextFrag: string): void {
      long = nextLong
      frag = nextFrag
      longBtn.hidden = false
      refresh()
      if (o.offer && canRegister(o.origin)) void o.keeper.ensure(long)
    },
  }
}
