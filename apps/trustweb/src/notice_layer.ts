// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c chat-notices: ONE layer for every toast, notice, undo and result card. It sits fixed inside the phone frame (never inside a transformed or
 * zoomed layer), stacks its children above the bottom bar, shows at most NOTICE_CAP at once and never leaves the viewport. The bars keep their own timers,
 * x buttons and handlers; this file only decides where they sit and which ones show. Pure model first, DOM host below.
 */

/** Top to bottom. cards: ask results and message cards; wants: "Wants to connect"; update: the new-build banner; notice: showNotice and Undo; message: new-message notice; toast. */
export const NOTICE_KINDS = ['cards', 'wants', 'update', 'notice', 'message', 'toast'] as const
export type NoticeKind = (typeof NOTICE_KINDS)[number]
export const NOTICE_CAP = 3

/** The active kinds that show: stack order, and when more than `cap` are active the ones nearest the bottom bar stay. */
export function visibleKinds(active: ReadonlySet<string>, cap: number = NOTICE_CAP): NoticeKind[] {
  return NOTICE_KINDS.filter((k) => active.has(k)).slice(-cap)
}

export interface NoticeLine { kind: NoticeKind; text: string; visible: boolean }

/** Debug listing (MCP notices_list and the e2e): every active notice, top to bottom, with whether it shows. */
export function describeNotices(active: readonly { kind: NoticeKind; text: string }[], cap: number = NOTICE_CAP): NoticeLine[] {
  const shown = new Set(visibleKinds(new Set(active.map((a) => a.kind)), cap))
  return NOTICE_KINDS.flatMap((kind) => active.filter((a) => a.kind === kind).map((a) => ({ kind, text: a.text, visible: shown.has(kind) })))
}

interface Member { kind: NoticeKind; el: HTMLElement; active: () => boolean }

export interface NoticeLayer {
  el: HTMLElement
  /** An existing bar (toast, notice, ...) becomes a child of the layer; `active` says when it counts (default: not hidden and not empty). */
  adopt(kind: NoticeKind, el: HTMLElement, active?: () => boolean): void
  /** A rebuilt node (the wants box) replaces the one of this kind; null removes it. */
  slot(kind: NoticeKind, node: HTMLElement | null): void
  list(): NoticeLine[]
  refresh(): void
}

const isOn = (el: HTMLElement): boolean => !el.hidden && el.childNodes.length > 0

export function createNoticeLayer(doc: Document): NoticeLayer {
  const layer = doc.createElement('div')
  layer.id = 'notice-layer'
  layer.setAttribute('data-notice-layer', '')
  const members: Member[] = []
  const watch = new MutationObserver(() => refresh())
  const watchOpts = { attributes: true, attributeFilter: ['class', 'hidden'], childList: true }
  function refresh(): void {
    const on = members.filter((m) => m.active())
    const shown = new Set(visibleKinds(new Set(on.map((m) => m.kind))))
    for (const m of members) {
      const cut = m.active() && !shown.has(m.kind)
      if (cut !== m.el.hasAttribute('data-notice-cut')) m.el.toggleAttribute('data-notice-cut', cut)
    }
    layer.toggleAttribute('data-notice-empty', on.length === 0)
  }
  function place(m: Member): void {
    m.el.setAttribute('data-notice-kind', m.kind)
    const after = members.filter((o) => NOTICE_KINDS.indexOf(o.kind) > NOTICE_KINDS.indexOf(m.kind))[0]
    layer.insertBefore(m.el, after?.el ?? null)
    watch.observe(m.el, watchOpts)
  }
  return {
    el: layer,
    adopt(kind, el, active = () => isOn(el)) {
      const m = { kind, el, active }
      members.push(m)
      place(m)
      refresh()
    },
    slot(kind, node) {
      const i = members.findIndex((m) => m.kind === kind)
      if (i >= 0) { members[i].el.remove(); members.splice(i, 1) }
      if (node) { const m = { kind, el: node, active: () => true }; members.push(m); place(m) }
      refresh()
    },
    list: () => describeNotices(members.filter((m) => m.active()).map((m) => ({ kind: m.kind, text: (m.el.textContent ?? '').replace(/\s+/g, ' ').trim() }))),
    refresh,
  }
}
