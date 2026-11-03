// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27: the QR page (a page with Back, never an overlay): the big code, and under it the options as toggles that redraw the code. DOM only; the rules are qr_modes.ts. */
import { el } from '../../demo/src/ui/dom'
import { mode } from './qr_modes'
import type { QrContext, QrOption } from './qr_modes'
import { S } from './strings'

/** QR code payloads past this many characters do not scan reliably on a phone. */
const MAX_PAYLOAD = 1400

export interface QrPageDeps {
  open: (title: string, body: Node[], mark: string) => void
  renderQr: (target: HTMLElement, payload: string) => Promise<void>
  /** Wave 28: whether the person option "profile" is offered (Settings > Advanced); absent = the QR_PROFILE_OPTION default. */
  profileOption?: boolean
}

/** The sentence under the code for the contexts that have their own (an event, a tag, an item); undefined = the connect sentence. */
const ownHint = (ctx: QrContext): string | undefined => (ctx.kind === 'event' ? S.qrEventHint : ctx.kind === 'community' ? S.qrTagHint(ctx.tag) : ctx.kind === 'item' ? S.qrItemHint : undefined)

/** The name the sentence under the code speaks of (a person's), '' for the other contexts. */
const nameOf = (ctx: QrContext): string => (ctx.kind === 'person' ? ctx.name : '')

/** `note`: a line kept under the code ("Share QR only" says it works only with a TrustWeb install). */
export function openQrPage(d: QrPageDeps, ctx: QrContext, note?: string): void {
  const on: QrOption['id'][] = []
  const qr = el('div', { class: 'qrwrap', 'data-qr-modes': ctx.kind })
  const words = el('p', { class: 'meta', 'data-qr-words': '' })
  const toggles = el('div', { class: 'qr-options' })
  const draw = (): void => {
    const m = mode(ctx, on, d.profileOption)
    const name = nameOf(ctx)
    const tooLong = m.payload.length > MAX_PAYLOAD
    qr.setAttribute('data-payload', m.payload)
    qr.hidden = tooLong
    if (!tooLong) void d.renderQr(qr, m.payload)
    words.textContent = tooLong ? S.qrTooLong : ownHint(ctx) ?? S.qrConnects + (m.chosen.length ? S.qrAnd + m.chosen.map((id) => S.qrWhat[id](name)).join(', ') : '')
    toggles.replaceChildren(...m.options.map((o) => el('label', { class: 'check' }, [
      el('input', { type: 'checkbox', checked: o.on, 'data-qr-option': o.id, onchange: (e: Event) => {
        const i = on.indexOf(o.id)
        if ((e.target as HTMLInputElement).checked && i < 0) on.push(o.id)
        else if (i >= 0) on.splice(i, 1)
        draw()
      } }),
      ' ' + (o.id === 'username' ? S.qrOptionUsername(name) : S.qrOptionProfile(name)),
    ])))
  }
  draw()
  d.open(S.qrPageTitle, [el('div', { class: 'scroll pad' }, [qr, words, note ? el('p', { class: 'meta', 'data-qr-note': '' }, [note]) : null, toggles])], 'qr-modes')
}
