/**
 * The Feed on screen (wave 1733 round B, items 1 and 2): its own tab (Web |
 * Record | Feed | Inventory; Settings > Feed switches it off, and then the bar
 * is exactly as before), the posts (feed.ts), a picture on an item (kept on
 * this phone, image_store.ts), Mastodon and Pixelfed as services
 * (fediverse.ts): a person's address on their sheet, their public posts where
 * switched on, and "Share to..." on an item or post, always the person's tap.
 */
import { el } from '../../demo/src/ui/dom'
import { contextPress } from './context_press'
import { eventTagLabel } from './events'
import { buildFeed, filterFeed, FeedSource, isTimelinePost, PostKind } from './feed'
import type { Post } from './feed'
import { addEmbed, embedPosts, fetchEmbed, parsePostLink } from './feed_embed'
import { followPosts, followText, followUrl, groupPosts, groupsOf, parseFeedText, parseFollow, sourceCounts } from './feed_sources'
import type { FeedItem } from './feed_sources'
import { addSocialPost, editSocialPost, eventFeedOn, sameEventTag, tagOfEvent, toggleStar } from './feed_social'
import { addGroupPosts, buildJoin, buildPost, canPost, channelTag, ensureNostrKey, GOVERNANCE, hopsOf, parseRelay, POST_TYPES, tagIndex, visibleByHops } from './feed_nostr'
import type { Target } from './feed_nostr'
import type { NostrEvent, PostType } from './feed_nostr'
import { publish, readGroups } from './feed_relay'
import { getPublicKey, hexToBytes } from '../../demo/src/nostr_lib'
import { loadColourTags } from './colour_tags'
import { algoOf, filterBySources, FEED_EXTERNAL_PUBLISH_ENABLED, PUBLISH_DEFAULT, PUBLISH_TARGETS, publicReadAllowed, rankPosts, setPublishTarget, SOURCES, sourceIdOf, sourceOn } from './feed_sources_page'   // wave 44 feed-sources
import { createSourcesView } from './feed_sources_view'
import { createExtFeed } from './feed_ext_view'   // wave44c feed-ext
import { isTrusted } from './trust_mode'
import { fetchFeedText, FetchProblem, handleText, safeRemoteUrl, isProblem, lookupAccount, parseHandle, parseInstance, profileUrl, publicStatuses, remotePosts, shareOrder, ShareTarget, shareUrlFor } from './fediverse'
import type { RemoteStatus } from './fediverse'
import { fetchMastodonTag } from './mastodon_tag'
import { MASTODON_DEFAULT_INSTANCE, MASTODON_POST_ENABLED, eventMastodonHost } from './mastodon_default'
import type { ImageStore } from './image_store'
import { shrink } from './image_store'
import { FediverseReach, feedOn } from './model'
import type { AppState, FediverseLink, FeedSettings, InventoryItem, Person, TwEvent } from './model'
import { ageCompact, firstLink, handleOf } from './feed_row'
import { ICONS } from './icons'
import { provenanceChip } from './provenance_view'
import { askPersist } from './storage_persist'
import { S } from './strings'
import { draftable } from './drafts_dom'

export interface FeedViewHooks {
  state: () => AppState
  save: () => void
  openSheet: (children: (Node | null)[]) => void
  closeSheet: () => void
  toast: (msg: string) => void
  images: ImageStore
  avatar: (name: string, id: string) => HTMLElement
  dummyChip: () => HTMLElement
  personSheet: (personId: string) => void
  itemSheet: (itemId: string) => void
  openShare: (receivedId: string) => void
  openMeeting: (meetingId: string) => void
  /** The Feed is on screen: redraw it (remote posts arrived). */
  redrawFeed: () => void
  /** The bottom bar changed (Feed on/off). */
  tabsChanged: () => void
  settings: () => void
  /** Wave 27: an item's Share opens the Share page (share_page_view.ts), not the old "Share to..." sheet. */
  openSharePage: (itemId: string) => void
  /** Wave 43: show the Feed screen (an event's Feed row opens it filtered to the event's tag). */
  openFeed: () => void
  /** wave44c feed-ext: shows an extension module's view ("Open in Phanpy"). */
  openView?: (id: string) => void
}

export interface FeedView {
  /** The Feed screen's body (under the header); 'timeline' (wave 43) is the record of what happened, 'feed' the posts of people. */
  body(mode?: 'feed' | 'timeline'): HTMLElement
  /** Wave 43: an event page's Feed row (null when the event offers none), and opening the Feed filtered to an event. */
  eventRow(ev: TwEvent): HTMLElement | null
  showEvent(eventId: string): void
  settingsGroup(): HTMLElement[]
  /** On a person's sheet: their Mastodon or Pixelfed address, and whether the Feed shows their public posts. */
  personRow(p: Person): HTMLElement
  /** wave44c feed-ext: on a person's card: follow their Bluesky, Threads or web site (Bridgy Fed) in the Feed. */
  personExt(p: Person): HTMLElement
  /** On an item's sheet: its picture, and "Share to...". */
  itemExtras(item: InventoryItem): HTMLElement
  /** An item's picture was removed with the item, or the phone was reset. */
  dropImage(imageId: string): void
}

/** Remote posts are fetched again after this long (in memory only, never stored). */
const REMOTE_TTL_MS = 5 * 60_000
const allowLocal = import.meta.env.DEV

export function createFeedView(h: FeedViewHooks): FeedView {
  const remote = new Map<string, { at: number; statuses: RemoteStatus[] | FetchProblem; accountId?: string }>()
  const fetching = new Set<string>()
  /** Wave 43 answers (zeta): the public hashtag timelines of events that name a Mastodon instance, in memory only. */
  const mastodon = new Map<string, { at: number; posts: Post[] | FetchProblem }>()
  let objectUrls: string[] = []
  const followed_ = new Map<string, { at: number; items: FeedItem[] | FetchProblem }>()
  const chosen: { source?: FeedSource; group?: string; channel?: string; tag?: string } = {}
  const chosenTimeline: { source?: FeedSource; group?: string; channel?: string; tag?: string } = {}
  const inbound = new Map<string, { at: number; posts: Post[] }>()
  const joined = new Set<string>()
  /* wave44 feed-sources: the Sources page, and "Only <source>" (one source id, in memory). */
  /* wave44c feed-ext: followed Bluesky / PeerTube / Threads / Bridgy accounts, their Sources section, Settings > Feed > Extensions. */
  const ext = createExtFeed({ ...h, allowLocal })
  const sourcesPage = createSourcesView({ ...h, extra: () => [ext.sourcesSection()] })
  const onlySource: { id?: string } = {}

  const settings = (): FeedSettings => {
    const s = h.state()
    s.feed = typeof s.feed === 'object' && s.feed !== null ? s.feed : {}
    return s.feed
  }
  const remoteOn = (): boolean => h.state().feed?.remote === true
  const imagesOn = (): boolean => h.state().feed?.images === true

  /**
   * Who the Feed reads from: BOTH switches on (Settings > Feed "Also show posts
   * from", and this person's own), and not known to refuse this page. Nothing is
   * asked of any instance before that (review-app-b): whether it lets this page
   * read it is found out by the first real read, not when the address is typed.
   */
  const followed = (): Person[] => (remoteOn() ? h.state().people.filter((p) => p.fediverse?.show === true && p.fediverse.reach !== FediverseReach.Link) : [])

  /** What the first read found out about the instance, kept with the address (link out only where it refused). */
  function learnReach(link: FediverseLink, found: string | FetchProblem): void {
    const reach = found === FetchProblem.Unreachable ? (link.reach === FediverseReach.Api ? FediverseReach.Api : FediverseReach.Link)
      : isProblem(found) ? link.reach : FediverseReach.Api
    if (reach !== link.reach) {
      if (reach) link.reach = reach; else delete link.reach
      h.save()
    }
  }

  async function refreshRemote(p: Person): Promise<void> {
    const link = p.fediverse
    const handle = link ? parseHandle(link.handle, allowLocal) : null
    if (!link || !handle || fetching.has(link.handle)) return
    fetching.add(link.handle)
    try {
      const known = remote.get(link.handle)
      const id = known?.accountId ?? await lookupAccount(handle, fetch)
      learnReach(link, id)
      const statuses = isProblem(id) ? id : await publicStatuses(handle, id, fetch, allowLocal)
      remote.set(link.handle, { at: Date.now(), statuses, ...(!isProblem(id) && Array.isArray(statuses) ? { accountId: id } : {}) })
    } finally {
      fetching.delete(link.handle)
    }
    h.redrawFeed()
  }

  function remoteFor(): Post[] {
    const out: Post[] = []
    for (const p of followed()) {
      const got = remote.get(p.fediverse?.handle ?? '')
      if (!got || Date.now() - got.at > REMOTE_TTL_MS) void refreshRemote(p)
      if (got && Array.isArray(got.statuses) && p.fediverse) out.push(...remotePosts(p, p.fediverse, got.statuses, imagesOn()))
    }
    return out
  }

  /** The event's tag on its Mastodon instance (only when the host named one and this event's Feed is open); a failed read keeps its reason for the line above the posts. */
  function mastodonFor(ev: TwEvent | undefined): Post[] {
    const host = ev && eventMastodonHost(ev)
    if (!ev || !host) return []
    const slug = tagOfEvent(ev)
    const key = `${host}|${slug}`
    const got = mastodon.get(key)
    if ((!got || Date.now() - got.at > REMOTE_TTL_MS) && !fetching.has(key)) {
      fetching.add(key)
      void fetchMastodonTag(host, slug, fetch, allowLocal).then((posts) => { mastodon.set(key, { at: Date.now(), posts }) }).finally(() => { fetching.delete(key); h.redrawFeed() })
    }
    return got && Array.isArray(got.posts) ? got.posts : []
  }
  const mastodonProblem = (ev: TwEvent | undefined): HTMLElement[] => {
    const host = ev && eventMastodonHost(ev)
    const got = ev && host ? mastodon.get(`${host}|${tagOfEvent(ev)}`) : undefined
    return got && !Array.isArray(got.posts) ? [el('p', { class: 'meta', 'data-mastodon-problem': got.posts }, [S.fedProblem(host!, S.fedProblemText[got.posts])])] : []
  }

  /** Followed accounts / hashtags and the news feed: one public RSS or JSON read each, kept in memory for REMOTE_TTL_MS. Nothing is read before the person added the address. */
  function followSources(): { url: string; label: string; news: boolean }[] {
    const f = h.state().feed
    const news = f?.newsUrl && safeRemoteUrl(f.newsUrl, allowLocal)
    return [
      ...(f?.follows ?? []).flatMap((x) => { const p = parseFollow(x, allowLocal); return p ? [{ url: followUrl(p), label: followText(p), news: false }] : [] }),
      ...(news ? [{ url: news, label: new URL(news).hostname, news: true }] : []),
    ]
  }

  async function refreshFollow(url: string): Promise<void> {
    if (fetching.has(url)) return
    fetching.add(url)
    try {
      const text = await fetchFeedText(url, fetch)
      followed_.set(url, { at: Date.now(), items: isProblem(text) ? text : parseFeedText(text, allowLocal) })
    } finally {
      fetching.delete(url)
    }
    h.redrawFeed()
  }

  function followedPosts(): Post[] {
    return followSources().flatMap((src) => {
      const got = followed_.get(src.url)
      if (!got || Date.now() - got.at > REMOTE_TTL_MS) void refreshFollow(src.url)
      return got && Array.isArray(got.items) ? followPosts(src.label, got.items, src.news) : []
    })
  }

  /** Posts other people sent to my groups through the relays (kept in memory for REMOTE_TTL_MS; nothing is read with no relay set). */
  function relayPosts(groups: readonly { id: string; name: string }[]): Post[] {
    const s = h.state()
    const urls = s.feed?.relays ?? []
    if (!urls.length || !groups.length) return []
    const mine = s.nostrKey ? getPublicKey(hexToBytes(s.nostrKey)) : ''
    const metas = s.feed?.groupMeta ?? {}
    const index = tagIndex(groups, metas)
    const names = new Map(groups.map((g) => [g.id, g.name]))
    return urls.flatMap((url) => {
      const got = inbound.get(url)
      if (!got || Date.now() - got.at > REMOTE_TTL_MS) {
        inbound.set(url, { at: Date.now(), posts: got?.posts ?? [] })
        void readGroups(url, [...index.keys()]).then(({ posts, members }) => {
          const ringOf = new Map(h.state().people.flatMap((p) => (p.nostrPub ? [[p.nostrPub, p.ring] as const] : [])))
          inbound.set(url, { at: Date.now(), posts: posts.filter((f) => f.pubkey !== mine && index.has(f.group) && visibleByHops(f.hops, hopsOf(ringOf.get(f.pubkey)), (members[f.group] ?? []).includes(f.pubkey))).map((f): Post => {
            const t = index.get(f.group)!
            const chan = t.channel ? metas[t.group]?.channels?.find((c) => c.id === t.channel)?.name ?? t.channel : ''
            return { id: `relay:${f.id}`, kind: PostKind.Group, who: f.pubkey.slice(0, 8), at: f.at, text: f.text, context: chan ? `${names.get(t.group)} > ${chan}` : names.get(t.group), group: t.group, channel: t.channel, type: f.type, dummy: false, open: { kind: 'none' } }
          }) })
          h.redrawFeed()
        })
      }
      return got?.posts ?? []
    })
  }

  /** Sends new posts (and, once per group and session, a join) to every relay set; marks them sent where one took them. */
  async function sendOut(posts: readonly { id: string; group: string }[], events: readonly NostrEvent[], urls: readonly string[]): Promise<void> {
    const sk = ensureNostrKey(h.state())
    const fresh = [...new Set(posts.map((p) => p.group))].filter((g) => !joined.has(g))
    fresh.forEach((g) => joined.add(g))
    const out = [...fresh.map((g) => buildJoin(sk, g, Date.now())), ...events]
    const took = (await Promise.all(urls.map((u) => publish(u, out)))).some(Boolean)
    if (!took) { fresh.forEach((g) => joined.delete(g)); h.redrawFeed(); return }
    const ids = new Set(posts.map((p) => p.id))
    for (const gp of h.state().groupPosts ?? []) if (ids.has(gp.id)) gp.sent = true
    h.save(); h.redrawFeed()
  }

  function problems(): HTMLElement[] {
    const follows = followSources().flatMap((src) => {
      const got = followed_.get(src.url)
      return got && !Array.isArray(got.items) ? [el('p', { class: 'meta', 'data-follow-problem': got.items }, [S.fedProblem(src.label, S.fedProblemText[got.items])])] : []
    })
    return [...follows, ...personProblems()]
  }

  function personProblems(): HTMLElement[] {
    return followed().flatMap((p) => {
      const got = remote.get(p.fediverse?.handle ?? '')
      return got && !Array.isArray(got.statuses) ? [el('p', { class: 'meta', 'data-remote-problem': got.statuses }, [S.fedProblem(p.name, S.fedProblemText[got.statuses])])] : []
    })
  }

  function open(post: Post): void {
    const t = post.open
    switch (t.kind) {
      case 'person': h.personSheet(t.personId); return
      case 'item': h.itemSheet(t.itemId); return
      case 'share': h.openShare(t.receivedId); return
      case 'meeting': h.openMeeting(t.meetingId); return
      case 'url': window.open(t.url, '_blank', 'noopener,noreferrer'); return
      case 'none': return
    }
  }

  function imageEl(post: Post): HTMLElement | null {
    if (post.imageUrl) {
      return el('img', { class: 'post-img', src: post.imageUrl, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' })
    }
    if (!post.imageId) return null
    const img = el('img', { class: 'post-img', alt: '', 'data-local-image': post.imageId }) as HTMLImageElement
    void h.images.get(post.imageId).then((b) => {
      if (!b) { img.remove(); return }
      const url = URL.createObjectURL(b)
      objectUrls.push(url)
      img.src = url
    })
    return img
  }

  /** The event a tag (`event_<slug>`) belongs to, on this device. */
  const eventOfTag = (tag?: string): TwEvent | undefined => (tag ? h.state().events?.find((e) => sameEventTag(tagOfEvent(e), tag)) : undefined)
  const tagText = (tag: string): string => { const ev = eventOfTag(tag); return ev ? eventTagLabel(ev.tagName ?? ev.name) : tag }

  /** Event posts also go to the relay the person set, as a post to the event's group (feed_nostr.ts); with none set nothing leaves the phone. */
  function shareToRelay(text: string, eventId: string | undefined): void {
    const s = h.state()
    const urls = s.feed?.relays ?? []
    if (!eventId || !urls.length || !s.events?.some((e) => e.id === eventId && e.attended)) return
    const group = `event:${eventId}`
    void sendOut([{ id: `social:${eventId}`, group }], [buildPost(ensureNostrKey(s), group, text, 'discussion', Date.now())], urls)
  }

  /** Writes a post of mine (on an event's Feed when eventId is set) and redraws; false when there was nothing to post. */
  function writePost(text: string, o: { eventId?: string; replyTo?: string; replyText?: string }): boolean {
    const post = addSocialPost(h.state(), text, Date.now(), o)
    if (!post) return false
    h.save(); h.redrawFeed(); h.toast(S.feedPostedSocial)
    shareToRelay(post.text, post.eventId)
    return true
  }

  /** One icon button of the action row: the label is aria-label + title; `struck` = OFF toggle (struck through, still pressable); `off` = struck through and disabled, never colour alone (P2). */
  function act(icon: string, label: string, attrs: Record<string, string>, onclick: (() => void) | null, o: { on?: boolean; off?: boolean; struck?: boolean } = {}): HTMLElement {
    const b = el('button', { class: 'act' + (o.on ? ' on' : '') + (o.off || o.struck ? ' tw-off' : ''), type: 'button', 'aria-label': label, title: label, ...attrs, ...(o.off ? { disabled: '', 'aria-disabled': 'true' } : {}), ...(onclick && !o.off ? { onclick } : {}) })
    b.innerHTML = ICONS[icon]
    return b
  }

  /** Mastodon-style status row (pattern only): avatar left; name, @handle and a compact age on the head line; text; link card; chips; icon action row. `compact` (an event's Feed row) drops picture, link card and actions. */
  function postEl(post: Post, social: boolean, compact = false): HTMLElement {
    const who = post.who ?? S.feedYou
    const canShare = post.kind === PostKind.Mine || post.kind === PostKind.Remote
    const mineText = post.kind === PostKind.Social
    const starred = (h.state().feedStars ?? []).includes(post.id)
    const handle = handleOf(post)
    const link = compact ? null : firstLink(post.text)
    const originalUrl = post.open.kind === 'url' ? post.open.url : null
    const main = el('button', { class: 'post-main', onclick: () => (mineText ? editSheet(post) : open(post)) }, [
      h.avatar(who, post.personId ?? 'me'),
      el('div', { class: 'post-body' }, [
        post.boostedBy ? el('div', { class: 'meta post-boost', 'data-post-boosted': '1' }, [S.feedLook.boostedBy(post.boostedBy)]) : null,
        el('div', { class: 'post-head' }, [
          el('b', { class: 'post-name' }, [who]),
          handle ? el('span', { class: 'meta post-handle', 'data-post-handle': handle }, [handle]) : null,
          el('span', { class: 'meta post-age' }, [ageCompact(post.at, Date.now())])]),
        el('p', { class: 'post-text' }, [post.text]),
        post.context && !(handle && post.kind === PostKind.Remote) ? el('p', { class: 'meta post-ctx' }, [post.kind === PostKind.Answer ? S.feedAsked(post.context) : post.kind === PostKind.Social ? S.feedReplying(post.context) : post.context]) : null,
        el('div', { class: 'post-tags' }, [
          el('span', { class: 'meta' }, [S.feedKind[post.kind]]),
          post.tag ? el('span', { class: 'chip', 'data-post-tag': post.tag }, [tagText(post.tag)]) : null,
          post.type ? el('span', { class: 'chip', 'data-post-type': post.type }, [S.feedType[post.type] ?? post.type]) : null,
          post.unsent ? el('span', { class: 'meta', 'data-post-unsent': '1' }, [(h.state().feed?.relays ?? []).length ? S.feedNotSent : S.feedNotSentNoRelay]) : null,
          provenanceChip(post.provenance ? { kind: post.provenance } : undefined), post.dummy ? h.dummyChip() : null]),
      ]),
    ])
    if (mineText) contextPress(main, () => editSheet(post))   // wave 43 P1: a long press or right click always edits
    const row = (children: (Node | null)[]): HTMLElement => el('div', { class: 'post-indent' }, children)
    return el('article', { class: 'post post-' + post.kind + (compact ? ' post-compact' : ''), 'data-post': post.id, 'data-post-kind': post.kind }, [
      main,
      compact ? null : row([imageEl(post)]),
      link ? row([el('a', { class: 'post-card', href: link.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': S.feedLook.linkCard(link.domain), 'data-post-link': link.domain }, [link.domain])]) : null,
      compact ? null : row([el('div', { class: 'post-actions' }, [
        social ? act('reply', S.feedReply, { 'data-post-reply': post.id }, () => replySheet(post)) : null,
        act('boost', originalUrl ? S.feedLook.boost : S.feedLook.boostNo, { 'data-post-boost': post.id }, originalUrl ? () => window.open(originalUrl, '_blank', 'noopener,noreferrer') : null, { off: !originalUrl }),
        social ? act('star', starred ? S.feedStarred : S.feedStar, { 'aria-pressed': String(starred), 'data-post-star': post.id }, () => { toggleStar(h.state(), post.id); h.save(); h.redrawFeed() }, { on: starred, struck: !starred }) : null,
        act('share', canShare ? S.shareTo : S.feedLook.shareNo, { 'data-share-post': post.id }, () => shareSheet(post.text, Boolean(post.imageId || post.imageUrl)), { off: !canShare }),
        act('more', S.feedLook.more, { 'data-post-more': post.id }, () => (mineText ? editSheet(post) : open(post))),
      ])]),
    ])
  }

  /** One text sheet: a quote of what it answers (optional), the box, one button. */
  function textSheet(title: string, quote: string | null, ph: string, start: string, button: string, go: (text: string) => boolean, attr: string, draftOf?: string): void {
    const text = el('textarea', { class: 'field', rows: '3', placeholder: ph, 'aria-label': ph, [attr]: '1' }) as HTMLTextAreaElement
    text.value = start
    const box = el('div', {}, [text])
    const kept = draftOf ? draftable(box, 'feed-reply', draftOf) : null   // wave44c event-autosave: a reply is kept until sent
    h.openSheet([el('h3', {}, [title]), quote ? el('blockquote', { class: 'shared-notes' }, [quote.slice(0, 300)]) : null, box,
      el('button', { class: 'btn btn-electric', [`${attr}-send`]: '1', onclick: () => { if (go(text.value)) { kept?.clear(); h.closeSheet() } else text.focus() } }, [button])])
    setTimeout(() => text.focus(), 0)
  }

  function replySheet(post: Post): void {
    textSheet(S.feedReplyTitle, post.text, S.feedReplyPh, '', S.feedComposeSend, (text) => writePost(text, { replyTo: post.id, replyText: post.text, eventId: eventOfTag(post.tag)?.id }), 'data-feed-reply-text', post.id)
  }

  function editSheet(post: Post): void {
    textSheet(S.feedEditTitle, null, S.feedComposePh, post.text, S.feedEditSave, (text) => { if (!editSocialPost(h.state(), post.id.slice('social:'.length), text)) return false; h.save(); h.redrawFeed(); return true }, 'data-feed-edit-text')
  }

  /** Wave 44 feed-sources: where a post goes by default. Only the preference is stored; posting to another network waits for its account link (FEED_EXTERNAL_PUBLISH_ENABLED). */
  function publishTarget(): HTMLElement {
    const T = S.w44sources
    const cur = (): string => settings().publishTarget ?? PUBLISH_DEFAULT
    const note = el('p', { class: 'meta', 'data-feed-target-note': '1' }, [FEED_EXTERNAL_PUBLISH_ENABLED ? '' : T.publishHint])
    const chips = PUBLISH_TARGETS.map((t) => {
      const b = el('button', { class: 'chip' + (cur() === t.id ? ' on' : '') + (t.discouraged ? ' tw-off' : ''), type: 'button', 'aria-pressed': String(cur() === t.id), 'data-feed-target': t.id, onclick: () => {
        setPublishTarget(settings(), t.id); h.save()
        for (const c of chips) { const on = c.dataset.feedTarget === t.id; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)) }
        extra.textContent = t.discouraged ? T.publishOffRamp : ''
      } }, [T.publishName[t.id] + (t.discouraged ? ` (${T.publishDiscouraged})` : '')])
      return b
    })
    const extra = el('p', { class: 'meta', 'data-feed-target-offramp': '1' }, [PUBLISH_TARGETS.find((t) => t.id === cur())?.discouraged ? T.publishOffRamp : ''])
    return el('details', { class: 'feed-target', 'data-feed-target-box': '1' }, [el('summary', {}, [`${T.publishTitle}: ${T.publishName[cur()]}`]), el('div', { class: 'feed-chips', role: 'group', 'aria-label': T.publishTitle }, chips), extra, note])
  }

  /** The box at the top of the Feed: a post of mine, on the event's Feed while one is chosen. */
  function composer(eventId?: string): HTMLElement {
    const text = el('textarea', { class: 'field', rows: '2', placeholder: S.feedComposePh, 'aria-label': S.feedComposePh, 'data-feed-compose': '1' }) as HTMLTextAreaElement
    const embed = el('button', { class: 'btn btn-ghost btn-sm', hidden: true, 'data-feed-embed': '1', onclick: () => { void embedLink(text, embed, () => kept.clear()) } }, [S.feedEmbed.button]) as HTMLButtonElement
    text.addEventListener('input', () => { embed.hidden = !parsePostLink(text.value) })   // a lone link: offer to embed it (wave 44)
    const box = el('div', { class: 'feed-compose' }, [text, embed, el('button', { class: 'btn btn-electric btn-sm', 'data-feed-compose-send': '1', onclick: () => { if (writePost(text.value, { eventId })) { text.value = ''; kept.clear() } else text.focus() } }, [S.feedComposeSend]), publishTarget()])
    const kept = draftable(box, 'feed', eventId ?? 'mine')   // wave44c event-autosave
    return box
  }

  /** Wave 44 feed-embed: the pasted link of one post becomes a post in the Feed; the one GET happens only on this press. */
  /** review-44c: `clearDraft` drops the composer's draft with the text (event-autosave), else the redraw below restores the link. */
  async function embedLink(text: HTMLTextAreaElement, button: HTMLButtonElement, clearDraft: () => void): Promise<void> {
    const link = parsePostLink(text.value)
    if (!link || button.disabled) return
    button.disabled = true
    h.toast(S.feedEmbed.busy)
    const embed = await fetchEmbed(link, fetch)
    button.disabled = false
    if (!addEmbed(h.state(), embed)) { h.toast(S.feedEmbed.already); return }
    text.value = ''; clearDraft(); button.hidden = true
    h.save(); h.redrawFeed(); h.toast(embed.card ? S.feedEmbed.card : S.feedEmbed.done)
  }

  function body(mode: 'feed' | 'timeline' = 'feed'): HTMLElement {
    for (const u of objectUrls) URL.revokeObjectURL(u)
    objectUrls = []
    const timeline = mode === 'timeline'
    const sel = timeline ? chosenTimeline : chosen
    const tags = loadColourTags()
    const groups = groupsOf(h.state(), tags)
    const readPublic = publicReadAllowed(settings())   // wave 44: "Never read public content" fetches nothing
    const all = buildFeed(h.state(), [...(readPublic ? [...remoteFor(), ...mastodonFor(eventOfTag(sel.tag)), ...followedPosts(), ...ext.posts(imagesOn())] : []), ...groupPosts(h.state(), tags), ...relayPosts(groups), ...embedPosts(h.state().feedEmbeds, imagesOn())]).filter((p) => isTimelinePost(p) === timeline)
    if (sel.group && !groups.some((g) => g.id === sel.group)) delete sel.group
    const metas = h.state().feed?.groupMeta ?? {}
    if (sel.channel && !metas[sel.group ?? '']?.channels?.some((c) => c.id === sel.channel)) delete sel.channel
    if (sel.tag && !eventOfTag(sel.tag)) delete sel.tag
    const trustedPost = (p: Post): boolean => (p.personId ? isTrusted(h.state().people.find((x) => x.id === p.personId)) : p.kind === PostKind.Social || p.kind === PostKind.Mine || p.kind === PostKind.Follow)
    const sourceIds = new Set(all.flatMap((p) => sourceIdOf(p) ?? []))
    if (onlySource.id && !sourceIds.has(onlySource.id)) delete onlySource.id
    const shown = filterBySources(filterFeed(all, sel).filter((p) => !sel.channel || p.channel === sel.channel), settings(), trustedPost).filter((p) => !onlySource.id || sourceIdOf(p) === onlySource.id)
    const posts = timeline ? shown : rankPosts(shown, algoOf(settings()), Date.now(), trustedPost)
    const counts = sourceCounts(all)
    const pick = (source?: FeedSource, group?: string, channel?: string): void => { sel.source = source; if (group) sel.group = group; else delete sel.group; if (channel) sel.channel = channel; else delete sel.channel; h.redrawFeed() }
    const chip = (label: string, on: boolean, attrs: Record<string, string>, go: () => void): HTMLElement => el('button', { class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on), ...attrs, onclick: go }, [label])
    const sources = timeline ? [FeedSource.Web, FeedSource.Ask] : [FeedSource.Web, FeedSource.Group, FeedSource.Fediverse, FeedSource.News]
    const tagEvent = eventOfTag(sel.tag)
    return el('div', { class: 'scroll pad feed', 'data-feed-mode': mode }, [
      tagEvent ? el('div', { class: 'feed-chips', 'data-feed-tag': sel.tag ?? '' }, [el('b', {}, [S.feedOnTag(eventTagLabel(tagEvent.tagName ?? tagEvent.name))]), el('button', { class: 'btn btn-ghost btn-sm', 'data-feed-tag-clear': '1', onclick: () => { delete sel.tag; h.redrawFeed() } }, [S.feedTagClear])]) : null,
      timeline ? null : composer(tagEvent?.id),
      el('div', { class: 'feed-chips', role: 'group', 'aria-label': S.feedChipsLabel }, [
        chip(S.feedAll, !sel.source, { 'data-feed-src': 'all' }, () => pick()),
        ...sources.map((src) => chip(`${S.feedSrc[src]} ${counts[src]}`, sel.source === src, { 'data-feed-src': src }, () => pick(sel.source === src ? undefined : src))),
        timeline ? null : el('button', { class: 'btn btn-electric btn-sm', 'data-feed-post': '1', onclick: () => postSheet(groups) }, [S.feedPostGroup]),
        timeline ? null : el('button', { class: 'btn btn-ghost btn-sm', 'data-feed-sources': '1', onclick: () => sourcesPage.open() }, [S.w44sources.open]),
        timeline ? null : ext.phanpyButton(),
      ]),
      timeline || !sourceIds.size ? null : el('div', { class: 'feed-chips', role: 'group', 'aria-label': S.w44sources.onlyLabel }, SOURCES.filter((d) => sourceIds.has(d.id) && sourceOn(settings(), d.id)).map((d) => chip(S.w44sources.only(S.w44sources.name[d.id] ?? d.id), onlySource.id === d.id, { 'data-feed-only': d.id }, () => { if (onlySource.id === d.id) delete onlySource.id; else onlySource.id = d.id; h.redrawFeed() }))),
      sel.source === FeedSource.Group && groups.length
        ? el('div', { class: 'feed-chips', role: 'group', 'aria-label': S.feedGroupsLabel }, groups.flatMap((g) => [
          chip(g.name, sel.group === g.id && !sel.channel, { 'data-feed-group': g.id }, () => pick(FeedSource.Group, sel.group === g.id && !sel.channel ? undefined : g.id)),
          ...(metas[g.id]?.channels ?? []).map((c) => chip(`${g.name} > ${c.name}`, sel.group === g.id && sel.channel === c.id, { 'data-feed-channel-chip': `${g.id}|${c.id}` }, () => pick(FeedSource.Group, g.id, c.id))),
        ]))
        : null,
      sel.source === FeedSource.Group && sel.group
        ? el('p', { class: 'meta', 'data-feed-governance': metas[sel.group]?.governance ?? 'open' }, [S.feedGov[metas[sel.group]?.governance ?? 'open']])
        : null,
      ...problems(),
      ...(timeline ? [] : ext.problems()),
      ...mastodonProblem(tagEvent),
      posts.length
        ? el('div', { class: 'posts' }, posts.map((p) => postEl(p, !timeline)))
        : timeline
          ? el('div', { class: 'empty feed-empty', 'data-feed-empty': '1' }, [el('p', {}, [S.feedEmpty]), el('ul', {}, S.feedEmptyList.map((t) => el('li', {}, [t])))])
          : el('div', { class: 'empty feed-empty', 'data-feed-empty': '1' }, [el('p', {}, [S.feedEmptySocial])]),
      el('p', { class: 'foot' }, [timeline ? S.feedFoot : S.feedFootSocial]),
    ])
  }

  /** An event page's Feed row: a V expander (P3) with the latest posts on the event (the same row, compact) and a way into the Feed; a long press or right click opens the Feed settings (wave 44, 43-D5). */
  function eventRow(ev: TwEvent): HTMLElement | null {
    if (!feedOn(h.state()) || !eventFeedOn(ev)) return null
    const tag = tagOfEvent(ev)
    const panel = el('div', { class: 'event-feed-panel', hidden: true })
    const toggle = el('button', { class: 'btn btn-ghost wide', type: 'button', 'aria-expanded': 'false', 'data-event-feed-toggle': '1' }, [S.feedEventRow + ' ▾'])
    toggle.addEventListener('click', () => {
      const openNow = panel.hidden
      panel.hidden = !openNow
      toggle.setAttribute('aria-expanded', String(openNow))
      toggle.textContent = S.feedEventRow + (openNow ? ' ▴' : ' ▾')
      if (!openNow) return
      const latest = filterFeed(buildFeed(h.state(), groupPosts(h.state(), [])), { tag }).filter((p) => !isTimelinePost(p)).slice(0, 3)
      panel.replaceChildren(
        el('p', { class: 'meta' }, [eventTagLabel(ev.tagName ?? ev.name)]),
        ...(latest.length ? latest.map((p) => el('div', { class: 'post-compact-wrap', 'data-event-feed-post': p.id }, [postEl(p, false, true)])) : [el('p', { class: 'meta' }, [S.feedEventRowEmpty])]),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-event-feed-open': '1', onclick: () => showEvent(ev.id) }, [S.feedEventRowOpen]),
      )
    })
    contextPress(toggle, () => h.openSheet([el('h3', { 'data-event-feed-settings': ev.id }, [S.ev44.feedSettings]), ...settingsGroup()]))   // wave 44 (43-D5 flip): a long press opens the Feed settings, not the Feed
    return el('div', { class: 'event-feed-row', 'data-event-feed': ev.id }, [toggle, panel])
  }

  function showEvent(eventId: string): void {
    const ev = h.state().events?.find((e) => e.id === eventId)
    if (!ev) return
    delete chosen.source; delete chosen.group; delete chosen.channel
    chosen.tag = tagOfEvent(ev)
    h.openFeed()
  }

  /** "Post to <group>": only groups the person is in are offered. */
  function postSheet(groups: readonly { id: string; name: string }[]): void {
    if (!groups.length) { h.openSheet([el('h3', {}, [S.feedPost]), el('p', { class: 'meta', 'data-feed-nogroup': '1' }, [S.feedNoGroup])]); return }
    const metas = h.state().feed?.groupMeta ?? {}
    const key = (t: { group: string; channel?: string }): string => `${t.group}|${t.channel ?? ''}`
    const targets = groups.flatMap((g): { group: string; channel?: string; label: string }[] => [{ group: g.id, label: g.name }, ...(metas[g.id]?.channels ?? []).map((c) => ({ group: g.id, channel: c.id, label: `${g.name} > ${c.name}` }))])
    const first = chosen.group && groups.some((g) => g.id === chosen.group) ? { group: chosen.group, channel: chosen.channel } : { group: groups[0].id, channel: undefined }
    const picked = new Set([key(first)])
    let type: PostType = 'discussion'
    let hops = 0
    const text = el('textarea', { class: 'field', rows: '3', placeholder: S.feedPostPh, 'aria-label': S.feedPostPh, 'data-feed-text': '1' }) as HTMLTextAreaElement
    const textBox = el('div', {}, [text])
    const kept = draftable(textBox, 'feed-group', 'new')   // wave44c event-autosave
    const mark = (b: Element, on: boolean): void => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)) }
    const types = POST_TYPES.map((ty) => el('button', { class: 'chip' + (ty === type ? ' on' : ''), 'aria-pressed': String(ty === type), 'data-feed-type': ty, onclick: () => { type = ty; types.forEach((b, i) => mark(b, POST_TYPES[i] === ty)) } }, [S.feedType[ty]]))
    const hopBtns = [0, 1, 2].map((n) => el('button', { class: 'chip' + (n === hops ? ' on' : ''), 'aria-pressed': String(n === hops), 'data-feed-hops': String(n), onclick: () => { hops = n; hopBtns.forEach((b, i) => mark(b, i === n)) } }, [S.feedHops[n]]))
    const rows = targets.map((t) => el('button', { class: 'radio' + (picked.has(key(t)) ? ' on' : ''), 'aria-pressed': String(picked.has(key(t))), ...(t.channel ? { 'data-feed-channel': key(t) } : { 'data-feed-to': t.group }), onclick: (e: Event) => {
      if (!picked.delete(key(t))) picked.add(key(t))
      mark(e.currentTarget as Element, picked.has(key(t)))
    } }, [el('b', {}, [S.feedPostTo(t.label)]), canPost(metas[t.group]) ? null : el('span', { class: 'meta', 'data-feed-needs-vouch': t.group }, [' · ' + S.feedNeedsVouch])]))
    const send = (): void => {
      const s = h.state()
      const chosenTargets: Target[] = targets.filter((t) => picked.has(key(t))).map((t) => ({ group: t.group, channel: t.channel }))
      const { posts, events } = addGroupPosts(s, chosenTargets, text.value, type, Date.now(), loadColourTags(), ensureNostrKey(s), { hops, meta: metas })
      if (!posts.length) { text.focus(); return }
      kept.clear()   // wave44c event-autosave
      h.save(); h.closeSheet(); chosen.source = FeedSource.Group; chosen.group = posts.length === 1 ? posts[0].group : undefined; if (!chosen.group) delete chosen.group
      delete chosen.channel
      h.redrawFeed(); h.toast(S.feedPosted)
      const urls = s.feed?.relays ?? []
      if (urls.length) void sendOut(posts, events, urls)
    }
    h.openSheet([el('h3', {}, [S.feedPost]), el('div', { class: 'feed-chips', role: 'group', 'aria-label': S.feedTypeLabel }, types), el('p', { class: 'meta' }, [S.feedGroupsPick]), ...rows, el('p', { class: 'meta' }, [S.feedHopsLabel]), el('div', { class: 'feed-chips', role: 'group', 'aria-label': S.feedHopsLabel }, hopBtns), textBox, el('p', { class: 'meta' }, [S.feedPostHint]), el('button', { class: 'btn btn-electric', 'data-feed-send': '1', onclick: send }, [S.feedPostSend])])
    setTimeout(() => text.focus(), 0)
  }

  /** "Share to...": Mastodon (the text prefilled) or Pixelfed (paste), by the post's kind, the person's tap. */
  function shareSheet(text: string, hasImage: boolean): void {
    const f = settings()
    const rows = shareOrder(hasImage).map((target) => {
      const host = target === ShareTarget.Mastodon ? f.myInstance : f.myPixelfed
      const input = el('input', { class: 'field', placeholder: S.shareInstancePh[target], value: host ?? '', 'aria-label': S.shareInstancePh[target], 'data-share-instance': target }) as HTMLInputElement
      const go = (): void => {
        const chosen = parseInstance(input.value, allowLocal)
        if (!chosen) { input.focus(); h.toast(S.shareInstanceBad); return }
        if (target === ShareTarget.Mastodon) f.myInstance = chosen; else f.myPixelfed = chosen
        h.save()
        if (target === ShareTarget.Pixelfed) void navigator.clipboard?.writeText(text).catch(() => {})
        window.open(shareUrlFor(target, chosen, text), '_blank', 'noopener,noreferrer')
        if (target === ShareTarget.Pixelfed) h.toast(S.sharePixelfedPaste)
      }
      return el('div', { class: 'share-row', 'data-share-target': target }, [
        el('b', {}, [S.shareTarget[target]]),
        input,
        el('button', { class: 'btn btn-electric btn-sm', 'data-share-go': target, onclick: go }, [S.shareGo(S.shareTarget[target])]),
        el('p', { class: 'meta' }, [S.shareHint[target]]),
      ])
    })
    h.openSheet([el('h3', {}, [S.shareTo]), el('blockquote', { class: 'shared-notes' }, [text.slice(0, 300)]), ...rows])
  }

  function toggle(label: string, hint: string, on: boolean, attr: string, flip: () => void): HTMLElement {
    return el('button', { class: 'radio' + (on ? ' on' : ''), 'aria-pressed': String(on), [attr]: '1', onclick: flip }, [el('b', {}, [label]), el('small', {}, [hint])])
  }

  function settingsGroup(): HTMLElement[] {
    const s = h.state()
    const on = feedOn(s)
    const textRow = (label: string, ph: string, attr: string, value: string, save: (v: string) => string | null): HTMLElement => {
      const input = el('input', { class: 'field', placeholder: ph, value, 'aria-label': label, autocomplete: 'off', [attr]: '1' }) as HTMLInputElement
      const msg = el('p', { class: 'meta' }, [])
      const go = (): void => { const bad = save(input.value.trim()); if (bad) { msg.textContent = bad; input.focus() } else { h.save(); h.settings() } }
      input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') go() })
      return el('div', {}, [el('label', { class: 'meta' }, [label]), input, msg, el('button', { class: 'btn btn-ghost btn-sm', 'data-save-for': attr, onclick: go }, [S.chSave])])
    }
    const follows = s.feed?.follows ?? []
    return [
      el('h4', { class: 'eyebrow' }, [S.feedTitle]),
      toggle(S.feedToggle, S.feedToggleHint, on, 'data-feed-toggle', () => { settings().on = !on; h.save(); h.tabsChanged(); h.settings() }),
      on ? el('button', { class: 'btn btn-ghost btn-sm', 'data-settings-sources': '1', onclick: () => sourcesPage.open() }, [S.w44sources.open]) : null,
      on ? toggle(S.fedRemote, S.fedRemoteHint, remoteOn(), 'data-feed-remote', () => { settings().remote = !remoteOn(); h.save(); h.settings() }) : null,
      // Wave 43c (zeta): the instance an event Feed reads when the event names none; posting stays off until the TrustWeb account.
      on ? el('p', { class: 'meta', 'data-feed-default-instance': MASTODON_DEFAULT_INSTANCE, ...(MASTODON_POST_ENABLED ? {} : { 'data-feed-post': 'off' }) }, [S.w43connect.mastodonDefault(MASTODON_DEFAULT_INSTANCE), MASTODON_POST_ENABLED ? '.' : `; ${S.w43connect.mastodonPostOff}.`]) : null,
      on ? el('div', { class: 'feed-follows' }, [
        el('h4', { class: 'eyebrow' }, [S.feedFollowTitle]),
        ...follows.map((f) => el('div', { class: 'ch-row', 'data-follow': f }, [el('span', { class: 'ch-name' }, [f]), el('button', { class: 'mini', 'data-follow-remove': f, onclick: () => { settings().follows = follows.filter((x) => x !== f); h.save(); h.settings() } }, [S.imgRemove])])),
        textRow(S.feedFollowLabel, S.feedFollowPh, 'data-follow-input', '', (v) => {
          const p = parseFollow(v, allowLocal)
          if (!p) return S.feedFollowBad
          const text = followText(p)
          if (!follows.includes(text)) settings().follows = [...follows, text]
          return null
        }),
        textRow(S.feedNewsLabel, S.feedNewsPh, 'data-news-input', s.feed?.newsUrl ?? '', (v) => {
          if (!v) { delete settings().newsUrl; return null }
          if (!safeRemoteUrl(v, allowLocal)) return S.feedNewsBad
          settings().newsUrl = v
          return null
        }),
      ]) : null,
      on ? el('div', { class: 'feed-relays' }, [
        el('h4', { class: 'eyebrow' }, [S.feedRelayTitle]),
        ...(s.feed?.relays ?? []).map((r) => el('div', { class: 'ch-row', 'data-relay': r }, [el('span', { class: 'ch-name' }, [r]), el('button', { class: 'mini', 'data-relay-remove': r, onclick: () => { settings().relays = (s.feed?.relays ?? []).filter((x) => x !== r); h.save(); h.settings() } }, [S.imgRemove])])),
        textRow(S.feedRelayLabel, S.feedRelayPh, 'data-feed-relay', '', (v) => {
          if (!v) return null
          const url = parseRelay(v, allowLocal)
          if (!url) return S.feedRelayBad
          const have = s.feed?.relays ?? []
          if (!have.includes(url)) settings().relays = [...have, url]
          return null
        }),
        el('p', { class: 'meta' }, [S.feedRelayHint]),
        el('p', { class: 'meta', 'data-feed-sync-note': '1' }, [S.feedSyncNote]),
      ]) : null,
      on ? el('div', { class: 'feed-groups' }, [el('h4', { class: 'eyebrow' }, [S.feedGroupSetTitle]), ...groupsOf(s, loadColourTags()).map((g) => groupRow(g))]) : null,
      on && remoteOn() ? toggle(S.fedImages, S.fedImagesHint, imagesOn(), 'data-feed-images', () => { settings().images = !imagesOn(); h.save(); h.settings() }) : null,
      ...(on ? ext.settingsRows() : []),
    ].filter((n): n is HTMLElement => n !== null)
  }

  /** Settings > Feed, per group: governance, channels, and whether a member vouched for me. */
  function groupRow(g: { id: string; name: string }): HTMLElement {
    const m = (): NonNullable<NonNullable<ReturnType<typeof settings>['groupMeta']>[string]> => ((settings().groupMeta ??= {})[g.id] ??= {})
    const cur = h.state().feed?.groupMeta?.[g.id]
    const input = el('input', { class: 'field', placeholder: S.feedChannelPh, 'aria-label': S.feedChannelPh, autocomplete: 'off', 'data-feed-channel-input': g.id }) as HTMLInputElement
    const add = (): void => {
      const name = input.value.trim()
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      if (!id) { input.focus(); return }
      const mm = m()
      if (!(mm.channels ?? []).some((c) => c.id === id)) mm.channels = [...(mm.channels ?? []), { id, name }]
      h.save(); h.settings()
    }
    return el('div', { class: 'ch-row feed-group-row', 'data-feed-group-row': g.id }, [
      el('b', {}, [g.name]),
      el('div', { class: 'feed-chips', role: 'group', 'aria-label': S.feedGovLabel }, GOVERNANCE.map((mode) => el('button', { class: 'chip' + ((cur?.governance ?? 'open') === mode ? ' on' : ''), 'aria-pressed': String((cur?.governance ?? 'open') === mode), 'data-feed-gov-set': `${g.id}|${mode}`, onclick: () => { m().governance = mode; h.save(); h.settings() } }, [S.feedGovName[mode]]))),
      cur?.governance === 'vouch' ? el('button', { class: 'chip' + (cur.vouchedBy?.length ? ' on' : ''), 'aria-pressed': String(Boolean(cur.vouchedBy?.length)), 'data-feed-vouched': g.id, onclick: () => { m().vouchedBy = cur.vouchedBy?.length ? [] : ['member'] ; h.save(); h.settings() } }, [S.feedVouched]) : null,
      ...(cur?.channels ?? []).map((c) => el('span', { class: 'meta', 'data-feed-channel-row': channelTag(g.id, c.id) }, [g.name + ' > ' + c.name])),
      input,
      el('button', { class: 'btn btn-ghost btn-sm', 'data-feed-channel-add': g.id, onclick: add }, [S.feedChannelAdd]),
    ])
  }

  function personRow(p: Person): HTMLElement {
    const box = el('div', { class: 'channels fed-row', 'data-fed-row': p.id })
    const draw = (editing: boolean): void => {
      const link = p.fediverse
      if (editing || !link) {
        if (!editing) {
          box.replaceChildren(el('h4', { class: 'eyebrow' }, [S.fedTitle]), el('button', { class: 'btn btn-ghost btn-sm', 'data-fed-add': '1', onclick: () => draw(true) }, ['+ ' + S.fedAdd]))
          return
        }
        const input = el('input', { class: 'field', placeholder: S.fedPh, value: link?.handle ?? '', 'aria-label': S.fedPh, autocomplete: 'off', 'data-fed-input': '1' }) as HTMLInputElement
        const msg = el('p', { class: 'meta' }, [S.fedHint])
        // Kept on this phone only; nothing is asked of their instance here (only the Feed reads, with both switches on).
        const save = (): void => {
          if (!input.value.trim()) { delete p.fediverse; h.save(); draw(false); return }
          const handle = parseHandle(input.value, allowLocal)
          if (!handle) { msg.textContent = S.fedBad; input.focus(); return }
          // Saving again is also "try again": what the instance allows is found out afresh by the next read.
          const text = handleText(handle)
          p.fediverse = { handle: text, show: p.fediverse?.show ?? false }
          remote.delete(text)
          h.save()
          draw(false)
        }
        input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') save() })
        box.replaceChildren(el('h4', { class: 'eyebrow' }, [S.fedTitle]), input, msg, el('div', { class: 'rec-saves' }, [
          el('button', { class: 'btn btn-electric btn-sm', 'data-fed-save': '1', onclick: save }, [S.chSave]),
          el('button', { class: 'btn btn-ghost btn-sm', onclick: () => draw(false) }, [S.chCancel]),
        ]))
        setTimeout(() => input.focus(), 0)
        return
      }
      const handle = parseHandle(link.handle, allowLocal)
      box.replaceChildren(
        el('h4', { class: 'eyebrow' }, [S.fedTitle]),
        el('div', { class: 'ch-row' }, [
          el('span', { class: 'ch-name' }, [link.handle]),
          handle ? el('a', { class: 'ch-open', href: profileUrl(handle), target: '_blank', rel: 'noopener noreferrer' }, [S.fedOpen]) : null,
          el('button', { class: 'mini', onclick: () => draw(true) }, [S.chEditShort]),
        ]),
        link.reach !== FediverseReach.Link
          ? toggle(S.fedShow(p.name), remoteOn() ? S.fedShowHint : S.fedShowHintOff, link.show, 'data-fed-show', () => { link.show = !link.show; h.save(); draw(false) })
          : el('p', { class: 'meta', 'data-fed-reach': 'link' }, [S.fedLinkOnly]),
      )
    }
    draw(false)
    return box
  }

  function itemExtras(item: InventoryItem): HTMLElement {
    const box = el('div', { class: 'item-extras' })
    const input = el('input', { type: 'file', accept: 'image/*', hidden: true, 'data-item-image-file': '1' }) as HTMLInputElement
    const draw = (): void => {
      const img = item.imageId ? el('img', { class: 'post-img', alt: '', 'data-item-image': item.imageId }) as HTMLImageElement : null
      if (img && item.imageId) void h.images.get(item.imageId).then((b) => { if (b) { const u = URL.createObjectURL(b); img.src = u; img.onload = () => URL.revokeObjectURL(u) } else img.remove() })
      box.replaceChildren(
        ...(img ? [input, img] : [input]),
        el('div', { class: 'rec-saves' }, [
          el('button', { class: 'btn btn-ghost btn-sm', 'data-item-image-add': '1', onclick: () => input.click() }, [item.imageId ? S.imgChange : S.imgAdd]),
          item.imageId ? el('button', { class: 'btn btn-ghost btn-sm', 'data-item-image-remove': '1', onclick: () => { const id = item.imageId; delete item.imageId; h.save(); if (id) void h.images.remove(id); draw() } }, [S.imgRemove]) : null,
          el('button', { class: 'btn btn-ghost btn-sm', 'data-share-item': item.id, onclick: () => h.openSharePage(item.id) }, [S.shareTo]),
        ]),
        el('p', { class: 'meta' }, [S.imgHint]),
      )
    }
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      input.value = ''
      if (!file) return
      void (async (): Promise<void> => {
        try {
          const small = await shrink(file)
          const id = item.imageId ?? `img-${item.id}-${Date.now().toString(36)}`
          const gone = await h.images.put(id, small)
          for (const s of h.state().inventory) if (s.imageId && gone.includes(s.imageId)) delete s.imageId
          item.imageId = id
          h.save()
          void askPersist()
          draw()
        } catch {
          h.toast(S.imgFailed)
        }
      })()
    })
    draw()
    return box
  }

  return { body, eventRow, showEvent, settingsGroup, personRow, personExt: ext.personRow, itemExtras, dropImage: (id) => { void h.images.remove(id) } }
}
