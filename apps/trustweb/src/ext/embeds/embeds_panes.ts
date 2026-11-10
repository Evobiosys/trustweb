// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 small-ui-c: the two panes of the embeds module, drawn into any shadow root that carries embeds.css (or the same class names):
 * the Google Docs frame and the Telegram pane. Nothing loads before the consent tap; "Open Telegram" and "Open in a new tab" always work.
 * Moved here from community-mighty (wave 39), which now calls these.
 */
import { el } from '../../../../demo/src/ui/dom'
import { S } from '../../strings'
import type { TwCtx } from '../tw_registry'
import { readConsent, readEmbeds, writeConsent, writeEmbeds } from './embeds_data'
import { docsEmbedUrl, entryFor, telegramUrl, withEntry } from './embeds_model'

export interface PaneEnv {
  ctx: TwCtx
  /** The community tag the links belong to (NO_TAG when none). */
  tag: string
  /** The caller redraws after a change (the pane never redraws itself). */
  redraw: () => void
  /** A note under the pane: the link was refused. */
  note: (text: string) => void
}

const btn = (label: string, onclick: () => void, attrs: Record<string, string> = {}, cls = 'lnk'): HTMLButtonElement => el('button', { class: cls, type: 'button', ...attrs, onclick }, [label])
const newTab = (href: string, label: string, attrs: Record<string, string> = {}): HTMLElement => el('a', { href, target: '_blank', rel: 'noopener noreferrer', ...attrs }, [label])

/** The Google Docs slot: paste a published or /edit link; nothing loads before the consent tap. */
export function docsPane(env: PaneEnv): HTMLElement {
  const t = S.embeds
  const entry = entryFor(readEmbeds(env.ctx.store()), env.tag)
  const src = entry.docsUrl ?? null
  const change = (): HTMLElement => btn(t.change, () => { writeEmbeds(env.ctx, withEntry(readEmbeds(env.ctx.store()), env.tag, { docsUrl: null })); env.redraw() }, { 'data-embeds-docs-change': '' })
  const kids: (Node | string)[] = [el('h4', { class: 'eyebrow' }, [t.docsTitle])]
  if (!src) {
    const input = el('input', { type: 'url', placeholder: t.docsPh, 'aria-label': t.docsPh, 'data-embeds-docs-url': '' }) as HTMLInputElement
    kids.push(input, btn(t.save, () => {
      if (!docsEmbedUrl(input.value)) { env.note(t.docsBad); return }
      env.note('')
      writeEmbeds(env.ctx, withEntry(readEmbeds(env.ctx.store()), env.tag, { docsUrl: input.value }))
      env.redraw()
    }, { 'data-embeds-docs-save': '' }, 'lnk strong'))
  } else if (!readConsent().docs) {
    kids.push(el('p', { class: 'meta' }, [t.docsConsent]), el('div', { class: 'row wrap' }, [
      btn(t.docsLoad, () => { writeConsent({ ...readConsent(), docs: true }); env.redraw() }, { 'data-embeds-docs-load': '' }, 'lnk strong'),
      newTab(src, t.openNewTab), change(),
    ]))
  } else {
    kids.push(el('iframe', { class: 'embed', src, title: t.docsTitle, loading: 'lazy', referrerpolicy: 'no-referrer', sandbox: 'allow-scripts allow-same-origin allow-popups', 'data-embeds-docs-frame': '' }),
      el('div', { class: 'row wrap' }, [newTab(src, t.openNewTab), change()]))
  }
  return el('div', { class: 'card docs', 'data-embeds-docs': '' }, kids)
}

/** What the Telegram pane shows; a caller rebuilds the pane only when this changes, so a loaded frame is not reloaded by other taps. */
export function chatKey(env: Pick<PaneEnv, 'ctx' | 'tag'>): string {
  return JSON.stringify([entryFor(readEmbeds(env.ctx.store()), env.tag).telegramUrl ?? '', readConsent().telegram === true])
}

/** The Telegram pane: paste a t.me link, consent tap, then the frame; "Open Telegram" is always there. `head` (a close button, a title) goes first. */
export function chatPane(env: PaneEnv, head: Node[] = []): HTMLElement {
  const t = S.embeds
  const link = entryFor(readEmbeds(env.ctx.store()), env.tag).telegramUrl ?? null
  const kids: (Node | string)[] = [...head]
  if (!link) {
    const input = el('input', { type: 'url', placeholder: t.chatPh, 'aria-label': t.chatPh, 'data-embeds-chat-url': '' }) as HTMLInputElement
    kids.push(input, btn(t.save, () => {
      if (!telegramUrl(input.value)) { env.note(t.chatBad); return }
      env.note('')
      writeEmbeds(env.ctx, withEntry(readEmbeds(env.ctx.store()), env.tag, { telegramUrl: input.value }))
      env.redraw()
    }, { 'data-embeds-chat-save': '' }, 'lnk strong'))
  } else {
    if (!readConsent().telegram) kids.push(el('p', { class: 'meta' }, [t.chatConsent]), btn(t.chatLoad, () => { writeConsent({ ...readConsent(), telegram: true }); env.redraw() }, { 'data-embeds-chat-load': '' }, 'lnk strong'))
    else kids.push(el('iframe', { class: 'embed chat-frame', src: link, title: t.chatTitle, referrerpolicy: 'no-referrer', sandbox: 'allow-scripts allow-same-origin allow-popups allow-forms', 'data-embeds-chat-frame': '' }), el('p', { class: 'meta' }, [t.chatBlocked]))
    kids.push(el('div', { class: 'row wrap' }, [
      newTab(link, t.chatOpen, { 'data-embeds-chat-open': '' }),
      btn(t.change, () => { writeEmbeds(env.ctx, withEntry(readEmbeds(env.ctx.store()), env.tag, { telegramUrl: null })); env.redraw() }, { 'data-embeds-chat-change': '' }),
    ]))
  }
  return el('div', { class: 'chat-body', 'data-embeds-chat': '' }, kids)
}
