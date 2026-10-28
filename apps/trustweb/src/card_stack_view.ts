/**
 * Wave 6i: draws the card stack of card_stack.ts into one element that sits in the Web screen's flow, above the rings. DOM and words
 * only; what each tap does is handed in (main.ts). Every card is tappable as a whole and has an underlined "open" on its right; its own
 * buttons (Message, Dismiss, ...) do only what they say.
 */
import { el } from '../../demo/src/ui/dom'
import { makeRe } from './chat_re'
import type { ChatRe } from './chat_re'
import { askWhenLabel } from './chat_view'
import { StackCardKind, cardAsk } from './card_stack'
import type { StackCard } from './card_stack'
import type { Ring } from './model'
import { S } from './strings'

export interface StackOpen {
  /** Wave 6i: the ask the chat opens with (chat_re.ts): the next message sent carries it. */
  re?: ChatRe | null
  /** The message to scroll to. */
  scrollTo?: string
}

export interface StackViewDeps {
  /** The card (person id) of a connection in this web; null: none. */
  personIdOf(peerId: string): string | null
  /** A connection's name as this web shows it. */
  nameOf(peerId: string): string
  openChat(personId: string, open: StackOpen): void
  /** Every dismiss saves and draws the stack again. */
  dismiss(card: StackCard): void
  /** "Resources" on the nothing-matched card. */
  addLine(): void
  ringLabel(ring: Ring | undefined): string
  now(): number
}

type Action = HTMLElement | null

function button(label: string, cls: string, data: string, onclick: () => void): HTMLElement {
  return el('button', { class: cls, type: 'button', [data]: '1', onclick }, [label])
}

/** One card: a title row with "open" on the right (when there is something to open), the body, its own buttons. */
function shell(card: StackCard, title: string, body: string | null, actions: Action[], open: (() => void) | null): HTMLElement {
  const head = el('div', { class: 'stack-head' }, [
    el('b', {}, [title]),
    open ? el('button', { class: 'stack-open', type: 'button', 'data-card-open': card.kind, 'aria-label': S.cardOpenAria(title), onclick: open }, [S.cardOpen]) : null,
  ])
  const kept = actions.filter((a): a is HTMLElement => a !== null)
  const node = el('div', { class: 'stack-card stack-' + card.kind + (open ? ' tappable' : ''), 'data-stack-card': card.kind, 'data-stack-key': card.key, role: 'group' }, [
    head,
    body ? el('span', { class: 'stack-body' }, [body]) : null,
    kept.length ? el('div', { class: 'stack-actions' }, kept) : null,
  ])
  // The whole card opens; its own buttons do only their own thing.
  if (open) node.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('button, a')) open() })
  return node
}

/** Opens the chat with the person a card is about, carrying the card's ask; null when that person has no card here. */
function openWithAsk(deps: StackViewDeps, card: StackCard): (() => void) | null {
  const ask = cardAsk(card)
  const personId = ask ? deps.personIdOf(ask.peerId) : null
  if (!ask || !personId) return null
  return () => deps.openChat(personId, { re: makeRe(ask.qid, ask.text, ask.at) })
}

/** "Message <name>": the card goes, the chat opens with its ask. */
function messageButton(deps: StackViewDeps, card: StackCard, label: string): Action {
  const open = openWithAsk(deps, card)
  return open ? button(label, 'btn btn-electric btn-sm', 'data-card-message', () => { deps.dismiss(card); open() }) : null
}

function cardNode(deps: StackViewDeps, card: StackCard): HTMLElement | null {
  const dismiss = (label: string, data: string): HTMLElement => button(label, 'btn btn-ghost btn-sm', data, () => deps.dismiss(card))
  switch (card.kind) {
    case StackCardKind.Message: {
      const personId = deps.personIdOf(card.peerId)
      if (!personId) return null
      const open = (): void => deps.openChat(personId, { scrollTo: card.messageKey })
      return shell(card, S.chatNewToast(deps.nameOf(card.peerId)), null, [button(S.msgCardDismiss, 'notice-dismiss', 'data-msg-read', () => deps.dismiss(card))], open)
    }
    case StackCardKind.Late: {
      const a = card.answer
      const when = a.askedAt !== undefined ? askWhenLabel(a.askedAt, deps.now()) : null
      const title = a.earlier === true ? S.lateEarlierTitle(a.from) : S.lateTitle([a.from])
      return shell(card, title, S.lateCardBody(a.ask, when, a.items.map((it) => it.text)),
        [messageButton(deps, card, S.lateMessage(a.from)), dismiss(S.lateDismiss, 'data-late-dismiss')], openWithAsk(deps, card))
    }
    case StackCardKind.Unmatched: {
      const a = card.ask
      return shell(card, S.unmatchedTitle(a.from), S.unmatchedBody(a.from, a.text, a.reason, deps.ringLabel(a.ring), card.more), [
        button(S.unmatchedAddLine, 'btn btn-electric btn-sm', 'data-unmatched-add', () => { deps.dismiss(card); deps.addLine() }),
        messageButton(deps, card, S.unmatchedMessage(a.from)),
        dismiss(S.unmatchedDismiss, 'data-unmatched-dismiss'),
      ], openWithAsk(deps, card))
    }
    case StackCardKind.Away: {
      const a = card.ask
      return shell(card, S.awayAskTitle(a.from), S.awayAskBody(a.text, card.more),
        [messageButton(deps, card, S.awayAskMessage(a.from)), dismiss(S.awayAskDismiss, 'data-away-dismiss')], openWithAsk(deps, card))
    }
  }
}

/** Draws `cards` into `target` (replacing what was there); hidden when there is none. */
export function drawStack(target: HTMLElement, cards: readonly StackCard[], deps: StackViewDeps): void {
  const nodes = cards.map((c) => cardNode(deps, c)).filter((n): n is HTMLElement => n !== null)
  target.replaceChildren(...nodes)
  target.hidden = nodes.length === 0
}
