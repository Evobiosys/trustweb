/**
 * The Feed on screen (wave 1733 round B, items 1 and 2): its own tab (Web |
 * Record | Feed | Inventory; Settings > Feed switches it off, and then the bar
 * is exactly as before), the posts (feed.ts), a picture on an item (kept on
 * this phone, image_store.ts), Mastodon and Pixelfed as services
 * (fediverse.ts): a person's address on their sheet, their public posts where
 * switched on, and "Share to..." on an item or post, always the person's tap.
 */
import { el } from '../../demo/src/ui/dom'
import { buildFeed, PostKind } from './feed'
import type { Post } from './feed'
import { FetchProblem, handleText, lookupAccount, parseHandle, parseInstance, profileUrl, publicStatuses, remotePosts, shareOrder, ShareTarget, shareUrlFor } from './fediverse'
import type { RemoteStatus } from './fediverse'
import type { ImageStore } from './image_store'
import { shrink } from './image_store'
import { ageLabel, FediverseReach, feedOn } from './model'
import type { AppState, FeedSettings, InventoryItem, Person } from './model'
import { provenanceChip } from './provenance_view'
import { askPersist } from './storage_persist'
import { S } from './strings'

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
}

export interface FeedView {
  /** The Feed screen's body (under the header). */
  body(): HTMLElement
  settingsGroup(): HTMLElement[]
  /** On a person's sheet: their Mastodon or Pixelfed address, and whether the Feed shows their public posts. */
  personRow(p: Person): HTMLElement
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
  let objectUrls: string[] = []

  const settings = (): FeedSettings => {
    const s = h.state()
    s.feed = typeof s.feed === 'object' && s.feed !== null ? s.feed : {}
    return s.feed
  }
  const remoteOn = (): boolean => h.state().feed?.remote === true
  const imagesOn = (): boolean => h.state().feed?.images === true

  /** Who the Feed reads from: people with an address, shown, reachable, and the switch on. */
  const followed = (): Person[] => (remoteOn() ? h.state().people.filter((p) => p.fediverse?.show && p.fediverse.reach === FediverseReach.Api) : [])

  async function refreshRemote(p: Person): Promise<void> {
    const link = p.fediverse
    const handle = link ? parseHandle(link.handle, allowLocal) : null
    if (!link || !handle || fetching.has(link.handle)) return
    fetching.add(link.handle)
    try {
      const known = remote.get(link.handle)
      const id = known?.accountId ?? await lookupAccount(handle, fetch)
      const statuses = typeof id === 'string' && !(Object.values(FetchProblem) as string[]).includes(id) ? await publicStatuses(handle, id, fetch) : id as FetchProblem
      remote.set(link.handle, { at: Date.now(), statuses, ...(typeof id === 'string' && Array.isArray(statuses) ? { accountId: id } : {}) })
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

  function problems(): HTMLElement[] {
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
      return el('img', { class: 'post-img', src: post.imageUrl, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
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

  function postEl(post: Post): HTMLElement {
    const who = post.who ?? S.feedYou
    const canShare = post.kind === PostKind.Mine || post.kind === PostKind.Remote
    return el('article', { class: 'post post-' + post.kind, 'data-post': post.id, 'data-post-kind': post.kind }, [
      el('button', { class: 'post-main', onclick: () => open(post) }, [
        h.avatar(who, post.personId ?? 'me'),
        el('div', { class: 'post-body' }, [
          el('div', { class: 'post-head' }, [el('b', {}, [who]), el('span', { class: 'meta' }, [S.feedKind[post.kind] + ' · ' + ageLabel(post.at, Date.now())])]),
          el('p', { class: 'post-text' }, [post.text]),
          post.context ? el('p', { class: 'meta post-ctx' }, [post.kind === PostKind.Answer ? S.feedAsked(post.context) : post.context]) : null,
          el('div', { class: 'post-tags' }, [provenanceChip(post.provenance ? { kind: post.provenance } : undefined), post.dummy ? h.dummyChip() : null]),
        ]),
      ]),
      imageEl(post),
      canShare ? el('button', { class: 'btn btn-ghost btn-sm', 'data-share-post': post.id, onclick: () => shareSheet(post.text, Boolean(post.imageId || post.imageUrl)) }, [S.shareTo]) : null,
    ])
  }

  function body(): HTMLElement {
    for (const u of objectUrls) URL.revokeObjectURL(u)
    objectUrls = []
    const posts = buildFeed(h.state(), remoteFor())
    return el('div', { class: 'scroll pad feed' }, [
      ...problems(),
      posts.length
        ? el('div', { class: 'posts' }, posts.map(postEl))
        : el('div', { class: 'empty feed-empty', 'data-feed-empty': '1' }, [el('p', {}, [S.feedEmpty]), el('ul', {}, S.feedEmptyList.map((t) => el('li', {}, [t])))]),
      el('p', { class: 'foot' }, [S.feedFoot]),
    ])
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
    return [
      el('h4', { class: 'eyebrow' }, [S.feedTitle]),
      toggle(S.feedToggle, S.feedToggleHint, on, 'data-feed-toggle', () => { settings().on = !on; h.save(); h.tabsChanged(); h.settings() }),
      on ? toggle(S.fedRemote, S.fedRemoteHint, remoteOn(), 'data-feed-remote', () => { settings().remote = !remoteOn(); h.save(); h.settings() }) : null,
      on && remoteOn() ? toggle(S.fedImages, S.fedImagesHint, imagesOn(), 'data-feed-images', () => { settings().images = !imagesOn(); h.save(); h.settings() }) : null,
    ].filter((n): n is HTMLElement => n !== null)
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
        const save = async (): Promise<void> => {
          if (!input.value.trim()) { delete p.fediverse; h.save(); draw(false); return }
          const handle = parseHandle(input.value, allowLocal)
          if (!handle) { msg.textContent = S.fedBad; input.focus(); return }
          msg.textContent = S.fedChecking
          // Found out once, now: does their instance let this page read it? Else only a link out.
          const id = await lookupAccount(handle, fetch)
          const reach = id === FetchProblem.Unreachable || id === FetchProblem.RateLimited ? FediverseReach.Link : id === FetchProblem.NotFound || id === FetchProblem.Malformed ? null : FediverseReach.Api
          if (reach === null) { msg.textContent = S.fedNotFound; return }
          p.fediverse = { handle: handleText(handle), show: p.fediverse?.show ?? false, reach }
          h.save()
          draw(false)
        }
        input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') void save() })
        box.replaceChildren(el('h4', { class: 'eyebrow' }, [S.fedTitle]), input, msg, el('div', { class: 'rec-saves' }, [
          el('button', { class: 'btn btn-electric btn-sm', 'data-fed-save': '1', onclick: () => void save() }, [S.chSave]),
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
        link.reach === FediverseReach.Api
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
          el('button', { class: 'btn btn-ghost btn-sm', 'data-share-item': item.id, onclick: () => shareSheet(item.text, Boolean(item.imageId)) }, [S.shareTo]),
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

  return { body, settingsGroup, personRow, itemExtras, dropImage: (id) => { void h.images.remove(id) } }
}
