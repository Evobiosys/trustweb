// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 small-ui-c: the "Docs & chat" view, drawn inside its own shadow root (CSS scoped, tokens inherited). Google Docs left, Telegram right,
 * half the view each from 700 px of the view's own width (container query, no window listener); below that the Docs fill the screen and the
 * chat is an expandable bottom sheet. Links are kept per community tag. Every listener sits on an element of the shadow root.
 * The panes are rebuilt only when what they show changes, so a loaded frame is not reloaded by another tap.
 */
import { el } from '../../../../demo/src/ui/dom'
import { loadColourTags } from '../../colour_tags'
import { communityTags } from '../../trustzones'
import type { TwCtx } from '../tw_registry'
import { readConsent, readEmbeds } from './embeds_data'
import { chatKey, chatPane, docsPane, type PaneEnv } from './embeds_panes'
import { NO_TAG, entryFor } from './embeds_model'
import css from './embeds.css?inline'

export function mountEmbeds(hostEl: HTMLElement, ctx: TwCtx): () => void {
  const t = ctx.strings.embeds
  const box = el('div', { class: 'embeds-host', 'data-embeds': '' })
  hostEl.append(box)
  const root = box.attachShadow({ mode: 'open' })
  const tags = (): { id: string; label: string }[] => communityTags(loadColourTags()).map((x) => ({ id: x.id, label: x.label ?? x.id }))
  const ui = { tag: '', open: false, note: '' }
  const tagNow = (): string => {
    const ids = tags().map((x) => x.id)
    if (!ids.includes(ui.tag)) ui.tag = ids.find((id) => id === ctx.store().uiRings?.community) ?? ids[0] ?? NO_TAG
    return ui.tag
  }
  const env = (): PaneEnv => ({ ctx, tag: tagNow(), redraw: draw, note: (text) => { ui.note = text; draw() } })

  const em = el('div', { class: 'em' })
  const bar = el('div', { class: 'bar' })
  const note = el('p', { class: 'note', 'data-embeds-note': '', hidden: true })
  const split = el('div', { class: 'split' })
  let docsEl: HTMLElement | null = null
  let chatEl: HTMLElement | null = null
  let shownDocs = ''
  let shownChat = ''
  em.append(bar, note, split)
  root.append(el('style', {}, [css]), em)

  const docsKey = (): string => JSON.stringify([tagNow(), entryFor(readEmbeds(ctx.store()), tagNow()).docsUrl ?? '', readConsent().docs === true])

  function draw(): void {
    const list = tags()
    bar.replaceChildren(
      el('h3', {}, [t.title, ' ', el('sub', { class: 'alpha', 'data-embeds-alpha': '' }, [ctx.strings.alphaLabel])]),
      ...(list.length > 1 ? [el('label', {}, [t.tag, ' ', el('select', {
        'data-embeds-tag': '', 'aria-label': t.tag,
        onchange: (e: Event) => { ui.tag = (e.target as HTMLSelectElement).value; draw() },
      }, list.map((x) => el('option', { value: x.id, ...(x.id === tagNow() ? { selected: '' } : {}) }, [x.label])))])] : []),
    )
    note.textContent = ui.note
    note.hidden = !ui.note
    const dk = docsKey()
    if (dk !== shownDocs) {
      const next = docsPane(env())
      if (docsEl) docsEl.replaceWith(next); else split.prepend(next)
      docsEl = next
      shownDocs = dk
    }
    const ck = chatKey(env())
    if (ck !== shownChat) {
      const toggle = el('button', { class: 'lnk chat-toggle', type: 'button', 'aria-expanded': String(ui.open), 'data-embeds-chat-toggle': '', onclick: () => { ui.open = !ui.open; draw() } }, [ui.open ? t.chatCollapse : t.chatExpand])
      const next = el('aside', { class: 'chat', 'data-embeds-sheet': '' }, [
        el('div', { class: 'chat-head' }, [el('h4', { class: 'eyebrow' }, [t.chatTitle]), toggle]),
        chatPane(env()),
      ])
      if (chatEl) chatEl.replaceWith(next); else split.append(next)
      chatEl = next
      shownChat = ck
    }
    chatEl?.classList.toggle('open', ui.open)
    const toggle = chatEl?.querySelector('[data-embeds-chat-toggle]')
    toggle?.setAttribute('aria-expanded', String(ui.open))
    if (toggle) toggle.textContent = ui.open ? t.chatCollapse : t.chatExpand
  }

  draw()
  return () => { root.replaceChildren(); box.remove() }
}
