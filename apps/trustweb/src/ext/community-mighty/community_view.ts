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
import { hasColourTag, loadColourTags, saveColourTags } from '../../colour_tags'
import { contextPress } from '../../context_press'
import { strikeOff } from '../../bw_mode'
import { ICONS } from '../../icons'
import type { TwCtx } from '../tw_registry'
import {
  MODULE_ID, NAV, addResource, addToView, buildEvents, buildMembers, buildPosts, buildSpaces, communityTagOf, forkView, hideInView,
  joinSpace, leaveSpace, moveInView, parseCommunity, resolveView, type CommunityData, type NavId, type ResourceView,
  adoptMetaTags, canEditSettings, createCommunity, leftNav, listCommunities, metaOf, setKind, setSettings, type CommunityKind,
} from './community_model'
import { SUBCOMMUNITY_FREE_LIMIT, canAddSub, communityTree, descendantsOf, legacyLinksPatch, rootOf, subCommunityCount, TILES, type TileId } from './community_data'
import {
  WHATSAPP_BRIDGE_ENABLED, dashboardSocial, followTiles, setShareLayout, shareLayoutOn, tilePercents, tileSetOf, type TileAggregate, chatCommunities, chatOnlyCommunity, communityChatRows, connectEvents, homeTiles, isManager, menuItems, recordTileUse,
  renameCommunity, setChatOnly, setConnectEvents, setManagedTiles, setOwnTiles, startLayout, toggleTile,
} from './community_data'
import { createCommunityCalendar } from './community_calendar_view'
import { fetchAggregate, layoutShareAllowed, sendTileSet } from './community_server'
import { readConsent, readEmbeds, writeConsent, writeEmbeds, type Consent } from '../embeds/embeds_data'
import { NO_TAG, entryFor, withEntry } from '../embeds/embeds_model'
import { chatPane as embedChatPane, docsPane, type PaneEnv } from '../embeds/embeds_panes'
import { scopeOf } from '../../resource_scope'
import { EVENT_TAG, scopedResources } from '../../resource_scope_view'
import css from './community.css?inline'
import { draftable } from '../../drafts_dom'

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
  const ui: { nav: NavId | 'calendar'; space: string | null; drawer: boolean; hiddenOpen: boolean; note: string; chatNote: string; switcher: boolean; settings: boolean; addEvent: boolean; rename: boolean; tilesOpen: boolean; folded: string[]; more: string | null } = { nav: 'home', space: null, drawer: false, hiddenOpen: false, note: '', chatNote: '', switcher: false, settings: false, addEvent: false, rename: false, tilesOpen: false, folded: [], more: null }
  const w43 = ctx.strings.w43shell

  try { if (localStorage.getItem(OPEN_CHAT_KEY)) { localStorage.removeItem(OPEN_CHAT_KEY); ui.nav = 'chat' } } catch { /* storage blocked: the pane stays closed */ }
  const st = (): AppState => ctx.store()
  const me = (): string => st().me.displayName || t.you
  const data = (): CommunityData => readData(st())
  const save = (d: CommunityData): void => { writeData(ctx, d); draw() }

  /** The community in force: my pick, else the rings' community tag, else the first. */
  const tagNow = (): string | null => communityTagOf(data(), st(), loadColourTags())

  function go(n: NavId | 'calendar'): void {
    ui.drawer = false
    ui.settings = false
    ui.switcher = false
    ui.rename = false
    ui.addEvent = false
    ui.note = ''
    ui.chatNote = ''
    ui.nav = n
    ui.space = null
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
      kept.clear()   // wave44c event-autosave
      ctx.bus.emit('save')
      draw()
    }
    const box = el('div', { class: 'card compose' }, [text, el('div', { class: 'row' }, [el('label', { class: 'meta' }, [t.composeTo, ' ', to]), btn(t.post, post, { 'data-community-post': '' }, 'lnk strong')])])
    const kept = draftable(box, 'community', 'home')
    return box
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

  /** Wave 43b (B35): the timeline left Home; it is its own menu item now. */
  function timeline(): Kids {
    const posts = buildPosts(st(), loadColourTags())
    return [composer(), ...(posts.length ? posts.map(postCard) : [el('p', { class: 'empty' }, [t.homeEmpty])])]
  }

  // ---- Home: the dashboard of tiles (wave 43b, B35/B36) ----------------------------------------------------------------
  const TILE_GO: Record<TileId, NavId> = { events: 'events', spaces: 'spaces', docs: 'docs', members: 'members', resources: 'resources', timeline: 'timeline' }
  function tileCount(tile: TileId, tag: string | null): number {
    const s = st()
    const tags = loadColourTags()
    if (tile === 'events') return buildEvents(s.events, Date.now(), s.people).filter((c) => !c.past).length
    if (tile === 'spaces') return buildSpaces(s, tags).length
    if (tile === 'members') return buildMembers(s.people, tag).length
    if (tile === 'timeline') return buildPosts(s, tags).length
    return (data().resources ?? []).length
  }
  function tileCard(tile: TileId, tag: string | null, managed: boolean): HTMLElement {
    return el('button', {
      class: 'card tile' + (managed ? ' managed' : ''), type: 'button', 'data-community-tile': tile,
      onclick: () => { writeData(ctx, recordTileUse(data(), tile)); go(TILE_GO[tile]) },
    }, [el('b', {}, [w43.tileNames[tile]]), el('span', { class: 'meta' }, [w43.tileCount(tile, tileCount(tile, tag))])])
  }
  /** One on/off row: the checkbox keeps its width, the label takes the rest of the line (B34: it must never wrap per letter). */
  const pick = (label: string, attrs: Record<string, string>, on: boolean, onchange: (v: boolean) => void, off = false): HTMLElement =>
    el('label', { class: 'pick' + (on ? '' : ' tw-off') }, [el('input', { type: 'checkbox', ...SWITCH(on), ...attrs, ...(on ? { checked: '' } : {}), ...(off ? { disabled: '' } : {}), onchange: (e: Event) => onchange((e.target as HTMLInputElement).checked) }), el('span', {}, [label])])

  // Wave 43c connect-extras (theta): the opt-in layout share. `sent` = the tile set the server last took, `agg` = its answer (null: none shown), `no` = "No thanks" this session.
  const social = { sent: {} as Record<string, string>, agg: {} as Record<string, TileAggregate | null>, no: new Set<string>() }
  const newSlot = (): string => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')
  /** Only with the switch on: sends my tile set when it changed, then reads the aggregate once. Never before the opt-in. */
  function syncAggregate(tag: string): void {
    const d = data()
    const slot = d.meta?.[tag]?.slot
    if (!layoutShareAllowed(st(), shareLayoutOn(d, tag)) || !slot) return
    const tiles = tileSetOf(d, tag)
    const key = tiles.join(',')
    if (social.sent[tag] === key) return
    social.sent[tag] = key
    void sendTileSet(fetch, tag, slot, tiles).then(() => fetchAggregate(fetch, tag)).then((a) => { social.agg[tag] = a; draw() })
  }
  function socialCard(tag: string): HTMLElement | null {
    const d = data()
    const w = ctx.strings.w43connect
    const on = shareLayoutOn(d, tag)
    const agg = social.agg[tag]
    const toggle = pick(w.shareLayout, { 'data-community-share-layout': '' }, on, (v) => { if (!v) delete social.sent[tag]; save(setShareLayout(data(), tag, v, newSlot)) })
    if (!dashboardSocial(d, tag) || !agg || social.no.has(tag)) return el('div', { class: 'card', 'data-community-social': on ? 'on' : 'off' }, [toggle, el('p', { class: 'meta' }, [!layoutShareAllowed(st(), true) ? w.shareLayoutNoServer : on ? w.shareLayoutHint : w.shareLayoutOff])])
    const parts = tilePercents(agg).map((r) => `${w43.tileNames[r.tile]} ${r.pct} %`)
    const follow = followTiles(agg)
    return el('div', { class: 'card', 'data-community-social': 'on' }, [
      toggle,
      el('p', { class: 'meta', 'data-community-social-others': '' }, [`${w.others(parts)}. ${w.follow}`]),
      el('div', { class: 'row wrap' }, [
        btn(w.followYes, () => save(setOwnTiles(data(), tag, follow)), { 'data-community-social-follow': '' }),
        btn(w.followNo, () => { social.no.add(tag); draw() }, { 'data-community-social-no': '' }),
      ]),
    ])
  }

  function home(): Kids {
    const tag = tagNow()
    const d = data()
    const { managed, own } = homeTiles(d, tag ?? '')
    const from = tag ? startLayout(d, tag) : null
    const fromId = tag ? Object.entries(d.meta ?? {}).find(([id, m]) => id !== tag && m.tiles)?.[0] : undefined
    const fromName = listCommunities(d, loadColourTags(), st().people).find((r) => r.id === fromId)?.name ?? fromId ?? ''
    const choose = tag ? el('details', { class: 'tiles-edit', 'data-community-tiles-edit': '', ...(ui.tilesOpen ? { open: '' } : {}), ontoggle: (e: Event) => { ui.tilesOpen = (e.target as HTMLDetailsElement).open } }, [
      el('summary', {}, [w43.tilesChoose]),
      ...TILES.map((x) => pick(w43.tileNames[x], { 'data-community-tile-toggle': x }, managed.includes(x) || own.includes(x), () => save(toggleTile(data(), tag, x)), managed.includes(x))),
      managed.length ? el('p', { class: 'meta' }, [w43.tilesManagedOnly]) : null,
      isManager(d, tag) ? el('p', { class: 'chips-lbl' }, [w43.tilesManagedChoose]) : null,
      ...(isManager(d, tag) ? TILES.map((x) => pick(w43.tileNames[x], { 'data-community-managed-tile': x }, managed.includes(x), (on) => save(setManagedTiles(data(), tag, on ? [...managed, x] : managed.filter((y) => y !== x))))) : []),
    ]) : null
    return [
      from && fromId ? el('div', { class: 'card', 'data-community-start-layout': '' }, [el('p', { class: 'meta' }, [w43.startFrom(fromName)]), btn(w43.startUse, () => save(setOwnTiles(data(), tag!, from)), { 'data-community-start-use': '' }, 'lnk strong')]) : null,
      // Wave 43c (theta): the opt-in switch, and what other members show once enough of them shared (nothing is sent or read while it is off).
      tag ? (syncAggregate(tag), socialCard(tag)) : null,
      managed.length ? el('section', { class: 'tiles-managed', 'data-community-tiles-managed': '' }, [el('h4', { class: 'eyebrow' }, [w43.homeManaged]), el('div', { class: 'grid' }, managed.map((x) => tileCard(x, tag, true)))]) : null,
      own.length ? el('div', { class: 'grid', 'data-community-tiles': '' }, own.map((x) => tileCard(x, tag, false))) : el('p', { class: 'empty' }, [w43.homeNoTiles]),
      choose,
    ]
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
    const cards = buildEvents(st().events, Date.now(), st().people)
    const tag = communityTagOf(data(), st(), loadColourTags())
    const create = btn(ctx.strings.w42ev.newEvent, () => ctx.bus.emit('new-event', { tag }), { 'data-community-new-event': '' }, 'btn')
    if (!cards.length) return [create, el('p', { class: 'empty' }, [t.eventsEmpty])]
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
    return [create, ...cards.filter((c) => !c.past).map(card), past.length ? el('h4', { class: 'eyebrow' }, [t.past]) : null, ...past.map(card)]
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
      // wave44 steer-invite-link: the invite links (personal / open), placed like the event's share row; the app opens the sheet.
      el('div', { class: 'row invite-row' }, [btn(`${ctx.strings.w43press.iconLink} ${ctx.strings.invite.button}`, () => ctx.bus.emit('community-invite', { tag }), { 'data-community-invite': '' }, 'lnk strong')]),
      list.length ? null : el('p', { class: 'empty' }, [t.membersEmpty]),
      // Wave 42: the add tile has the size of a member tile, only a centred "+", last in the grid; it opens the add-person flow for this community.
      el('div', { class: 'grid members' }, [
        ...list.map((m) => el('button', {
          class: 'card member', type: 'button', 'data-community-member': m.id, onclick: () => ctx.bus.emit('open-person', m.id),
        }, [avatar(m.name, 'ava big'), el('span', { class: 'name' }, [m.name]), el('span', { class: 'chip ring' }, [ctx.strings.peopleZone[m.ring] ?? m.ring])])),
        el('button', { class: 'card member add-tile', type: 'button', 'aria-label': ctx.strings.w42.addMember, 'data-community-add-member': '', onclick: () => ctx.bus.emit('add-member', { tag }) }, ['+']),
      ]),
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

  /** Wave 44c community-resources: this community's resources / references (event mode: the event's), General folded. */
  function scoped(page: 'resources' | 'references'): Kids {
    const tags = loadColourTags()
    const tag = tagNow()
    const found = tags.find((x) => x.id === tag)
    const scope = scopeOf(st(), tags, st().events ?? [], EVENT_TAG) ?? (found ? { kind: 'community' as const, id: found.id, label: found.label ?? found.id } : null)
    if (!scope) return [el('p', { class: 'empty' }, [ctx.strings.w44cr.none])]
    return scopedResources({ items: st().inventory, tags, events: st().events ?? [], scope, page, open: (id) => ctx.bus.emit('open-item', id), save: () => ctx.bus.emit('save'), render: draw })
  }

  /** The pane environment of the embeds module: this community's tag, redraw after a change, a note under the section. */
  const embedEnv = (kind: 'docs' | 'chat' = 'docs'): PaneEnv => ({ ctx, tag: communityTagOf(data(), st(), loadColourTags()) ?? NO_TAG, redraw: draw, note: (text) => { if (kind === 'docs') ui.note = text; else ui.chatNote = text; draw() } })

  /** Wave 40: a Docs or Telegram link kept by wave 39 in this module's own slice moves into the embeds record once (when that has none for the tag); review: marked, so a link cleared later stays cleared. */
  function adoptLegacyLinks(): void {
    const env = embedEnv()
    const { patch, next } = legacyLinksPatch(data(), entryFor(readEmbeds(st()), env.tag))
    if (patch) writeEmbeds(ctx, withEntry(readEmbeds(st()), env.tag, patch))
    if (next) writeData(ctx, next)
  }

  // ---- Chat: a page inside the community (wave 43b, B8), no overlay -----------------------------------------------------
  function chatPage(): Kids {
    const d = data()
    const tag = tagNow()
    const only = chatOnlyCommunity(d)
    const people = st().people.map((p) => ({ id: p.id, tags: tag && hasColourTag(p, tag) ? [tag] : [] }))
    const rows = communityChatRows((ctx.chats?.() ?? []).map((r) => ({ ...r, personId: r.id })), people, tag, only)
    const communities = chatCommunities(d, loadColourTags())
    const which = el('select', { 'aria-label': w43.chatPick, 'data-community-chat-pick': '', onchange: (e: Event) => save({ ...data(), tag: (e.target as HTMLSelectElement).value }) },
      communities.map((c) => el('option', { value: c.id, ...(c.id === tag ? { selected: '' } : {}) }, [c.name])))
    return [
      el('div', { class: 'card chat-head', 'data-community-chat': '' }, [
        pick(w43.chatOnly, { 'data-community-chat-only': '' }, only, (on) => save(setChatOnly(data(), on))),
        communities.length ? el('label', { class: 'meta' }, [w43.chatPick, ' ', which]) : null,
      ]),
      embedChatPane(embedEnv('chat')),
      ui.chatNote ? el('p', { class: 'note' }, [ui.chatNote]) : null,
      el('div', { class: 'chats', 'data-community-chats': '' }, [
        el('h4', {}, [t.chatsTitle]),
        ...(rows.length
          ? rows.map((r) => el('button', { class: 'lnk chat-row', type: 'button', 'data-community-chat-row': r.id, onclick: () => ctx.bus.emit('open-chat', r.id) }, [r.title + (r.unread > 0 ? ` (${r.unread})` : ''), el('span', { class: 'meta' }, [' ' + r.last])]))
          : [el('p', { class: 'meta' }, [t.chatsNone])]),
      ]),
      el('details', { class: 'chat-advanced', 'data-community-chat-advanced': '' }, [
        el('summary', {}, [w43.chatAdvanced]),
        // Wave 43b (B8): the WhatsApp bridge is not built (WHATSAPP_BRIDGE_ENABLED); the row stays, disabled.
        pick(w43.chatBridge, { 'data-community-chat-bridge': '' }, false, () => undefined, !WHATSAPP_BRIDGE_ENABLED),
        WHATSAPP_BRIDGE_ENABLED ? null : el('p', { class: 'meta' }, [w43.chatBridgeOff]),
      ]),
    ]
  }

  /** Wave 44b: a sub-community is hidden while any community above it is folded. */
  function hiddenByFold(id: string): boolean {
    for (let p = data().meta?.[id]?.parent, n = 0; p && n < 50; p = data().meta?.[p]?.parent, n++) if (ui.folded.includes(p)) return true
    return false
  }

  /** Wave 44b: above SUBCOMMUNITY_FREE_LIMIT sub-communities under one root, "Request more" asks for room (the support ask, scoped to the root community; Q in the report: a message to the hosting contact). */
  function moreDialog(root: string): HTMLElement {
    const w = ctx.strings.w44fc
    const name = listCommunities(data(), loadColourTags(), st().people).find((r) => r.id === root)?.name ?? root
    return el('div', { class: 'card sub-more', role: 'dialog', 'aria-label': w.subMoreTitle, 'data-community-sub-more': '' }, [
      el('h3', {}, [w.subMoreTitle]),
      el('p', { class: 'meta' }, [w.subMoreText(name, subCommunityCount(data(), root)), ' ', w.subCount(subCommunityCount(data(), root), SUBCOMMUNITY_FREE_LIMIT)]),
      btn(w.subMoreAsk, () => { ui.more = null; ctx.bus.emit('support-ask', { tag: root }); draw() }, { 'data-community-sub-more-ask': '' }, 'lnk strong'),
      btn(w.subMoreClose, () => { ui.more = null; draw() }, { 'data-community-sub-more-close': '' }, 'lnk'),
    ])
  }

  // ---- Wave 42: the community switcher and the per-community settings -----------------------------------------------------
  function switcher(): HTMLElement {
    const w = ctx.strings.w42
    const rows = listCommunities(data(), loadColourTags(), st().people)
    const name = el('input', { type: 'text', maxlength: '40', placeholder: w.newName, 'aria-label': w.newName, 'data-community-new-name': '' })
    const kind = el('select', { 'aria-label': w.kindLabel, 'data-community-new-kind': '' }, [el('option', { value: 'informal' }, [w.kindInformal]), el('option', { value: 'managed' }, [w.kindManaged])])
    // Wave 44 home-dashboard: what it is (a community or another group, e.g. family); managed or unmanaged is asked only here, later it lives in Settings.
    const group = el('select', { 'aria-label': ctx.strings.dashboard.newKind, 'data-community-new-group': '' }, [el('option', { value: '' }, [ctx.strings.dashboard.kinds.community]), el('option', { value: 'otherGroup' }, [ctx.strings.dashboard.kinds.otherGroup])])
    // Wave 44b (item 5): a community made inside another is its sub-community; the select names the parent (default: the community I am in, or the top level).
    const parent = el('select', { 'aria-label': ctx.strings.w44fc.subOf, 'data-community-new-parent': '' }, [
      el('option', { value: '' }, [ctx.strings.w44fc.subTop]),
      ...rows.map((r) => el('option', { value: r.id, ...(r.current ? { selected: '' } : {}) }, [ctx.strings.w44fc.subOf + ' ' + r.name])),
    ]) as HTMLSelectElement
    const newRow = el('div', { class: 'row wrap switch-new' }, [name, group, kind, parent, btn(w.create, () => make(), { 'data-community-create': '' }, 'lnk strong')])
    const made = draftable(newRow, 'community-new', 'new')
    const make = (): void => {
      const under = parent.value || undefined
      if (under && !canAddSub(data(), under)) { ui.more = rootOf(data(), under); draw(); return }   // above SUBCOMMUNITY_FREE_LIMIT: the request dialog
      const out = createCommunity(data(), loadColourTags(), name.value, (kind as HTMLSelectElement).value as CommunityKind, (group as HTMLSelectElement).value === 'otherGroup' ? 'otherGroup' : undefined, under)
      if (!out) { name.focus(); return }
      made.clear()   // wave44c event-autosave
      saveColourTags(out.tags as never)
      ui.switcher = false
      save(out.data)
    }
    return el('div', { class: 'switcher', 'data-community-switcher': '', role: 'menu' }, [
      ...communityTree(data(), rows).filter((n) => !hiddenByFold(n.row.id)).map((n) => {
        const r = n.row
        const kids = descendantsOf(data(), r.id).length > 0
        const folded = ui.folded.includes(r.id)
        return el('div', { class: 'switch-line', style: `padding-left:${n.depth * 14}px`, 'data-community-depth': String(n.depth) }, [
          kids ? el('button', { class: 'lnk fold', type: 'button', 'aria-expanded': String(!folded), 'aria-label': folded ? ctx.strings.w44fc.subExpand(r.name) : ctx.strings.w44fc.subCollapse(r.name), 'data-community-fold': r.id,
            onclick: () => { ui.folded = folded ? ui.folded.filter((x) => x !== r.id) : [...ui.folded, r.id]; draw() } }, [folded ? '▸' : '▾']) : el('span', { class: 'fold-gap', 'aria-hidden': 'true' }, ['']),
          el('button', {
            class: 'lnk switch-row' + (r.current ? ' on' : ''), type: 'button', role: 'menuitemradio', 'aria-checked': String(r.current), 'data-community-pick': r.id,
            onclick: () => { ui.switcher = false; ui.space = null; save({ ...data(), tag: r.id }) },
          }, [el('b', {}, [r.name]), el('span', { class: 'meta' }, [` ${w.memberCount(r.members)}`])]),
        ])
      }),
      newRow,
      ui.more ? moreDialog(ui.more) : null,
    ])
  }

  /** B07 (review wave 42): an on/off setting is the TrustWeb switch (styles.css input.tr-switch), never a bare checkbox. */
  const SWITCH = (on: boolean): Record<string, string> => ({ class: 'tr-switch', role: 'switch', 'aria-checked': String(on) })
  function settingsPanel(tag: string): HTMLElement {
    const w = ctx.strings.w42
    const d = data()
    const m = metaOf(d, tag)
    const can = canEditSettings(d, tag)
    const shown = leftNav(d, tag)
    const dis: Record<string, string> = can ? {} : { disabled: '' }
    return el('section', { class: 'card settings', 'data-community-settings-panel': '' }, [
      el('h3', {}, [w.settings]),
      can ? null : el('p', { class: 'meta' }, [w.settingsOnlyOrganizers]),
      el('label', { class: 'meta' }, [w.kindLabel, ' ', el('select', { 'data-community-kind': '', ...dis, onchange: (e: Event) => save(setKind(data(), tag, (e.target as HTMLSelectElement).value as CommunityKind)) }, [
        el('option', { value: 'informal', ...(m.kind === 'informal' ? { selected: '' } : {}) }, [w.kindInformal]),
        el('option', { value: 'managed', ...(m.kind === 'managed' ? { selected: '' } : {}) }, [w.kindManaged]),
      ])]),
      el('p', { class: 'meta' }, [m.kind === 'managed' ? w.kindHintManaged : w.kindHintInformal]),
      pick(w.askToggle, { 'data-community-ask-toggle': '' }, m.ask === true, (on) => save(setSettings(data(), tag, { ask: on })), !can),
      el('p', { class: 'chips-lbl' }, [w.leftColumn]),
      ...NAV.map((n) => pick(t.nav[n], { 'data-community-nav-toggle': n }, shown.includes(n), () => {
        const now = leftNav(data(), tag)
        save(setSettings(data(), tag, { nav: now.includes(n) ? now.filter((x) => x !== n) : NAV.filter((x) => x === n || now.includes(x)) }))
      }, !can)),
      btn(w.save, () => { ui.settings = false; draw() }, { 'data-community-settings-done': '' }, 'lnk strong'),
    ])
  }

  // ---- Shell ---------------------------------------------------------------
  // Kept elements: only the bar, the menu and the section are rebuilt on each draw.
  const style = el('style', {}, [css])
  const cm = el('div', { class: 'cm' })
  const bar = el('div', { class: 'bar' })
  const shell = el('div', { class: 'grid-shell' })
  let navEl: HTMLElement = el('nav', { class: 'nav' })
  let mainEl: HTMLElement = el('main', { class: 'main' })
  let veil: HTMLElement | null = null
  shell.append(navEl, mainEl)
  cm.append(bar, shell)
  root.append(style, cm)

  /** B33: the very top of the menu is the community's name as a dropdown: press = switch community, long press or right click = edit the name. */
  function nameDropdown(tag: string): HTMLElement {
    const w = ctx.strings.w42
    const name = listCommunities(data(), loadColourTags(), st().people).find((r) => r.id === tag)?.name ?? t.title
    if (ui.rename) {
      const input = el('input', { type: 'text', maxlength: '40', value: name, 'aria-label': w43.editName, 'data-community-rename': '' }) as HTMLInputElement
      const done = (): void => {
        const out = renameCommunity(data(), loadColourTags(), tag, input.value)
        ui.rename = false
        if (!out) { ui.note = canEditSettings(data(), tag) ? '' : w.settingsOnlyOrganizers; draw(); return }
        saveColourTags(out.tags as never)
        save(out.data)
      }
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done() })
      return el('div', { class: 'cm-name row' }, [input, btn(w43.editNameSave, done, { 'data-community-rename-save': '' }, 'lnk strong')])
    }
    const b = btn(name, () => { ui.switcher = !ui.switcher; draw() }, { 'aria-haspopup': 'menu', 'aria-expanded': String(ui.switcher), 'aria-label': w.switchAria, 'data-community-switch': '' }, 'navlnk switch')
    contextPress(b, () => { ui.rename = true; ui.switcher = false; draw() })
    return el('div', { class: 'cm-name' }, [b, ...(ui.switcher ? [switcher()] : [])])
  }

  /** B33: "Add event" with the informal or hosted choice, and "connect events with this community" (its events wear its colour in my calendar). */
  function eventBlock(tag: string): Node[] {
    const start = (hosted: boolean): void => { ui.addEvent = false; ui.drawer = false; ctx.bus.emit('new-event', { tag, hosted }); draw() }
    return [
      btn(w43.addEvent, () => { ui.addEvent = !ui.addEvent; draw() }, { 'aria-expanded': String(ui.addEvent), 'data-community-add-event': '' }, 'navlnk strong'),
      ...(ui.addEvent ? [el('div', { class: 'row wrap add-event-kind' }, [btn(w43.addEventInformal, () => start(false), { 'data-community-add-event-kind': 'informal' }), btn(w43.addEventHosted, () => start(true), { 'data-community-add-event-kind': 'hosted' })])] : []),
      pick(w43.connectEvents, { 'data-community-connect-events': '' }, connectEvents(data(), tag), (on) => save(setConnectEvents(data(), tag, on))),
    ]
  }

  const calendar = createCommunityCalendar(ctx.strings, st, (id) => ctx.bus.emit('open-event', id), () => draw())

  function draw(): void {
    const tag = tagNow()
    const items = leftNav(data(), tag)
    if (!(items as readonly string[]).includes(ui.nav) && !(ui.nav === 'calendar' && items.includes('events'))) ui.nav = items[0] ?? 'home'
    cm.className = 'cm' + (ui.drawer ? ' drawer-open' : '') + (strikeOff(st()) ? ' tw-bw' : '')
    cm.dataset.nav = ui.nav
    bar.replaceChildren(
      btn('☰ ' + t.menu, () => { ui.drawer = !ui.drawer; draw() }, { 'aria-expanded': String(ui.drawer), 'data-community-menu': '' }, 'lnk menu'),
      el('h3', { class: 'section' }, [ui.nav === 'calendar' ? ctx.strings.w44vis.calendar : t.nav[ui.nav], ' ', el('sub', { class: 'alpha', 'data-community-alpha': '' }, [ctx.strings.alphaLabel])]),
    )
    veil?.remove()
    veil = ui.drawer ? el('div', { class: 'veil', 'data-community-veil': '', onclick: () => { ui.drawer = false; draw() } }) : null
    if (veil) cm.insertBefore(veil, shell)
    const nav = el('nav', { class: 'nav', 'aria-label': t.title }, [
      tag ? nameDropdown(tag) : null,
      ...(tag ? eventBlock(tag) : []),
      tag ? el('div', { class: 'nav-sep', 'aria-hidden': 'true' }) : null,
      ...menuItems(data(), tag).flatMap((n) => n === 'ask'
        ? [btn(ctx.strings.w42.askButton, () => { ui.drawer = false; ctx.bus.emit('support-ask', { tag }); draw() }, { 'data-community-ask': '' }, 'navlnk')]
        : [btn(t.nav[n], () => go(n), { 'data-community-nav': n, ...(n === ui.nav ? { 'aria-current': 'page' } : {}) }, 'navlnk'),
          // Wave 44 steer-event-visibility (item 4): "Calendar" sits right under Events.
          ...(n === 'events' ? [btn(ctx.strings.w44vis.calendar, () => go('calendar'), { 'data-community-nav': 'calendar', ...(ui.nav === 'calendar' ? { 'aria-current': 'page' } : {}) }, 'navlnk')] : [])]),
      // B33: at the bottom only the gear, no words.
      tag ? el('button', { class: 'navlnk gear', type: 'button', 'aria-label': w43.settingsGear, title: w43.settingsGear, 'data-community-settings': '', onclick: () => { ui.drawer = false; ui.settings = true; draw() } }) : null,
    ])
    const gear = nav.querySelector('.gear')
    if (gear) gear.innerHTML = ICONS.settings
    navEl.replaceWith(nav)
    navEl = nav
    const section = ui.settings && tag ? [settingsPanel(tag)] : ui.nav === 'spaces' ? spaces() : ui.nav === 'events' ? events() : ui.nav === 'calendar' ? calendar(tag) : ui.nav === 'members' ? members() : ui.nav === 'docs' ? docs() : ui.nav === 'resources' || ui.nav === 'references' ? scoped(ui.nav) : ui.nav === 'chat' ? chatPage() : ui.nav === 'timeline' ? timeline() : home()
    const main = el('main', { class: 'main' }, [...section, ui.note ? el('p', { class: 'note' }, [ui.note]) : null])
    mainEl.replaceWith(main)
    mainEl = main
    ctx.bus.emit('community-section', { nav: ui.nav, chat: ui.nav === 'chat' })
  }

  adoptLegacyLinks()
  // Wave 42: a community made over MCP or on another device has its tag defined here.
  const adopted = adoptMetaTags(data(), loadColourTags())
  if (adopted !== loadColourTags() && adopted.length !== loadColourTags().length) saveColourTags(adopted as never)
  // Wave 41 (community-mode): the app's Community bottom row opens a section, and learns which one is showing.
  const offGo = ctx.bus.on('community-go', (n) => { if ((NAV as readonly unknown[]).includes(n)) go(n as NavId) })
  draw()
  return () => { offGo(); root.replaceChildren(); box.remove() }
}
