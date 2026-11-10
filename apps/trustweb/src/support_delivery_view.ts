// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 (support_delivery.ts): the sheet after "Send". The app entry has gone; the messenger and e-mail parts wait here, one tap each. */
import { el } from '../../demo/src/ui/dom'
import { alphaHeading } from './alpha_heading'
import { openLocalFirst } from './messenger_links'
import type { LocalOpenEnv } from './messenger_links'
import { S } from './strings'
import type { SupportAsk } from './support_ask'
import { deliverySummary, deliveryText, emailBatches, markSent, messengerOpen } from './support_delivery'
import type { DeliveryGroup, DeliveryPlan, DeliveryVia } from './support_delivery'

export interface DeliveryIo {
  save: () => void
  render: () => void
  toast: (text: string) => void
  appUrl: string
  /** How links open on this device: the app link first (assign), the web link in a new tab. */
  env: LocalOpenEnv
}

export function deliveryPanel(io: DeliveryIo, ask: SupportAsk, plan: DeliveryPlan, done: () => void): HTMLElement {
  const body = el('div', { class: 'support-delivery', 'data-delivery': '' })
  const when = new Date(ask.until).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  const left = (g: DeliveryGroup) => g.items.filter((d) => !ask.via?.[d.peerId])
  const sent = (via: DeliveryVia, peerId: string): void => { if (markSent(ask, peerId, via, Date.now())) { io.save(); io.render() } }

  const messengerBlock = (g: DeliveryGroup): HTMLElement => {
    const label = S.supportViaLabel[g.via]
    const next = left(g)[0]
    const children: (HTMLElement | null)[] = [el('p', { class: 'chips-lbl' }, [S.supportViaMsg(g.items.length, label)])]
    if (!next) return el('div', { 'data-delivery-group': g.via, 'data-delivery-done': '' }, [...children, el('p', { class: 'hint' }, [S.supportDeliverGroupDone(label)])])
    children.push(
      el('p', { class: 'hint' }, [S.supportDeliverProgress(g.items.length - left(g).length + 1, g.items.length)]),
      el('button', { class: 'btn btn-electric wide', type: 'button', 'data-delivery-next': g.via, onclick: () => {
        const text = deliveryText(next.name, ask, when, io.appUrl)
        const o = messengerOpen(next.person, g.via as Exclude<DeliveryVia, 'email'>, text)
        if (!o) return
        // Review wave 40: "copied" only when it was; else the person is told to write the words there.
        if (o.copy) {
          const copying = navigator.clipboard?.writeText(text)
          if (copying) copying.then(() => io.toast(S.supportDeliverCopied), () => io.toast(S.supportDeliverCopyFailed)); else io.toast(S.supportDeliverCopyFailed)
        }
        if (g.via === 'signal' && o.fallback) openLocalFirst(o.href, o.fallback, io.env)
        else io.env.openTab(o.href)
        sent(g.via, next.peerId)
        draw()
      } }, [S.supportDeliverNext(next.name, label)]),
    )
    return el('div', { 'data-delivery-group': g.via }, children)
  }

  const mailBlock = (g: DeliveryGroup): HTMLElement => {
    const todo = left(g)
    // Review wave 40: a long BCC list is split so no mail program cuts it; one mail per tap, like the messengers (never several windows at once).
    // An address two people share (a family address) goes into the mail once; both count as sent.
    const owners = new Map<string, typeof todo>()
    for (const d of todo) { const k = (d.email as string).toLowerCase(); owners.set(k, [...(owners.get(k) ?? []), d]) }
    const unique = [...owners.values()].map((ds) => ds[0]!.email as string)
    const batches = emailBatches(unique, S.supportMailSubject, deliveryText('', ask, when, io.appUrl))
    const first = batches[0]?.href
    const firstItems = unique.slice(0, batches[0]?.count ?? 0).flatMap((a) => owners.get(a.toLowerCase()) ?? [])
    const rest = todo.length - firstItems.length
    return el('div', { 'data-delivery-group': 'email', ...(todo.length ? {} : { 'data-delivery-done': '' }) }, [
      el('p', { class: 'chips-lbl' }, [S.supportViaMail(g.items.length)]),
      first
        ? el('button', { class: 'btn btn-electric wide', type: 'button', 'data-delivery-mail': String(firstItems.length), onclick: () => {
          io.env.assign(first)
          for (const d of firstItems) sent('email', d.peerId)
          draw()
        } }, [S.supportDeliverMail(firstItems.length) + (rest ? S.supportDeliverMailRest(rest) : '')])
        : el('p', { class: 'hint' }, [S.supportDeliverGroupDone(S.supportViaLabel.email)]),
      todo.length ? el('p', { class: 'hint' }, [S.supportDeliverMailHint]) : null,
    ])
  }

  const draw = (): void => {
    body.replaceChildren(...[
      el('h3', {}, alphaHeading(S.supportDeliverTitle)),
      el('p', { class: 'hint', 'data-delivery-summary': '' }, [deliverySummary(plan)]),
      el('p', { class: 'hint' }, [S.supportDeliverHint]),
      ...plan.groups.map((g) => (g.via === 'email' ? mailBlock(g) : messengerBlock(g))),
      el('button', { class: 'btn btn-ghost wide', type: 'button', 'data-delivery-close': '', onclick: done }, [S.supportDeliverDone]),
    ])
  }
  draw()
  return body
}
