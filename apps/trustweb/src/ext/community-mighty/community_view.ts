// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39 community-mighty: the Community view, drawn inside its own shadow root (CSS scoped, design tokens inherited as CSS
 * variables). Phone first: the left menu is a drawer and the chat a bottom sheet; from 900 px of the view's own width the menu
 * stands left, from 1100 px the chat is a pane on the right (container queries, no window listener). Every listener sits on an
 * element of the shadow root, so unmounting (or the module being off) leaves none behind.
 * Talks to the app only through TwCtx: bus 'save' after a record change, 'open-person' and 'open-event' to open the app's own cards.
 * An embed (Google Docs, Telegram) loads only after a consent tap, and that consent stays on this device (localStorage), never synced.
 */
import { el } from '../../../../demo/src/ui/dom'
import { addGroupPost } from '../../feed_sources'
import type { AppState } from '../../model'
import { loadColourTags } from '../../colour_tags'
import type { TwCtx } from '../tw_registry'
import {
  MODULE_ID, addResource, addToView, buildEvents, buildMembers, buildPosts, buildSpaces, communityTagOf, forkView, hideInView,
  joinSpace, leaveSpace, moveInView, navItems, parseCommunity, resolveView, type CommunityData, type NavId, type ResourceView,
} from './community_model'
import { readConsent, readEmbeds, writeConsent, writeEmbeds, type Consent } from '../embeds/embeds_data'
import { NO_TAG, entryFor, withEntry } from '../embeds/embeds_model'
import { chatKey as embedChatKey, chatPane as embedChatPane, docsPane, type PaneEnv } from '../embeds/embeds_panes'
import css from './community.css?inline'

export const readData = (s: AppState): CommunityData => parseCommunity(s.extData?.[MODULE_ID])

// Wave 40: the Docs and Telegram panes and their consent live in the embeds module (S/ext/embeds); community-mighty calls them.
export { readConsent, writeConsent, type Consent }

export function writeData(ctx: TwCtx, d: CommunityData): void {
  const s = ctx.store()
  s.extData = { ...s.extData, [MODULE_ID]: d }
  ctx.bus.emit('save')
}

type Kids = (Node | string | null | undefined)[]
const btn = (label: string, onclick: () => void, attrs: Record<string, string> = {}, cls = 'lnk'): HTMLButtonElement => el('button', { class: cls, type: 'button', ...attrs, onclick }, [label])
const dateOf = (ms: number): string => (ms > 0 ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '')

/** Wave 40: the regular Chat's "Community chat" row sets this flag, so the view opens with its chat pane showing (device-local, read once). */
export const OPEN_CHAT_KEY = 'trustweb.v1.community-mighty.open-chat'

export function mountCommunity(hostEl: HTMLElement, ctx: TwCtx): () => void {
  const t = ctx.strings.community
  const box = el('div', { class: 'community-host', 'data-community': '' })
  hostEl.append(box)
  const root = box.attachShadow({ mode: 'open' })
  const ui: { nav: NavId; space: string | null; drawer: boolean; chat: boolean; hiddenOpen: boolean; note: string; chatNote: string } = { nav: 'home', space: null, drawer: false, chat: false, hiddenOpen: false, note: '', chatNote: '' }

  try { if (localStorage.getItem(OPEN_CHAT_KEY)) { localStorage.removeItem(OPEN_CHAT_KEY); ui.chat = true } } catch { /* storage blocked: the pane stays closed */ }
  const st = (): AppState => ctx.store()
  const me = (): string => st().me.displayName || t.you
  const data = (): CommunityData => readData(st())
  const save = (d: CommunityData): void => { writeData(ctx, d); draw() }

  function go(n: NavId): void {
    ui.drawer = false
    ui.note = ''
    ui.chatNote = ''
    if (n === 'chat') ui.chat = !ui.chat
    else { ui.nav = n; ui.space = null }
    draw()
  }

  function avatar(name: string, cls = 'ava'): HTMLElement {
    return el('span', { class: cls, 'aria-hidden': 'true' }, [(name.trim()[0] ?? '?').toUpperCase()])
  }

  // ---- Home ----------------------------------------------------------------
  function composer(): HTMLElement {
    const s = st()
    const spaces = buildSpaces(s, loadColourTags()).filter((x) => x.joined)
    if (!spaces.length) return el('div', { class: 'card compose' }, [el('p', { class: 'meta' }, [t.joinToPost, ' ']), btn(t.nav.spaces, () => go('spaces'), { 'data-community-go': 'spaces' })])
    const text = el('textarea', { rows: 3, placeholder: t.composePh, 'aria-label': t.composePh, 'data-community-compose': '' })
    const to = el('select', { 'aria-label': t.composeTo, 'data-community-compose-to': '' }, spaces.map((x) => el('option', { value: x.id, ...(x.id === ui.space ? { selected: '' } : {}) }, [x.name])))
    const post = (): void => {
      const tags = loadColourTags()
      if (!addGroupPost(st(), `tag:${to.value}`, text.value, Date.now(), tags)) return
      ctx.bus.emit('save')
      draw()
    }
    return el('div', { class: 'card compose' }, [text, el('div', { class: 'row' }, [el('label', { class: 'meta' }, [t.composeTo, ' ', to]), btn(t.post, post, { 'data-community-post': '' }, 'lnk strong')])])
  }

  function postCard(p: ReturnType<typeof buildPosts>[number]): HTMLElement {
    const who = p.who ?? t.you
    const name = p.personId ? btn(who, () => ctx.bus.emit('open-person', p.personId), { 'data-community-person': p.personId }) : el('b', {}, [who])
    return el('article', { class: 'card post', 'data-community-postid': p.id }, [
      el('div', { class: 'post-head' }, [avatar(who), el('div', {}, [name, el('div', { class: 'meta' }, [[p.space, dateOf(p.at)].filter(Boolean).join(' · ')])])]),
      el('p', { class: 'post-text' }, [p.text]),
      p.context ? el('p', { class: 'meta' }, [p.context]) : null,
      p.unsent ? el('p', { class: 'meta' }, [t.onlyHere]) : null,
    ])
  }

  function home(): Kids {
    const posts = buildPosts(st(), loadColourTags())
    return [composer(), ...(posts.length ? posts.map(postCard) : [el('p', { class: 'empty' }, [t.homeEmpty])])]
  }

  // ---- Spaces --------------------------------------------------------------
  /** Join, or Leave when I joined it here; a space I am in through a ring's tags has nothing to undo here. */
  function joinBtn(x: { id: string; joined: boolean; leavable: boolean }): HTMLElement | null {
    if (x.joined && !x.leavable) return null
    return btn(x.joined ? t.leave : t.join, () => {
      if (x.joined) leaveSpace(st(), x.id, Date.now()); else joinSpace(st(), loadColourTags(), x.id, Date.now())
      ctx.bus.emit('save')
      draw()
    }, { 'data-community-join': x.id })
  }

  function spaces(): Kids {
    const s = st()
    const tags = loadColourTags()
    const list = buildSpaces(s, tags)
    const one = ui.space ? list.find((x) => x.id === ui.space) : undefined
    if (one) {
      const posts = buildPosts(s, tags, one.id)
      return [
        btn('‹ ' + t.allSpaces, () => { ui.space = null; draw() }, { 'data-community-all-spaces': '' }),
        el('div', { class: 'cover big', style: `--cover:${one.colour}` }, [el('h3', {}, [one.name])]),
        el('div', { class: 'row' }, [el('span', { class: 'meta' }, [t.members(one.members), one.joined ? ` · ${one.leavable ? t.joined : t.joinedViaRing}` : '']), joinBtn(one)]),
        ...(one.joined ? [composer()] : []),
        ...(posts.length ? posts.map(postCard) : [el('p', { class: 'empty' }, [t.spacePostsEmpty])]),
      ]
    }
    if (!list.length) return [el('p', { class: 'empty' }, [t.spacesEmpty])]
    return [el('div', { class: 'grid' }, list.map((x) => el('article', { class: 'card space', 'data-community-space': x.id }, [
      el('div', { class: 'cover', style: `--cover:${x.colour}` }),
      btn(x.name, () => { ui.space = x.id; draw() }, { 'data-community-open-space': x.id }, 'lnk title'),
      el('div', { class: 'row' }, [el('span', { class: 'meta' }, [t.members(x.members), x.joined && !x.leavable ? ` · ${t.joinedViaRing}` : '']), joinBtn(x)]),
    ])))]
  }

  // ---- Events --------------------------------------------------------------
  function events(): Kids {
    const cards = buildEvents(st().events, Date.now())
    if (!cards.length) return [el('p', { class: 'empty' }, [t.eventsEmpty])]
    const card = (c: (typeof cards)[number]): HTMLElement => el('article', { class: 'card event' + (c.past ? ' past' : ''), 'data-community-event': c.id }, [
      el('div', { class: 'date', 'aria-hidden': 'true' }, [el('small', {}, [c.month]), el('b', {}, [c.day])]),
      el('div', { class: 'ev-body' }, [
        btn(c.name, () => ctx.bus.emit('open-event', c.id), { 'data-community-open-event': c.id }, 'lnk title'),
        el('div', { class: 'meta' }, [[c.from + (c.to && c.to !== c.from ? ` – ${c.to}` : ''), c.where].filter(Boolean).join(' · ')]),
        c.host ? el('div', { class: 'meta' }, [t.hostedBy(c.host)]) : null,
        el('div', { class: c.going ? 'chip going' : 'chip' }, [c.going ? t.going : t.notGoing]),
      ]),
    ])
    const past = cards.filter((c) => c.past)
    return [...cards.filter((c) => !c.past).map(card), past.length ? el('h4', { class: 'eyebrow' }, [t.past]) : null, ...past.map(card)]
  }

  // ---- Members -------------------------------------------------------------
  function members(): Kids {
    const s = st()
    const tags = loadColourTags()
    const tag = communityTagOf(data(), s, tags)
    if (!tag) return [el('p', { class: 'empty' }, [t.noTag])]
    const list = buildMembers(s.people, tag)
    const name = tags.find((x) => x.id === tag)?.label ?? tag
    return [
      el('p', { class: 'meta' }, [t.membersOf(name, list.length)]),
      list.length ? el('div', { class: 'grid members' }, list.map((m) => el('button', {
        class: 'card member', type: 'button', 'data-community-member': m.id, onclick: () => ctx.bus.emit('open-person', m.id),
      }, [avatar(m.name, 'ava big'), el('span', { class: 'name' }, [m.name]), el('span', { class: 'chip ring' }, [ctx.strings.peopleZone[m.ring] ?? m.ring])]))) : el('p', { class: 'empty' }, [t.membersEmpty]),
    ]
  }

  // ---- Docs ----------------------------------------------------------------
  function myView(d: CommunityData): ResourceView { return d.mine ?? { owner: me(), order: [], hidden: [] } }

  function docs(): Kids {
    const d = data()
    const rows = resolveView(d.resources ?? [], d.mine)
    const setView = (v: ResourceView): void => save({ ...data(), mine: v })
    const row = (r: (typeof rows)[number]): HTMLElement => el('li', { class: 'res ' + r.state, 'data-community-res': r.item.id, 'data-state': r.state }, [
      el('div', { class: 'res-main' }, [
        el('a', { href: r.item.url, target: '_blank', rel: 'noopener noreferrer' }, [r.item.title]),
        el('span', { class: 'meta' }, [t.by(r.item.by)]),
      ]),
      el('div', { class: 'res-acts' }, r.state === 'shown' ? [
        btn('↑', () => setView(moveInView(myView(data()), r.item.id, -1)), { 'aria-label': t.up(r.item.title), 'data-community-res-up': r.item.id }),
        btn('↓', () => setView(moveInView(myView(data()), r.item.id, 1)), { 'aria-label': t.down(r.item.title), 'data-community-res-down': r.item.id }),
        btn(t.hide, () => setView(hideInView(myView(data()), r.item.id)), { 'data-community-res-hide': r.item.id }),
      ] : [btn(r.state === 'new' ? t.add : t.show, () => setView(addToView(myView(data()), r.item.id)), { 'data-community-res-add': r.item.id })]),
    ])
    const hidden = rows.filter((r) => r.state === 'hidden')
    const title = el('input', { type: 'text', placeholder: t.titlePh, 'aria-label': t.titlePh, 'data-community-res-title': '' })
    const url = el('input', { type: 'url', placeholder: t.linkPh, 'aria-label': t.linkPh, 'data-community-res-url': '' })
    const others = (d.views ?? []).filter((v) => v.owner !== me())
    return [
      el('h3', { class: 'res-head' }, [t.resources]),
      el('p', { class: 'meta' }, [t.resourcesHint]),
      rows.length ? el('ul', { class: 'res-list' }, rows.filter((r) => r.state !== 'hidden').map(row)) : el('p', { class: 'empty' }, [t.resourcesEmpty]),
      hidden.length ? btn((ui.hiddenOpen ? '▾ ' : '▸ ') + t.hidden(hidden.length), () => { ui.hiddenOpen = !ui.hiddenOpen; draw() }, { 'data-community-res-hidden': '' }) : null,
      ui.hiddenOpen && hidden.length ? el('ul', { class: 'res-list' }, hidden.map(row)) : null,
      el('div', { class: 'card add-res' }, [title, url, btn(t.add, () => {
        const next = data()
        if (!addResource(next, { title: title.value, url: url.value }, me(), Date.now())) { ui.note = t.badLink; draw(); return }
        ui.note = ''
        save(next)
      }, { 'data-community-res-new': '' }, 'lnk strong')]),
      el('h4', { class: 'eyebrow' }, [t.forkTitle]),
      d.mine?.from ? el('p', { class: 'meta' }, [t.forkFrom(d.mine.from)]) : null,
      others.length ? el('div', { class: 'row wrap' }, others.map((v) => btn(v.owner, () => save({ ...data(), mine: forkView(v, me()) }), { 'data-community-fork': v.owner }))) : el('p', { class: 'meta' }, [t.forkNone]),
      docsPane(embedEnv()),
    ]
  }

  /** The pane environment of the embeds module: this community's tag, redraw after a change, a note under the section. */
  const embedEnv = (kind: 'docs' | 'chat' = 'docs'): PaneEnv => ({ ctx, tag: communityTagOf(data(), st(), loadColourTags()) ?? NO_TAG, redraw: draw, note: (text) => { if (kind === 'docs') ui.note = text; else ui.chatNote = text; draw() } })

  /** Wave 40: a Docs or Telegram link kept by wave 39 in this module's own slice moves into the embeds record once (when that has none for the tag). */
  function adoptLegacyLinks(): void {
    const d = data()
    const env = embedEnv()
    const have = entryFor(readEmbeds(st()), env.tag)
    const patch = { ...(d.docsUrl && !have.docsUrl ? { docsUrl: d.docsUrl } : {}), ...(d.telegramUrl && !have.telegramUrl ? { telegramUrl: d.telegramUrl } : {}) }
    if (Object.keys(patch).length) writeEmbeds(ctx, withEntry(readEmbeds(st()), env.tag, patch))
  }

  // ---- Chat (right pane on wide views, bottom sheet on phones) --------------
  /** What the chat pane shows; the pane is rebuilt only when this changes, so a loaded Telegram frame is not reloaded by other taps. */
  function chatKey(): string {
    return ui.chat ? embedChatKey(embedEnv('chat')) + ui.chatNote : ''
  }

  /** Wave 40: the app's regular chats under the group chat; a tap opens that chat in the app. Refilled on every draw, so the pane (and its frame) stays. */
  let chatsBox: HTMLElement | null = null
  function fillChats(): void {
    const rows = ctx.chats?.() ?? []
    chatsBox?.replaceChildren(
      el('h4', {}, [t.chatsTitle]),
      ...(rows.length
        ? rows.map((r) => el('button', { class: 'lnk chat-row', type: 'button', 'data-community-chat-row': r.id, onclick: () => ctx.bus.emit('open-chat', r.id) }, [r.title + (r.unread > 0 ? ` (${r.unread})` : ''), el('span', { class: 'meta' }, [' ' + r.last])]))
        : [el('p', { class: 'meta' }, [t.chatsNone])]),
    )
  }

  function chatPane(): HTMLElement {
    chatsBox = el('div', { class: 'chats', 'data-community-chats': '' })
    const head = el('div', { class: 'row' }, [el('h3', {}, [t.chatTitle]), btn('×', () => { ui.chat = false; draw() }, { 'aria-label': t.chatClose, 'data-community-chat-close': '' })])
    const body = embedChatPane(embedEnv('chat'))
    return el('aside', { class: 'chat', 'data-community-chat': '' }, [head, body, ...(ui.chatNote ? [el('p', { class: 'note' }, [ui.chatNote])] : []), chatsBox])
  }

  // ---- Shell ---------------------------------------------------------------
  // Kept elements: only the bar, the menu and the section are rebuilt on each draw; the chat pane only when chatKey() changes.
  const style = el('style', {}, [css])
  const cm = el('div', { class: 'cm' })
  const bar = el('div', { class: 'bar' })
  const shell = el('div', { class: 'grid-shell' })
  let navEl: HTMLElement = el('nav', { class: 'nav' })
  let mainEl: HTMLElement = el('main', { class: 'main' })
  let veil: HTMLElement | null = null
  let chatEl: HTMLElement | null = null
  let shownChat = ''
  shell.append(navEl, mainEl)
  cm.append(bar, shell)
  root.append(style, cm)

  function draw(): void {
    const items = navItems(data())
    if (!items.includes(ui.nav)) ui.nav = items.find((n) => n !== 'chat') ?? 'home'
    if (!items.includes('chat')) ui.chat = false
    cm.className = 'cm' + (ui.drawer ? ' drawer-open' : '') + (ui.chat ? ' chat-open' : '')
    cm.dataset.nav = ui.nav
    bar.replaceChildren(
      btn('☰ ' + t.menu, () => { ui.drawer = !ui.drawer; draw() }, { 'aria-expanded': String(ui.drawer), 'data-community-menu': '' }, 'lnk menu'),
      el('h3', { class: 'section' }, [t.nav[ui.nav], ' ', el('sub', { class: 'alpha', 'data-community-alpha': '' }, [ctx.strings.alphaLabel])]),
    )
    veil?.remove()
    veil = ui.drawer ? el('div', { class: 'veil', 'data-community-veil': '', onclick: () => { ui.drawer = false; draw() } }) : null
    if (veil) cm.insertBefore(veil, shell)
    const nav = el('nav', { class: 'nav', 'aria-label': t.title }, items.map((n) => btn(t.nav[n], () => go(n), {
      'data-community-nav': n, ...((n === 'chat' ? ui.chat : n === ui.nav) ? { 'aria-current': 'page' } : {}),
    }, 'navlnk')))
    navEl.replaceWith(nav)
    navEl = nav
    const section = ui.nav === 'spaces' ? spaces() : ui.nav === 'events' ? events() : ui.nav === 'members' ? members() : ui.nav === 'docs' ? docs() : home()
    const main = el('main', { class: 'main' }, [...section, ui.note ? el('p', { class: 'note' }, [ui.note]) : null])
    mainEl.replaceWith(main)
    mainEl = main
    const key = chatKey()
    if (key !== shownChat) {
      const next = ui.chat ? chatPane() : null
      if (chatEl && next) chatEl.replaceWith(next); else if (chatEl) chatEl.remove(); else if (next) shell.append(next)
      chatEl = next
      shownChat = key
    }
    if (ui.chat) fillChats()
  }

  adoptLegacyLinks()
  draw()
  return () => { root.replaceChildren(); box.remove() }
}
