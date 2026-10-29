/** The "Agreements" section of a person's card (wave 7). DOM and words only: the rules are agreements.ts, sending is the caller's. */
import { el } from '../../demo/src/ui/dom'
import { AGREEMENT_MAX, AgreementStatus, MAX_TIME, isExpired } from './agreements'
import type { Agreement } from './agreements'
import { S } from './strings'

export interface AgreementsDeps {
  name: string
  agreements: () => readonly Agreement[]
  now: () => number
  /** Connected on TrustWeb: a mutual agreement can be proposed. */
  canPropose: boolean
  /** Consensual's own proposal flow, when this person's Consensual address is known. */
  consensualLink?: string
  add: (text: string, expiresAt: number | undefined, propose: boolean) => void
  remove: (id: string) => void
  accept: (id: string) => void
  resend: (id: string) => void
}

/** Open state of the folded section, per device. */
const OPEN_KEY = 'trustweb.ui.agreementsOpen'

const day = (at: number): string => (Number.isFinite(at) && Math.abs(at) <= MAX_TIME ? new Date(at).toISOString().slice(0, 10) : '')

function lineRow(d: AgreementsDeps, a: Agreement): HTMLElement {
  const expired = isExpired(a, d.now())
  const btn = (label: string, attr: string, f: () => void): HTMLElement => el('button', { class: 'mini', type: 'button', [attr]: a.id, onclick: f }, [label])
  return el('div', { class: 'cb-row agr-row' + (expired ? ' off' : ''), 'data-agreement': a.id, 'data-status': a.status }, [
    el('b', {}, [a.text]),
    el('small', { class: 'meta' }, [`${S.agrStatus(a.status, d.name)} · ${day(a.at)}${` · ${a.expiresAt === undefined ? S.agrOpenEnded : expired ? S.agrExpired : S.agrUntil(day(a.expiresAt))}`}`]),
    a.status === AgreementStatus.Incoming ? btn(S.agrAccept, 'data-agr-accept', () => d.accept(a.id)) : null,
    a.status === AgreementStatus.Proposed ? btn(S.agrResend, 'data-agr-resend', () => d.resend(a.id)) : null,
    btn('×', 'data-agr-remove', () => d.remove(a.id)),
  ])
}

export function agreementsSection(d: AgreementsDeps): HTMLElement {
  const text = el('input', { class: 'field', placeholder: S.agrPh, maxlength: String(AGREEMENT_MAX), 'aria-label': S.agrPh, 'data-agr-text': '1' })
  const until = el('input', { class: 'field', type: 'date', 'aria-label': S.agrExpiry, 'data-agr-expiry': '1' })
  const mutual = el('input', { type: 'checkbox', 'data-agr-mutual': '1' })
  const add = (): void => {
    if (!text.value.trim()) { text.focus(); return }
    const end = until.value ? Date.parse(until.value + 'T23:59:59Z') : NaN
    d.add(text.value, Number.isFinite(end) ? end : undefined, d.canPropose && mutual.checked)
  }
  text.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') add() })
  const list = d.agreements()
  const body = el('div', { class: 'agreements', 'data-agreements': '1' }, [
    el('p', { class: 'meta', 'data-agreements-beta': '1' }, [S.agreementsBetaNote]),
    list.length ? el('div', {}, list.map((a) => lineRow(d, a))) : el('p', { class: 'meta' }, [S.agrNone(d.name)]),
    el('div', { class: 'cb-row editing' }, [
      text, el('label', { class: 'meta' }, [S.agrExpiry + ' ', until]),
      d.canPropose ? el('label', { class: 'chat-row' }, [mutual, el('span', {}, [S.agrMutual(d.name)])]) : el('p', { class: 'meta' }, [S.agrMineOnly]),
      el('button', { class: 'btn btn-electric btn-sm', type: 'button', 'data-agr-add': '1', onclick: add }, [S.agrAdd]),
    ]),
    d.consensualLink ? el('a', { class: 'btn btn-ghost btn-sm', href: d.consensualLink, target: '_blank', rel: 'noopener noreferrer', 'data-agr-consensual': '1' }, [S.consPropose]) : null,
    el('p', { class: 'meta' }, [S.agrHint]),
  ])
  const summary = el('summary', { class: 'adv-toggle' })
  const wrap = el('details', { 'data-agreements-section': '1' }, [summary, body]) as HTMLDetailsElement
  const paint = (): void => { summary.textContent = `${S.agrTitle} ${wrap.open ? '▴' : '▾'}` }
  try { wrap.open = localStorage.getItem(OPEN_KEY) === '1' } catch { /* closed */ }
  paint()
  wrap.addEventListener('toggle', () => { paint(); try { localStorage.setItem(OPEN_KEY, wrap.open ? '1' : '0') } catch { /* ignore */ } })
  return wrap
}
