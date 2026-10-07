/**
 * The short-link choice under a connect code (wave 5): "Short link" (an explicit tap, never on opening the sheet) and
 * "Show the long link". One widget for every place that shows a connect link (Meet's own code, a demo account's code).
 * The logic is short_link.ts; this file is the DOM, the words (strings.ts) and the QR that follows the choice.
 *
 * The long link is the default view and the fallback for any failure. The QR, and what Copy / Send / NFC use (current()),
 * carry the short link only while it is chosen and made; switching back restores the long one. The choice is remembered per
 * long link for this visit, so a redraw of the screen (a swipe between the Meet pages) shows the same view without asking the
 * server again.
 */
import { el } from '../../demo/src/ui/dom'
import { canShorten, shareBlock, ShortLinkError } from './short_link'
import type { ShortLinker } from './short_link'
import { S } from './strings'

export interface LinkChooserOptions {
  /** location.origin: decides whether short links are offered at all (short_link.ts canShorten). */
  origin: string
  /** False where the option must not appear (an embedded demo phone), whatever the origin. */
  offer: boolean
  linker: ShortLinker
  /** The QR holder: its data-payload follows the link on show and its canvas is redrawn. */
  qr: HTMLElement
  renderQr: (target: HTMLElement, payload: string) => Promise<void>
  /** Copies a text and says so (the app's toast). */
  copy: (text: string) => void
}

export interface LinkChooser {
  el: HTMLElement
  /** The long link is ready (or changed): shows it, and the short one again where it was chosen and is still held. */
  setLink(long: string): void
  /** What the link on show is right now: the short link while chosen and made, else the long one. '' before setLink. */
  current(): string
  /** The long link always, whatever is chosen: for what must not expire (an NFC tag is written once and kept). '' before setLink. */
  longLink(): string
}

/** Long links whose short form the person chose this visit (survives a redraw of the screen, not a reload). */
const chosenShort = new Set<string>()

export function createLinkChooser(o: LinkChooserOptions): LinkChooser {
  let long = ''
  let shown = ''
  let busy = false

  const shortBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-act': 'short', 'aria-pressed': 'false', hidden: true }, [S.shortLinkButton])
  const note = el('p', { class: 'meta', 'data-short-note': '', hidden: true }, [S.shortLinkNote])
  const status = el('p', { class: 'meta', role: 'status', 'data-short-status': '' })
  const shortLine = el('p', { class: 'short-link', 'data-link': 'short', hidden: true })
  const longBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-act': 'long', 'aria-expanded': 'false', hidden: true }, [S.shortLinkShowLong])
  const longText = el('code', { class: 'long-link', 'data-link': 'long' })
  const longCopy = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-act': 'copy-long', onclick: () => { if (long) o.copy(long) } }, [S.shortLinkCopyLong])
  const longBox = el('div', { class: 'long-box', hidden: true }, [longText, longCopy])
  const root = el('div', { class: 'link-choice' }, [shortBtn, shortLine, note, status, longBtn, longBox])

  const showQr = (payload: string): void => {
    // renderQr swaps the canvas in at once, so the latest call is always the one on screen.
    o.qr.setAttribute('data-payload', payload)
    void o.renderQr(o.qr, payload)
  }

  const show = (link: string, isShort: boolean): void => {
    const changed = link !== shown
    shown = link
    shortBtn.setAttribute('aria-pressed', String(isShort))
    shortLine.hidden = !isShort
    shortLine.textContent = isShort ? link : ''
    if (changed) showQr(link)
  }

  const say = (text: string): void => { status.textContent = text }

  const choose = async (): Promise<void> => {
    if (busy || !long) return
    busy = true
    shortBtn.setAttribute('aria-busy', 'true')
    shortBtn.disabled = true
    say(S.shortLinkBusy)
    const asked = long
    const out = await o.linker.shorten(asked)
    busy = false
    shortBtn.removeAttribute('aria-busy')
    shortBtn.disabled = false
    if (asked !== long) return // the code changed while the server answered: that answer is for another link
    if (out.ok) {
      chosenShort.add(asked)
      show(out.short, true)
      say(S.shortLinkMade)
    } else {
      chosenShort.delete(asked)
      show(asked, false)
      say(S.shortLinkFailed(out.error, out.retryAfterSeconds))
    }
  }

  const back = (): void => {
    chosenShort.delete(long)
    show(long, false)
    say('')
  }

  shortBtn.addEventListener('click', () => {
    if (shortBtn.getAttribute('aria-pressed') === 'true') back()
    else void choose()
  })
  longBtn.addEventListener('click', () => {
    const open = longBox.hidden
    longBox.hidden = !open
    longBtn.setAttribute('aria-expanded', String(open))
    longBtn.textContent = open ? S.shortLinkHideLong : S.shortLinkShowLong
  })

  return {
    el: root,
    current: () => shown,
    longLink: () => long,
    setLink(next: string): void {
      long = next
      longText.textContent = next
      longBtn.hidden = false
      const block = o.offer && canShorten(o.origin) ? shareBlock(next, o.origin) : ShortLinkError.NotHere
      const offered = block === null
      shortBtn.hidden = !offered
      note.hidden = !offered
      status.textContent = block === ShortLinkError.Private || block === ShortLinkError.TooLong ? S.shortLinkFailed(block) : ''
      const held = offered && chosenShort.has(next) ? o.linker.cached(next) : null
      if (held) show(held.short, true)
      else show(next, false)
    },
  }
}
