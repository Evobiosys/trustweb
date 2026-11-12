// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 feed-events: the Feed view, drawn inside its own shadow root (own TypeScript; only the layout idea of a Mastodon timeline is
 * borrowed: composer on top, one column of post cards). Phone first, one column up to 600 px wide. Every listener sits on an element of
 * the shadow root, so unmounting leaves none behind. Talks to the app only through TwCtx.
 * Link cards come from the address alone. Only when the user switched "preview through my host" on, GET /api/preview?url=… on the TrustWeb
 * host is asked for a title (that endpoint is not deployed yet: a failed request keeps the address-only card, with a note).
 */
import { el } from '../../../../demo/src/ui/dom'
import { loadColourTags } from '../../colour_tags'
import type { AppState } from '../../model'
import { Ring } from '../../model'
import type { TwCtx } from '../tw_registry'
import communityCss from '../community-mighty/community.css?inline'
import css from './feed.css?inline'
import { MODULE_ID, ZONES_OFFERED, buildTimeline, composePost, firstLink, linkCard, parseFeed, parsePreview, type FeedData, type LinkCard, type TimelineItem } from './feed_model'

export const readFeed = (s: AppState): FeedData => parseFeed(s.extData?.[MODULE_ID])

export function writeFeed(ctx: TwCtx, d: FeedData): void {
  const s = ctx.store()
  s.extData = { ...s.extData, [MODULE_ID]: d }
  ctx.bus.emit('save')
}

const when = (ms: number): string => (ms > 0 ? new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

export function mountFeed(hostEl: HTMLElement, ctx: TwCtx): () => void {
  const t = ctx.strings.feedView
  const box = el('div', { class: 'feed-host', 'data-feed': '' })
  hostEl.append(box)
  const root = box.attachShadow({ mode: 'open' })
  const ui: { zone: string; draft: string; note: string } = { zone: `ring:${Ring.Close}`, draft: '', note: '' }
  /** Titles the host gave for links (per mount; a failed request is remembered as '' so it is not repeated). */
  const previews = new Map<string, string>()

  const st = (): AppState => ctx.store()
  const zoneLabel = (zone: string): string => {
    if (zone.startsWith('tag:')) { const id = zone.slice(4); return t.tagOpt(loadColourTags().find((x) => x.id === id)?.label ?? id) }
    return ctx.strings.ringLabel[zone.slice(5) as Ring] ?? zone
  }

  function askPreview(url: string): void {
    if (previews.has(url)) return
    previews.set(url, '')
    void fetch(`/api/preview?url=${encodeURIComponent(url)}`, { credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { const p = parsePreview(j); if (p) { previews.set(url, p.title); draw() } else { ui.note = t.previewUnavailable; draw() } })
      .catch(() => { ui.note = t.previewUnavailable; draw() })
  }

  /** `ask` false: the composer's own card (a half-typed or never posted address does not go to the host; review wave 40). */
  function card(c: LinkCard, repost?: () => void, ask = true): HTMLElement {
    const title = previews.get(c.href) || c.title
    if (ask && readFeed(st()).preview) askPreview(c.href)
    return el('div', { class: 'linkcard', 'data-feed-linkcard': c.platform ?? c.host }, [
      el('span', { class: 'plat' }, [c.platform ? t.platformFrom(c.platform) : c.host]),
      el('a', { href: c.href, target: '_blank', rel: 'noopener noreferrer' }, [title]),
      el('span', { class: 'meta' }, [c.platform ? `${c.host}` : '']),
      repost ? el('div', { class: 'row' }, [
        el('button', { class: 'lnk', type: 'button', 'data-feed-repost': '', onclick: repost }, [t.repost]),
        el('a', { href: c.href, target: '_blank', rel: 'noopener noreferrer' }, [t.openOriginal]),
      ]) : null,
    ])
  }

  const composeBox = el('div', { class: 'card compose', 'data-feed-compose-box': '' })
  const list = el('div', { class: 'timeline', 'data-feed-list': '' })

  function drawComposer(): void {
    const text = el('textarea', { rows: 3, placeholder: t.composePh, 'aria-label': t.composePh, 'data-feed-compose': '' }) as HTMLTextAreaElement
    text.value = ui.draft
    const preview = el('div', { 'data-feed-compose-preview': '' })
    const showPreview = (): void => {
      const url = firstLink(text.value)
      const c = url ? linkCard(url) : null
      preview.replaceChildren(...(c ? [card(c, undefined, false)] : []))
    }
    text.addEventListener('input', () => { ui.draft = text.value; showPreview() })
    showPreview()
    const zones = ZONES_OFFERED(loadColourTags())
    const to = el('select', { 'aria-label': t.who, 'data-feed-zone': '', onchange: (e: Event) => { ui.zone = (e.target as HTMLSelectElement).value } },
      zones.map((z) => el('option', { value: z, ...(z === ui.zone ? { selected: '' } : {}) }, [zoneLabel(z)])))
    const post = (): void => {
      const d = readFeed(st())
      const how = composePost(st(), d, { text: text.value, zone: to.value }, loadColourTags(), Date.now())
      if (!how) return
      ui.draft = ''
      ui.note = ''
      writeFeed(ctx, d)
      draw()
    }
    composeBox.replaceChildren(text, preview, el('div', { class: 'opts' }, [
      el('label', { class: 'meta' }, [t.who, ' ', to]),
      el('button', { class: 'lnk strong', type: 'button', 'data-feed-post': '', onclick: post }, [t.post]),
    ]), ...(ui.note ? [el('p', { class: 'note' }, [ui.note])] : []))
  }

  function postCard(p: TimelineItem): HTMLElement {
    const s = st()
    const who = p.who ?? t.you
    const person = p.personId ? s.people.find((x) => x.id === p.personId) : undefined
    const name = p.personId ? el('button', { class: 'lnk', type: 'button', 'data-feed-person': p.personId, onclick: () => ctx.bus.emit('open-person', p.personId) }, [who]) : el('b', {}, [who])
    return el('article', { class: 'card post', 'data-feed-postid': p.id }, [
      el('div', { class: 'post-head' }, [
        el('span', { class: 'ava', 'aria-hidden': 'true' }, [(who.trim()[0] ?? '?').toUpperCase()]),
        el('div', {}, [
          el('div', { class: 'post-who' }, [name, person ? el('span', { class: 'chip ring', 'data-feed-ring': person.ring }, [ctx.strings.peopleZone[person.ring] ?? person.ring]) : null]),
          el('div', { class: 'meta' }, [when(p.at)]),
        ]),
      ]),
      el('p', { class: 'post-text' }, [p.text]),
      p.link ? card(p.link, () => { ui.draft = p.link!.href; drawComposer(); composeBox.querySelector('textarea')?.focus() }) : null,
      el('div', { class: 'row wrap' }, [
        p.audience ? el('span', { class: 'chip', 'data-feed-audience': p.zone ?? '' }, [p.audience]) : null,
        p.unsent ? el('span', { class: 'meta' }, [t.onlyHere]) : null,
      ]),
    ])
  }

  function drawList(): void {
    const items = buildTimeline(st(), readFeed(st()), loadColourTags(), zoneLabel)
    list.replaceChildren(...(items.length ? items.map(postCard) : [el('p', { class: 'empty' }, [t.empty])]))
  }

  function draw(): void {
    // The composer is rebuilt only when asked to (a redraw while typing would drop the caret); the note is shown by the composer.
    drawList()
    if (ui.note !== (composeBox.querySelector('.note')?.textContent ?? '')) drawComposer()
  }

  const bar = el('div', { class: 'bar' }, [el('h3', { class: 'section' }, [t.viewTitle, ' ', el('sub', { class: 'alpha', 'data-feed-alpha': '' }, [ctx.strings.alphaLabel])])])
  root.append(el('style', {}, [communityCss + css]), el('div', { class: 'cm' }, [bar, el('main', { class: 'main' }, [composeBox, list])]))
  drawComposer()
  draw()
  return () => { root.replaceChildren(); box.remove() }
}
