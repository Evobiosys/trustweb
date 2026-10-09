/**
 * Wave 6i: the stack of quiet cards on the Web screen, ABOVE the rings and in the flow of the page (review 6h R10: the floating card
 * covered the top of the web and took the taps meant for the people there; now nothing is ever covered, the rings move down instead).
 * Jakob 2026-10-09: "when it says 'new message from x' it should be possible to click that, including by pressing a link on the right
 * that says 'open' underlined." Every card opens with one tap (the whole card, or its underlined "open" on the right):
 *   1. Message   "New message from <name>"               -> that chat, scrolled to the message
 *   2. Late      "<name> answered later" / "... your earlier ask", one card per answer -> the chat with that person, carrying the ask
 *   3. Unmatched "<name> asked about something" (the newest; "n more")  -> the chat with the asker, carrying the ask
 *   4. Away      "<name> asked while you were away" (the newest)        -> the same
 * The quiet "nothing matched" card alone hides itself after QUIET_CARD_MS (it stays kept: the next open shows it again); the others stay
 * until they are dismissed, read or opened. Pure and DOM-free: card_stack_view.ts draws it.
 */
import { liveAwayAsks } from './away_asks'
import { ChatDirection } from './chat'
import type { ChatBook } from './chat'
import { shownLateAnswers } from './late_answers'
import type { AppState, AwayAsk, LateAnswer, UnmatchedAsk } from './model'
import { liveUnmatchedAsks, showsUnmatched } from './unmatched_asks'

/** The quiet "nothing matched" card hides itself after this long. */
export const QUIET_CARD_MS = 20_000
/** At most this many "new message" cards (the people who wrote last). */
export const STACK_MESSAGES_MAX = 3

export enum StackCardKind {
  Message = 'message',
  Late = 'late',
  Unmatched = 'unmatched',
  Away = 'away',
}

export type StackCard =
  | { kind: StackCardKind.Message; key: string; peerId: string; unread: number; messageKey: string }
  | { kind: StackCardKind.Late; key: string; answer: LateAnswer }
  | { kind: StackCardKind.Unmatched; key: string; ask: UnmatchedAsk; more: number }
  | { kind: StackCardKind.Away; key: string; ask: AwayAsk; more: number }

export type StackState = Pick<AppState, 'chats' | 'lateAnswers' | 'unmatchedAsks' | 'awayAsks' | 'showUnmatchedAsks'>

/** Threads with unread messages, the one written to last first: one card each, pointing at its newest message from them. */
export function messageCards(book: ChatBook | undefined, hasCard: (peerId: string) => boolean): StackCard[] {
  if (!book) return []
  const out: Array<{ card: StackCard; at: number }> = []
  for (const [peerId, thread] of Object.entries(book)) {
    if (thread.unread <= 0 || !hasCard(peerId)) continue
    const last = [...thread.messages].reverse().find((m) => m.dir === ChatDirection.In)
    if (!last) continue
    out.push({ at: last.at, card: { kind: StackCardKind.Message, key: `message:${peerId}:${last.key}`, peerId, unread: thread.unread, messageKey: last.key } })
  }
  return out.sort((a, b) => b.at - a.at).slice(0, STACK_MESSAGES_MAX).map((x) => x.card)
}

/**
 * The cards to show now, in order. `hidden`: keys of quiet cards that already hid themselves in this visit. `hasCard`: whether a
 * connection (peer id) has a card in this web (a message from somebody without one has nothing to open).
 */
export function stackCards(s: StackState, now: number, demoPhone: boolean, hidden: ReadonlySet<string>, hasCard: (peerId: string) => boolean): StackCard[] {
  const cards: StackCard[] = [...messageCards(s.chats, hasCard)]
  for (const answer of shownLateAnswers(s.lateAnswers, now)) cards.push({ kind: StackCardKind.Late, key: `late:${answer.id}`, answer })
  const unmatched = showsUnmatched(s, demoPhone) ? liveUnmatchedAsks(s.unmatchedAsks, now) : []
  if (unmatched.length) {
    const key = `unmatched:${unmatched[0].id}`
    if (!hidden.has(key)) cards.push({ kind: StackCardKind.Unmatched, key, ask: unmatched[0], more: unmatched.length - 1 })
  }
  const away = liveAwayAsks(s.awayAsks, now)
  if (away.length) cards.push({ kind: StackCardKind.Away, key: `away:${away[0].id}`, ask: away[0], more: away.length - 1 })
  return cards
}

/** Does this card hide itself after QUIET_CARD_MS? Only the quiet "nothing matched" card. */
export function hidesItself(card: StackCard): boolean {
  return card.kind === StackCardKind.Unmatched
}

/** The ask a card is about, for a reply that carries it (chat_re.ts makeRe): its qid between the two phones, words and time. */
export function cardAsk(card: StackCard): { peerId: string; qid: string; text: string; at: number } | null {
  switch (card.kind) {
    case StackCardKind.Late: return { peerId: card.answer.peerId, qid: card.answer.id, text: card.answer.ask, at: card.answer.askedAt ?? card.answer.at }
    case StackCardKind.Unmatched:
    case StackCardKind.Away: return { peerId: card.ask.peerId, qid: card.ask.id, text: card.ask.text, at: card.ask.at }
    case StackCardKind.Message: return null
  }
}

/**
 * Review 6i: where the tappable "new message" notice may sit away from the Web stack, so it never lies over a control. Over the consent
 * prompt (its Share and Not now) it does not show at all (the unread card waits in the stack, the toast says it); over an open sheet it
 * sits in the top strip, over the veil the sheet never reaches (max-height 82%), where a tap would only have closed the sheet; else
 * above the tab bar, where the toast is.
 */
export enum NoticePlace {
  None = 'none',
  Top = 'top',
  Bottom = 'bottom',
}

export function msgNoticePlace(promptOpen: boolean, sheetOpen: boolean): NoticePlace {
  if (promptOpen) return NoticePlace.None
  return sheetOpen ? NoticePlace.Top : NoticePlace.Bottom
}
