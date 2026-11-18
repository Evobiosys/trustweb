// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c feed-ext (Jakob θ ι κ): the Feed's part of the extensions. Followed Bluesky / PeerTube / Threads / Bridgy Fed accounts (read only when
 * the Feed opens or Refresh is pressed, kept in memory, never stored), their section on the Sources page, "Follow via Bridgy Fed" on a
 * person's card, Settings > Feed > Extensions (Phanpy, Bridgy Fed + Threads, the Meta import row that waits for Meta's approval) and
 * "Open in Phanpy". The model is feed_ext_sources.ts; feed_view.ts mounts these pieces.
 */
import { el } from '../../demo/src/ui/dom'
import { isEnabled, setEnabled } from './ext/registry'
import { BRIDGES_MODULE_ID as BRIDGES_ID, BRIDGY_DOCS_URL, META_PORTABILITY_ENABLED } from './ext/bridges/bridges_model'
import { MODULE_ID as PHANPY_ID, phanpyUrl, setPhanpyUrl } from './ext/phanpy/phanpy_model'
import type { Post } from './feed'
import { addExtFollow, due, EXT_KINDS, extFeedPosts, extKey, extSourceId, parseExtFollow, readExt, removeExtFollow } from './feed_ext_sources'
import type { ExtCfg, ExtFollow, ExtItem, ExtKind } from './feed_ext_sources'
import { publicReadAllowed, sourceOn } from './feed_sources_page'
import type { RemoteProblem } from './remote_read'
import type { AppState, Person } from './model'
import { S } from './strings'

export interface ExtFeedHooks {
  state: () => AppState
  save: () => void
  toast: (msg: string) => void
  redrawFeed: () => void
  /** Settings changed: redraw the Settings sheet. */
  settings: () => void
  /** A module was switched: the bottom bar and the screen redraw. */
  tabsChanged: () => void
  /** Shows an extension module's view (main.ts openExtView). */
  openView?: (id: string) => void
  allowLocal: boolean
}

const T = S.feedExt
const nodes = (...n: (Node | null)[]): Node[] => n.filter((x): x is Node => x !== null)
const BRIDGE_KINDS: readonly ExtKind[] = ['threads', 'bridgy']
/** On a person's card: their Bluesky handle, their Threads account, or their web site through Bridgy Fed. */
const PERSON_KINDS: readonly ExtKind[] = ['bluesky', 'threads', 'bridgy']

export function createExtFeed(h: ExtFeedHooks) {
  const cache = new Map<string, { at: number; items?: ExtItem[]; problem?: RemoteProblem }>()
  const reading = new Set<string>()
  const ui: { kind: ExtKind } = { kind: 'bluesky' }

  const cfg = (): ExtCfg => {
    const s = h.state()
    s.feed = typeof s.feed === 'object' && s.feed !== null ? s.feed : {}
    return s.feed
  }
  const bridgesOn = (): boolean => isEnabled(BRIDGES_ID)
  const kinds = (): ExtKind[] => EXT_KINDS.filter((k) => bridgesOn() || !BRIDGE_KINDS.includes(k))
  const follows = (): ExtFollow[] => (cfg().extFollows ?? []).filter((f) => kinds().includes(f.kind))
  const readable = (f: ExtFollow): boolean => publicReadAllowed(cfg()) && sourceOn(cfg(), extSourceId(f))
  const sourceName = (f: ExtFollow): string => S.w44sources.name[extSourceId(f)] ?? extSourceId(f)

  /** One read of one follow, when due (see feed_ext_sources.ts due); the Feed redraws when it is back. */
  async function read(f: ExtFollow, explicit: boolean): Promise<void> {
    const key = extKey(f)
    if (!readable(f) || reading.has(key) || !due(cache.get(key), Date.now(), explicit)) return
    reading.add(key)
    try {
      const got = await readExt(f, fetch, h.allowLocal)
      cache.set(key, typeof got === 'string' ? { at: Date.now(), problem: got, items: cache.get(key)?.items } : { at: Date.now(), items: got })
    } finally {
      reading.delete(key)
      h.redrawFeed()
    }
  }

  /** The followed accounts' posts for the Feed; opening the Feed reads what is due. */
  function posts(withImages: boolean): Post[] {
    const entries = follows().filter(readable).map((f) => { void read(f, false); return { follow: f, items: cache.get(extKey(f))?.items ?? [] } })
    return extFeedPosts(entries, withImages)
  }

  function problems(): HTMLElement[] {
    return follows().flatMap((f) => {
      const p = readable(f) ? cache.get(extKey(f))?.problem : undefined
      return p ? [el('p', { class: 'meta', 'data-ext-problem': p }, [T.problem(f.handle, T.problemText[p])])] : []
    })
  }

  const refresh = (only?: string): Promise<void> => Promise.all(follows().filter((f) => !only || extKey(f) === only).map((f) => read(f, true))).then(() => undefined)

  function add(kind: ExtKind, input: HTMLInputElement, msg: HTMLElement, personId?: string): boolean {
    const f = parseExtFollow(kind, input.value, h.allowLocal)
    if (!f) { msg.textContent = T.bad(T.kind[kind]); input.focus(); return false }
    if (!addExtFollow(cfg(), personId ? { ...f, personId } : f)) { msg.textContent = T.already; return false }
    h.save(); h.toast(T.added(f.handle)); h.redrawFeed()
    return true
  }

  const kindChips = (list: readonly ExtKind[], on: ExtKind, pick: (k: ExtKind) => void): HTMLElement => el('div', { class: 'feed-chips', role: 'group', 'aria-label': T.followTitle }, list.map((k) =>
    el('button', { class: 'chip' + (k === on ? ' on' : ''), type: 'button', 'aria-pressed': String(k === on), 'data-ext-kind': k, onclick: () => pick(k) }, [T.kind[k]])))

  const kindNote = (k: ExtKind): HTMLElement | null => (k === 'bridgy'
    ? el('p', { class: 'meta src-opt', 'data-ext-bridgy-note': '1' }, [T.bridgyNote, ' ', el('a', { href: BRIDGY_DOCS_URL, target: '_blank', rel: 'noopener noreferrer' }, [T.bridgyDocs])])
    : k === 'threads' ? el('p', { class: 'meta src-opt', 'data-ext-threads-note': '1' }, [T.threadsNote]) : null)

  function copyButton(text: string): HTMLElement {
    const b = el('button', { class: 'mini', type: 'button', 'data-ext-copy': text, onclick: () => { void navigator.clipboard?.writeText(text).then(() => h.toast(T.copied), () => {}) } }, [T.copy])
    return b
  }

  /** "Open in Phanpy": a Feed source while the Phanpy extension is on. */
  function phanpyButton(): HTMLElement | null {
    if (!isEnabled(PHANPY_ID) || !h.openView) return null
    const open = h.openView
    return el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-feed-open-phanpy': '1', onclick: () => open(PHANPY_ID) }, [T.openPhanpy])
  }

  /** The Sources page section: the followed accounts (Refresh, Remove), and a new follow. Redraws itself. */
  function sourcesSection(): HTMLElement {
    const box = el('div', { class: 'ext-follows', 'data-ext-follows': '1' })
    const draw = (): void => {
      if (!kinds().includes(ui.kind)) ui.kind = 'bluesky'
      const input = el('input', { class: 'field', placeholder: T.ph[ui.kind], 'aria-label': T.inputAria, autocomplete: 'off', 'data-ext-input': '1' }) as HTMLInputElement
      const msg = el('p', { class: 'meta', 'aria-live': 'polite' }, [])
      const go = (): void => { if (add(ui.kind, input, msg)) draw() }
      input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') go() })
      const status = (f: ExtFollow): string => (!publicReadAllowed(cfg()) ? T.noPublic : !sourceOn(cfg(), extSourceId(f)) ? T.sourceOff(sourceName(f)) : '')
      box.replaceChildren(...nodes(
        el('h4', { class: 'eyebrow', 'data-sources-section': 'ext' }, [T.followTitle]),
        el('p', { class: 'meta' }, [T.followHint]),
        phanpyButton(),
        ...follows().map((f) => el('div', { class: 'ch-row', 'data-ext-follow': extKey(f) }, [
          el('span', { class: 'ch-name' }, [`${T.kind[f.kind]}: ${f.handle}`]),
          status(f) ? el('small', { class: 'meta' }, [status(f)]) : null,
          f.kind === 'bridgy' ? copyButton(f.handle) : null,
          el('button', { class: 'mini', type: 'button', 'data-ext-refresh': extKey(f), onclick: () => { h.toast(T.refreshing); void refresh(extKey(f)) } }, [T.refresh]),
          el('button', { class: 'mini', type: 'button', 'data-ext-remove': extKey(f), onclick: () => { removeExtFollow(cfg(), extKey(f)); cache.delete(extKey(f)); h.save(); h.redrawFeed(); draw() } }, [T.remove]),
        ])),
        follows().length > 1 ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-ext-refresh-all': '1', onclick: () => { h.toast(T.refreshing); void refresh() } }, [T.refreshAll]) : null,
        kindChips(kinds(), ui.kind, (k) => { ui.kind = k; draw() }),
        kindNote(ui.kind),
        input, msg,
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-ext-add': '1', onclick: go }, [T.add]),
      ))
    }
    draw()
    return box
  }

  /** On a person's card: follow their Bluesky, Threads or (via Bridgy Fed) web site in the Feed; behind a quiet button (P3). */
  function personRow(p: Person): HTMLElement {
    const box = el('div', { class: 'channels ext-person', 'data-ext-person': p.id })
    const mine = (): ExtFollow[] => follows().filter((f) => f.personId === p.id)
    const draw = (open: boolean, kind: ExtKind): void => {
      const list = mine().map((f) => el('div', { class: 'ch-row', 'data-ext-person-follow': extKey(f) }, [el('span', { class: 'ch-name' }, [`${T.kind[f.kind]}: ${f.handle}`]), f.kind === 'bridgy' ? copyButton(f.handle) : null]))
      if (!open) {
        box.replaceChildren(...list, el('button', { class: 'btn btn-ghost btn-sm src-opt', type: 'button', 'data-ext-person-open': '1', onclick: () => draw(true, kind) }, ['+ ' + T.personTitle]))
        return
      }
      const avail = PERSON_KINDS.filter((k) => kinds().includes(k))
      const input = el('input', { class: 'field', placeholder: T.ph[kind], 'aria-label': T.inputAria, autocomplete: 'off', 'data-ext-person-input': '1', value: kind === 'bridgy' ? site : '' }) as HTMLInputElement
      const msg = el('p', { class: 'meta', 'aria-live': 'polite' }, [])
      const go = (): void => { if (add(kind, input, msg, p.id)) draw(false, kind) }
      box.replaceChildren(...nodes(
        el('h4', { class: 'eyebrow' }, [T.personTitle]), ...list,
        kindChips(avail, kind, (k) => draw(true, k)), kindNote(kind), input, msg,
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-ext-person-add': '1', onclick: go }, [kind === 'bridgy' ? T.personBridgy : T.personAdd]),
      ))
    }
    // A web site they shared with me (their profile) is offered through Bridgy Fed at once.
    const site = typeof p.theirProfile?.website === 'string' && /^https?:\/\//.test(p.theirProfile.website) && kinds().includes('bridgy') ? p.theirProfile.website : ''
    draw(false, site ? 'bridgy' : 'bluesky')
    return box
  }

  const switchRow = (label: string, hint: string, on: boolean, attr: string, flip: (() => void) | null): HTMLElement =>
    el('button', { class: 'radio' + (on ? ' on' : ' tw-off'), type: 'button', 'aria-pressed': String(on), [attr]: '1', ...(flip ? { onclick: flip } : { disabled: true, 'aria-disabled': 'true' }) }, [el('b', {}, [label]), el('small', {}, [hint])])

  /** Settings > Feed > Extensions. */
  function settingsRows(): HTMLElement[] {
    const flip = (id: string): (() => void) => () => { void setEnabled(id, !isEnabled(id)).then(() => { h.save(); h.tabsChanged(); h.settings() }) }
    const phanpyOn = isEnabled(PHANPY_ID)
    let url: HTMLElement | null = null
    if (phanpyOn) {
      const input = el('input', { class: 'field src-opt', placeholder: phanpyUrl({}), value: phanpyUrl(h.state()), 'aria-label': T.phanpyUrl, autocomplete: 'off', 'data-phanpy-url': '1' }) as HTMLInputElement
      const msg = el('p', { class: 'meta' }, [T.phanpyUrlHint])
      const go = (): void => { try { input.value = setPhanpyUrl(h.state(), input.value, location.origin); msg.textContent = T.phanpyUrlHint; h.save() } catch { msg.textContent = T.phanpyBad } }
      input.addEventListener('change', go)
      url = el('div', { class: 'ext-phanpy-url' }, [el('label', { class: 'meta' }, [T.phanpyUrl]), input, msg])
    }
    return [
      el('h4', { class: 'eyebrow', 'data-feed-extensions': '1' }, [T.extTitle]),
      switchRow(T.phanpyName, T.phanpyHint, phanpyOn, 'data-ext-switch-phanpy', flip(PHANPY_ID)),
      url,
      phanpyButton(),
      switchRow(T.bridgesName, T.bridgesHint, bridgesOn(), 'data-ext-switch-bridges', flip(BRIDGES_ID)),
      switchRow(T.metaName, T.metaHint, META_PORTABILITY_ENABLED, 'data-meta-portability', null),
    ].filter((n): n is HTMLElement => n !== null)
  }

  return { posts, problems, refresh, sourcesSection, personRow, settingsRows, phanpyButton }
}
