// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The Web view of the Membranes tab: the rings drawing, a person dragged between rings, the right-click / long-press menu
 * that spaces the dots out, zoom and pan over the Web screen, and the tap that adds someone. Moved out of main.ts so ring
 * work no longer shares merge hunks with the rest of the app; the page around it (webPage, the small card, the ask marks)
 * stays in main.ts. The pure helpers at the top carry the maths and the drop decision, so they are tested in node; the
 * DOM part is createWebView, which gets every main.ts closure it needs through WebViewDeps. Everything local (I1).
 */
import { el } from '../../demo/src/ui/dom'
import { arcsGradient, loadColourTags, tagColours } from './colour_tags'
import { isBlocked, isNonResponsive } from './non_responsive'
import { type Column, YOU_EDGE, DESIRE_DEFAULT, RINGS_LABEL_CAP, angleFromCentre, angleOf, avoidSector, beyondRings, columnSector, lapRadius, CONTROL_GAP, nudgeAngles, placeOnRing, restoreAngles, ringAt, ringsGeometry, spaceOut, webSlot, WEB_RINGS } from './rings_layout'
import type { RingsGeometry, Spot } from './rings_layout'
import { RINGS_HIDDEN_KEY, guideDimmed, parseHidden, serializeHidden, toggleHidden, visiblePeople } from './rings_hide'
import { EXPAND_DX, HANDLE, ringPoints } from './ring_handles'
import { initialColor } from './avatar_initial'
import { displayName } from '../../../packages/person-fields/src/display_name'
import { isConnected } from './card_view'
import { HintId, isDemoPerson, Ring, RINGS, REACH_OUT_INK, ringColor } from './model'
import type { AppState, Person } from './model'
import { S } from './strings'
import type { Curator, LentRings } from './curator'
import { intendingReminder, knownWays, lastMessagedAt } from './intending_reminder'
import { bringAllBack, bringBack, expanseList, hideInExpanse, hitControls, visibleIn } from './expanse'
import { shortLabel } from './short_label'
import { closest150, closestLimit, drawnLimit, effectiveLimit, keepPinned, limitOf, rankedBy, withTag } from './membranes_five'
import { shownAfterMove, shownKey, stickyCut, type RankedDot } from './ring_shown'
import { communityOf, isArchived, inZones, setUi, toneVar, zoneFor } from './trustzones'
import { connectionsShown } from './zone_connections'
import { LINE_DASH, clearStated, setStated } from './relations_model'
import { relationCard, relationsOf } from './relations_view'
import { filterByChips } from './tag_filter'
import { dueMoves, releaseTies } from './engagement'
import { ringCard } from './membranes_five_view'
import { archivePerson, restorePerson } from './archived_people'
import { binAt, binDrop } from './drag_bins'
import { daysLeft, deletePersonSoft, putBack, recentlyDeleted } from './deleted_people'
import { applyAll, clearSelection, toggle as toggleSel } from './multi_select'
import type { Selection } from './multi_select'
import { UNDO_SINGLE_MS, dragIds, undoMs } from './select_tool'
import type { BinKind } from './drag_bins'
import { GRACE_MS, HOVER_IDLE, hoverStep, nearCard } from './ring_hover'
import { OVERLAY_DWELL_MS, overlayAllowed, restedAt } from './overlay_gate'
import type { HoverEvent } from './ring_hover'
import { singleOrDouble } from './press'
import { contextPress } from './context_press'
import { labelScale, dragRingTo } from './ring_spacing'
import { clearDots, labelSize, type DotDisc } from './dot_clear'
import { RINGS_ZOOM_HOME, type RingsZoom, type ZoomView, fitZoom, panBy, transformOf, zoomAt } from './rings_zoom'
import type { Layout } from './layout_pick'
import { createCountdown } from './merge_countdown'
import { HOLD_MS, type HoldEvent, hitDot, holdEnabled, holdStart, holdStep } from './dot_merge'
import { onRingLine, ringStrokeOpacity, ringStrokeWidth } from './ring_hit'
import { makeResizable } from './overlay_resize'

/** The rings' own layout size (px): the viewBox, and the box a pointer is read against. */
export const RINGS_SIZE = 352

/** How close (view px) a press must be to a ring's line to count as on it. */
export const RING_LINE_HIT = 10

/** How long the ripple plays on its own before the add-someone sheet opens. */
export const RIPPLE_LEAD_MS = 360

export const HIDDEN_GUIDE_OPACITY = '.25'

const NS = 'http://www.w3.org/2000/svg'

/** A pointer position in the rings' own layout px, whatever the zoom layer and the query-dock scale do to the box. */
export function localPoint(e: { clientX: number; clientY: number }, box: { left: number; top: number; width: number }): { x: number; y: number } {
  const k = box.width / RINGS_SIZE
  return { x: (e.clientX - box.left) / k, y: (e.clientY - box.top) / k }
}

/** The ring whose line is closest to a tap `dist` view px from the centre (the add-someone sheet preselects it); acquaintance by default. */
export function nearestRing(dist: number, geo: Pick<RingsGeometry, 'radius'>, k: number): Ring {
  return RINGS.reduce((best, r) => (Math.abs(geo.radius[r] * k - dist) < Math.abs(geo.radius[best] * k - dist) ? r : best), Ring.Acquaintance)
}

/** The context menu's ring: the one nearest the press, and whether the press sits on its line (within RING_LINE_HIT view px). */
export function menuTarget(at: { x: number; y: number }, geo: Pick<RingsGeometry, 'radius' | 'rings'>, k: number): { near: Ring; onLine: boolean } {
  const { x, y } = at
  const dist = Math.hypot(x - RINGS_SIZE / 2, y - RINGS_SIZE / 2)
  const near = ringAt(dist / k, geo.radius, geo.rings)
  const onLine = Math.abs(geo.radius[near] * k - dist) <= RING_LINE_HIT
  return { near, onLine }
}

/** Where the context menu opens: at the press, kept inside the rings (the menu is about 170 x 70 px). */
export function menuPlace(at: { x: number; y: number }): { left: number; top: number } {
  return { left: Math.min(at.x, RINGS_SIZE - 170), top: Math.min(at.y, RINGS_SIZE - 70) }
}

/** A pressed dot starts to drag once the pointer moved 4 px (mouse), or 8 px while a touch hold is pending (`held`). */
export function dragStarts(dx: number, dy: number, held: boolean): boolean {
  return !(Math.hypot(dx, dy) < (held ? 8 : 4))
}

export type DropOutcome = 'hide' | 'family-stays' | 'same-ring' | 'unplace' | 'ask-desire' | 'move'

/** What a drop on `ring` does (`out`: beyond the rings), in the order the drop handler checks it. */
export function dropOutcome(p: Pick<Person, 'ring' | 'fields' | 'ringSuggested'>, ring: Ring, out: boolean): DropOutcome {
  if (out) return 'hide'
  if (ring === Ring.Unsorted && p.ring === Ring.Family) return 'family-stays'
  if (ring === webSlot(p)) return 'same-ring'
  if (ring === Ring.Unsorted) return 'unplace'
  if (ring === Ring.Intending) return 'ask-desire'
  return 'move'
}

/** The main.ts closures the Web view needs; getters for the values that change (tagFilter, ownPictureUrl). */
export interface WebViewDeps {
  st(): AppState
  save(): void
  render(): void
  toast(msg: string, o?: { onClick?: () => void }): void
  showNotice(title: string, body: string, actions: HTMLElement[], autoHideMs?: number): void
  hideNotice(): void
  curator: Pick<Curator, 'hide' | 'unhide' | 'ring'>
  openWebPage(page: { kind: 'card'; id: string } | { kind: 'more'; ring: Ring } | { kind: 'me' }): void
  toggleCardExpanded(): void
  editNameSheet(fromWeb?: boolean): void
  addPersonSheet(ring: Ring): void
  openHint(id: HintId): void
  hintHidden(id: HintId): boolean
  touchUi(): boolean
  curatorPerson(personId: string): void
  /** Opens the "Same person" sheet for two persons (the first is kept first, so Enter keeps it); null on a demo phone, where merging is off. */
  mergeSheet: ((aId: string, bId: string) => void) | null
  /** Wave 36: merges `dropId` into `keepId` (snapshot first); null where mergeSheet is. */
  mergeNow: ((keepId: string, dropId: string) => void) | null
  dummyChip(): HTMLElement
  avatar(name: string, id: string, cls?: string): HTMLElement
  pictured(face: HTMLElement, url: string | undefined): HTMLElement
  ownPictureUrl(): string | undefined
  demoPhone(): boolean
  changeRing(p: Person, ring: Ring): void
  ripple(e: MouseEvent): void
  tagFilter(): string | null
  currentLayout(): Layout
  openSheet(children: (Node | null)[]): void
  closeSheet(): void
  solo: boolean
  /** Delete for good (main.ts deletePerson); since wave 36 only the 30-day purge uses it. */
  removePerson(personId: string): void
}

export interface RingsOpts { complete?: boolean }

export interface WebView {
  ringsView(s: AppState, marks?: Map<string, 'asked' | 'shared'>, desk?: LentRings, opts?: RingsOpts): HTMLElement
  zoomOnWeb(clip: HTMLElement, layer: HTMLElement): void
  /** Leaving the Web screen: the next visit starts at home zoom. */
  resetZoom(): void
  hideOnRings(p: Person): Promise<void>
  /** A Web view ring change goes on to Tana through the Curator's sync. */
  ringToTana(p: Person, ring: Ring): void
  spaceOutWeb(ring?: Ring): void
  /** Wave 35: the sheet of the hidden people (the same one a long press on you opens). */
  openExpanse(): void
  /** Wave 36: the sheet of the deleted people (Put back, days left). */
  openDeleted(): void
  /** Wave 36b: the select tool (third tool button) on or off; leaving clears the selection. Returns the new state. */
  toggleSelect(): boolean
  selectOn(): boolean
  /** Wave 36b: delete with the 30-day tombstone and the Undo toast (person page, Desk, dustbin). */
  deleteReversibly(ps: readonly Person[]): void
}

export function createWebView(deps: WebViewDeps): WebView {
  const { st, save, render, toast, showNotice, hideNotice, curator, openWebPage, toggleCardExpanded, addPersonSheet, openHint, hintHidden, touchUi, curatorPerson, mergeSheet, dummyChip, avatar, pictured, demoPhone, changeRing, ripple, currentLayout, openSheet, closeSheet, solo } = deps
  /** The drawn rings of the last render: their radii (in layout units) and the factor that fits a crowded web into the view; a drop or tap is read through both. */
  let ringsGeo: RingsGeometry = ringsGeometry({} as Record<Ring, number>)
  let ringsK = 1
  /** Wave 36: the diamond / expand column (relative to the rings centre): dots keep out of it, whether the expand buttons show or not. */
  let ringsColumn: Column | undefined
  /** Wave 37: ids of the dots the last render drew in the per-ring cut (null: everyone was drawn); a manual move saves them so only the moved dot changes. */
  let shownNow: Set<string> | null = null
  /** Wave 37: "Rings adjust themselves" is on and a dot was just moved: the next renders diff against `prev`, fading dots in and out for ~1.2 s. */
  let fade: { prev: Set<string>; moved: string } | null = null
  let fadeTimer: ReturnType<typeof setTimeout> | undefined
  const fadeOf = new Map<string, 'in' | 'out'>()
  const keepOutColumn = (radius: number, pad: number): [number, number] | null => (ringsColumn ? columnSector(radius, ringsColumn, pad) : null)

  /** `desk`: the rings lent to the Desk's Web page (curator.ts LentRings): a tap picks the person there, no phone sheets, no add-someone tap or space-out menu. */
  function ringsView(s: AppState, marks: Map<string, 'asked' | 'shared'> = new Map(), desk?: LentRings, opts: RingsOpts = {}): HTMLElement {
    const C = 176
    const counts = {} as Record<Ring, number>
    const everyone: Partial<Record<Ring, Person[]>> = {}
    // Wave 28: archived contacts never; the Desk's lent rings keep every filter off (they are where the unsorted get sorted), the phone's rings follow the saved filters.
    const community = communityOf(s)
    // Wave 28b: the sidebar's tag filters (show only / hide, hide wins) thin the dots of the phone's rings.
    for (const p of visibleIn(s, desk ? s.people.filter((x) => !isBlocked(x) && !isArchived(x)) : filterByChips(inZones(s.people, s), loadColourTags(), s.uiRings?.show ?? [], s.uiRings?.hide ?? []))) (everyone[zoneFor(p, community)] ??= []).push(p)
    // Wave 33: "closest 150" keeps the 150 closest across all rings (ring membership unchanged) and draws them all.
    const only150 = !desk && s.uiRings?.closest150 === true
    if (only150) {
      const keep = new Set(closest150(Object.values(everyone).flat(), s, Date.now(), closestLimit(s.uiRings)).map((p) => p.id))
      for (const r of Object.keys(everyone) as Ring[]) everyone[r] = everyone[r]!.filter((p) => keep.has(p.id))
    }
    // Wave 25: the closest five per membrane (membranes_five.ts); the complete view and the Desk's lent rings show everyone.
    const complete = opts.complete === true || desk !== undefined || only150
    const members: Partial<Record<Ring, Person[]>> = {}
    const rest: Partial<Record<Ring, Person[]>> = {}
    const filled = s.uiRings?.filled ?? [] // wave 35: only a fill the user set; the old default (acquaintances drawn in full) bypassed the per-ring cut
    // Wave 37: a manual move keeps every ring's shown dots (sticky) unless "Rings adjust themselves" is on.
    const sticky = !s.uiRings?.autoAdjust && s.uiRings?.shown?.key === shownKey(limitOf(s), s.uiRings?.rankBy, s.uiRings?.perRingLimitOff, filled) ? new Set(s.uiRings.shown.ids) : null
    const stickyAt = s.uiRings?.shown?.at // review: people added after the move still show
    const rankedAll: RankedDot[] = []
    const ranks: Partial<Record<Ring, Person[]>> = {}
    shownNow = complete ? null : new Set()
    fadeOf.clear()
    for (const [r, ps] of Object.entries(everyone) as [Ring, Person[]][]) {
      if (complete) { members[r] = ps; continue }
      // Wave 28: a filled ring (the + became a triangle) draws everyone; the others the closest five, the rest behind the list button.
      const lim = drawnLimit(s, s, r)
      const cut = rankedBy(s.uiRings, s, withTag(ps, deps.tagFilter(), loadColourTags()), lim, Date.now())
      if (Number.isFinite(lim)) { ranks[r] = [...cut.shown, ...cut.rest]; rankedAll.push(...ranks[r]!.map((p) => ({ id: p.id, ring: r }))) }
      const f = keepPinned(sticky && Number.isFinite(lim) ? stickyCut([...cut.shown, ...cut.rest], sticky, stickyAt) : cut, s.uiRings?.pinnedId) // wave 36b: a dragged dot stays
      members[r] = f.shown; rest[r] = f.rest
    }
    if (fade && !complete && rankedAll.length) { // wave 37: the recent-N rule after a move, shown slowly: appearing dots fade in, leaving dots stay drawn while they fade out
      const change = shownAfterMove(fade.prev, rankedAll, fade.moved, limitOf(s), true)
      for (const id of change.appear) fadeOf.set(id, 'in')
      for (const id of change.disappear) fadeOf.set(id, 'out')
      for (const [r, all] of Object.entries(ranks) as [Ring, Person[]][]) {
        members[r] = all.filter((p) => change.shown.has(p.id) || fadeOf.get(p.id) === 'out')
        rest[r] = all.filter((p) => !members[r]!.includes(p))
      }
    }
    if (shownNow) for (const ps of Object.values(members)) for (const p of ps ?? []) if (fadeOf.get(p.id) !== 'out') shownNow.add(p.id)
    // Wave 28: a dot keeps its angle (dropped, else fixed from its id): slotAngle (membranes_five.ts, kept) no longer moves dots between renders, a ring change only moves them radially.
    const angleOfP = (p: Person): number => angleOf(p)
    const quiet = new Map(desk ? [] : dueMoves(s, Date.now()).map((m) => [m.person.id, m.to] as const))
    for (const r of Object.keys(members) as Ring[]) counts[r] = members[r]!.length
    // The layout keeps every person's place; a hidden ring's people are only not drawn (and so not hit-testable).
    const hidden = loadHiddenRings()
    const angles = Object.fromEntries(Object.entries(members).map(([r, ps]) => [r, ps.map(angleOfP)]))
    // The close ring depends on the scale (the "you" avatar does not shrink), the scale on the extent: settle on the first scale whose layout still fits.
    let k = 1
    const custom = desk ? undefined : s.uiRings?.radii   // wave 39: ring lines the user dragged
    for (ringsGeo = ringsGeometry(counts, angles, k, custom); C / ringsGeo.extent < k - 0.005; ringsGeo = ringsGeometry(counts, angles, k, custom)) k = C / ringsGeo.extent
    ringsK = k
    const colourTags = loadColourTags()
    const wrap = el('div', { class: 'rings-wrap' + (s.people.length > RINGS_LABEL_CAP || desk?.compact ? ' compact' : ''), 'data-view': 'rings', ...(complete ? { 'data-complete': '' } : {}), title: desk ? '' : S.hintText[HintId.WebTap] })
    const at = new Map<string, { x: number; y: number }>()
    let dragged = false
    if (!desk) {
      wrap.addEventListener('click', (e) => { if (!dragged) onRingsTap(e as MouseEvent, wrap) })
      ringsMenuOn(wrap, (v) => { dragged = v })
    }
    if (!desk && touchUi() && !hintHidden(HintId.WebTap)) {
      wrap.appendChild(el('button', {
        class: 'hint-i rings-hint', 'aria-label': S.hintOpen(S.hintLabel[HintId.WebTap]),
        onclick: (e: Event) => { e.stopPropagation(); openHint(HintId.WebTap) },
      }, ['i']))
    }
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('viewBox', '0 0 352 352')
    svg.innerHTML = '<defs><linearGradient id="th" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4FD7A0"/><stop offset="1" stop-color="#12A8E3"/></linearGradient></defs>'
    for (const r of ringsGeo.rings) {
      const c = document.createElementNS(NS, 'circle')
      c.setAttribute('cx', String(C)); c.setAttribute('cy', String(C)); c.setAttribute('r', String(ringsGeo.radius[r] * k)); c.setAttribute('data-ring', r)
      c.setAttribute('fill', 'none'); c.setAttribute('stroke', ringColor({ ring: r })); c.setAttribute('stroke-opacity', String(ringStrokeOpacity(r)))
      c.setAttribute('stroke-width', String(ringStrokeWidth(r)))
      if (guideDimmed(hidden.has(r), false)) c.style.opacity = HIDDEN_GUIDE_OPACITY
      c.setAttribute('stroke-dasharray', r === Ring.Intending ? '1 6' : r === Ring.Acquaintance ? '2 5' : r === Ring.Friend ? '6 4' : '')
      svg.appendChild(c)
    }
    if (ringsGeo.rings.includes(Ring.Unsorted)) {
      const t = document.createElementNS(NS, 'text')
      t.setAttribute('x', String(C + 12)); t.setAttribute('y', String(C - ringsGeo.radius[Ring.Unsorted] * k + 3)); t.setAttribute('text-anchor', 'start')
      t.setAttribute('font-size', '8'); t.setAttribute('fill', ringColor({ ring: Ring.Unsorted })); t.setAttribute('data-ring-label', Ring.Unsorted); t.setAttribute('aria-label', S.ringLabel[Ring.Unsorted])
      svg.appendChild(t)
    }
    wrap.appendChild(svg)
    // Wave 34: each ring's diamond (hide) sits ON its drawn line at 6 o'clock, innermost topmost; the ⛶ (expand the rest) beside it only when Filters ask for it.
    const diamondAt = ringPoints(ringsGeo.rings.map((r) => ringsGeo.radius[r]), C, k, HANDLE)
    const rows = ringsGeo.rings.map((r, i) => ({
      ring: r, at: diamondAt[i],
      more: s.uiRings?.expandButtons === true && !desk && !hidden.has(r) && !complete && Boolean(rest[r]?.length || filled.includes(r)) && (everyone[r]?.length ?? 0) > effectiveLimit(s.uiRings, s),
    }))
    if (diamondAt.length) ringsColumn = { x: -HANDLE / 2 - CONTROL_GAP, w: HANDLE + EXPAND_DX + 2 * CONTROL_GAP, cy: (diamondAt[0].top + diamondAt[diamondAt.length - 1].top) / 2 - C, h: diamondAt[diamondAt.length - 1].top - diamondAt[0].top + HANDLE }
    const controls: Spot[] = rows.flatMap((w) => [{ x: w.at.left, y: w.at.top, r: HANDLE / 2 }, ...(w.more ? [{ x: w.at.left + EXPAND_DX, y: w.at.top, r: HANDLE / 2 }] : [])])
    // Dots never overlap each other or a control: each is drawn at the nearest free angle on its lap (stored angles stay).
    const drawAngle = nudgeAngles(ringsGeo.rings.flatMap((ring) => {
      const laps = new Map((members[ring] ?? []).map((p, i) => [p, ringsGeo.lapOf[ring]![i]]))
      return visiblePeople(members[ring] ?? [], hidden).map((p) => ({ id: p.id, angle: angleOfP(p), radius: lapRadius(ringsGeo, ring, laps.get(p)!) * k, r: (ringsGeo.dot[ring] * k) / 2 }))
    }), controls, C, keepOutColumn)
    // Wave 39: bubbles never overlap: each shrinks just enough to clear its neighbours, the "you" avatar and the controls (layout px, so zoom never changes it).
    const discs: DotDisc[] = ringsGeo.rings.flatMap((ring) => {
      const laps = new Map((members[ring] ?? []).map((p, i) => [p, ringsGeo.lapOf[ring]![i]]))
      return visiblePeople(members[ring] ?? [], hidden).map((p) => {
        const a = ((drawAngle.get(p.id)! - 90) * Math.PI) / 180, radius = lapRadius(ringsGeo, ring, laps.get(p)!) * k
        return { id: p.id, x: C + radius * Math.cos(a), y: C + radius * Math.sin(a), r: (ringsGeo.dot[ring] * k) / 2 }
      })
    })
    const dotR = clearDots(discs, [{ x: C, y: C, r: YOU_EDGE }, ...controls])
    for (const ring of ringsGeo.rings) {
      const dot = ringsGeo.dot[ring]
      const laps = new Map((members[ring] ?? []).map((p, i) => [p, ringsGeo.lapOf[ring]![i]]))
      visiblePeople(members[ring] ?? [], hidden).forEach((p) => {
        const lap = laps.get(p)!
        const a = ((drawAngle.get(p.id)! - 90) * Math.PI) / 180
        const radius = lapRadius(ringsGeo, ring, lap) * k
        const x = C + radius * Math.cos(a)
        const y = C + radius * Math.sin(a)
        // A crowded web (compact) draws a spoke only for people connected here: hundreds of dashed spokes read as dozens of rings.
        if (p.peerId || s.people.length <= RINGS_LABEL_CAP) {
          const path = document.createElementNS(NS, 'path')
          const mx = (C + x) / 2 + (y - C) * 0.12
          const my = (C + y) / 2 + (C - x) * 0.12
          path.setAttribute('d', `M${C} ${C} Q${mx} ${my} ${x} ${y}`)
          path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'url(#th)')
          path.setAttribute('stroke-width', ring === Ring.Close ? '2.6' : ring === Ring.Friend ? '1.8' : ring === Ring.Acquaintance ? '1.2' : '0.8')
          path.setAttribute('opacity', p.peerId ? '0.85' : '0.35')
          if (!p.peerId) path.setAttribute('stroke-dasharray', '3 4')
          svg.appendChild(path)
        }
        const mark = (p.peerId ? marks.get(p.peerId) : undefined) ?? (p.doorPeerId ? marks.get(p.doorPeerId) : undefined)
        const arcs = arcsGradient(tagColours(p, colourTags))
        const face = avatar(p.name, p.id)
        face.style.background = p.reachedOut && ring === Ring.Intending ? ringColor(p) : toneVar(ring)
        if (p.reachedOut && ring === Ring.Intending) face.style.color = REACH_OUT_INK
        if (!isConnected(p)) { // outline only until connected on TrustWeb: dashed stroke in the fill colour, ink text
          face.classList.add('unconnected'); face.style.borderColor = face.style.background; face.style.background = ''; face.style.color = initialColor('outlined')
        }
        pictured(face, p.theirProfile?.picture)
        const press = singleOrDouble(() => openWebPage({ kind: 'card', id: p.id }), () => { openWebPage({ kind: 'card', id: p.id }); toggleCardExpanded() })
        const b = el('button', {
          class: 'node' + (fadeOf.has(p.id) ? ' fade-' + fadeOf.get(p.id) : '') + (mark ? ' ' + mark : '') + (arcs ? ' tagged' : '') + (isNonResponsive(p) ? ' nonresp' : '') + (p.pinned === true ? ' pinned' : ''), 'data-pid': p.id, 'data-tone': String(WEB_RINGS.indexOf(ring)),
          onclick: () => { if (!dragged) (desk ? desk.onPick(p.id) : press()) },
        }, [
          face,
          el('span', { title: displayName(p.name).title || p.name, 'aria-label': displayName(p.name).text }, [shortLabel(displayName(p.name).text)]),
          isDemoPerson(s, p.id) ? dummyChip() : null,
          st().showRingNames ? el('em', { class: 'lvl' }, [S.ringLabel[p.ring]]) : null,
        ])
        if (!desk) contextPress(b, () => curatorPerson(p.id))
        at.set(p.id, { x, y })
        b.style.left = x + 'px'
        b.style.top = y + 'px'
        if (arcs) b.style.setProperty('--arcs', arcs)
        const diameter = 2 * (dotR.get(p.id) ?? (dot * k) / 2)
        b.style.setProperty('--d', diameter + 'px')
        b.style.setProperty('--lbl', labelSize(diameter) + 'px')
        if (diameter < 11) b.classList.add('nl')
        wrap.appendChild(b)
        const to = quiet.get(p.id)
        if (to) { // Wave 28: a note, never a move: tap accepts this one move
          const z = el('button', { class: 'zzz', 'data-zzz': p.id, 'aria-label': S.zoneZzzAria(p.name, S.ringLabel[to]), title: S.zoneZzzTitle(S.ringLabel[to]),
            onpointerdown: (e: Event) => { e.stopPropagation() }, onclick: (e: Event) => { e.stopPropagation(); zzzAccept([p.id]) } }, ['zzz'])
          z.style.left = x + (dot * k) / 2 + 'px'; z.style.top = y - (dot * k) / 2 + 'px'
          wrap.appendChild(z)
        }
      })
    }
    // Wave 29: thin dashed lines between contacts who know each other (never to me); dragOnRings moves them with the dot.
    // Wave 40: the stroke follows how they relate (close friends = short dashes, fainter when less sure); a wider invisible line on top opens the "why" card.
    if (!desk && connectionsShown(s)) {
      const rel = relationsOf(s, s.people)
      for (const [a, b] of rel.pairs()) {
        const from = at.get(a), to = at.get(b), r = rel.relation(a, b)
        if (!from || !to || !r) continue
        for (const hit of [false, true]) {
          const line = document.createElementNS(NS, 'line')
          line.setAttribute('x1', String(from.x)); line.setAttribute('y1', String(from.y)); line.setAttribute('x2', String(to.x)); line.setAttribute('y2', String(to.y))
          line.setAttribute('data-conn', `${a}|${b}`)
          if (hit) { line.setAttribute('data-conn-hit', ''); line.setAttribute('stroke', 'transparent'); line.setAttribute('stroke-width', '12') }
          else { line.setAttribute('data-kind', r.kind); line.setAttribute('stroke', 'currentColor'); line.setAttribute('stroke-width', '0.7'); line.setAttribute('stroke-dasharray', LINE_DASH[r.kind]); line.setAttribute('opacity', String(0.3 + 0.4 * r.confidence)) }
          svg.appendChild(line)
        }
      }
    }
    const you = el('button', { class: 'node you', 'aria-label': S.meNameAria(s.me.displayName), tabindex: desk ? '-1' : false, onclick: () => { if (!desk) openWebPage({ kind: 'me' }) } }, [pictured(avatar(s.me.displayName, s.me.id), deps.ownPictureUrl())])
    if (!desk) contextPress(you, () => { if (expanseList(st()).length) expanseSheet() }) // Wave 33: the list of the hidden opens from a long press on you (the orange control is gone)
    you.style.left = C + 'px'
    you.style.top = C + 'px'
    wrap.appendChild(you)
    dragOnRings(wrap, s, (v) => { dragged = v; if (v) hideAll() }, desk?.onRing, desk === undefined) // Wave 36: a lifted dot closes any open card
    // Re-render IN PLACE: the Desk slots this very element (slot name, styles, its fit() transform) and the phone's zoom layer wraps it,
    // so a replaceWith() made the rings vanish from the Desk (Jakob 20:05). `live` = the element the pressed button sits in.
    const toggle = (next: ReadonlySet<Ring>, live: HTMLElement): void => {
      try { window.localStorage.setItem(RINGS_HIDDEN_KEY, serializeHidden(next)) } catch { /* not remembered */ }
      const fresh = ringsView(s, marks, desk, opts)
      live.className = fresh.className
      live.replaceChildren(...fresh.childNodes)
    }
    // Wave 29: hover on a ring's handle or band (desktop) == long press on the handle (phone) opens the interactive "Everyone in <ring>" card at the pointer;
    // it stays while the pointer crosses into it (GRACE_MS), closes when pointer has left handle, band and card, or on Esc. Renames show in the rings on close.
    let hover = HOVER_IDLE
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    let renamed = false
    // Wave 36: while a name is being edited in the card (✓ ✕ archive), a tap on other dots selects them too; ✕ then deletes and archive archives all selected, once.
    let picked = clearSelection()
    const editing = (): boolean => wrap.querySelector('[data-ring-card-input]') !== null
    const markPicked = (): void => {
      wrap.querySelectorAll<HTMLElement>('.node:not(.you)').forEach((n) => n.classList.toggle('multi-sel', picked.has(n.dataset.pid ?? '')))
      const card = wrap.querySelector('[data-ring-card]')
      card?.querySelector('[data-multi-count]')?.remove()
      if (card && picked.size > 1) card.querySelector('b')?.after(el('span', { class: 'multi-count', 'data-multi-count': String(picked.size) }, [S.multiCount(picked.size)]))
    }
    const bulk = (kind: 'delete' | 'archive'): boolean => {
      if (picked.size < 2) return false
      const ids = picked
      const group = st().people.filter((x) => ids.has(x.id))
      hideAll()
      if (kind === 'delete') removeNow(group)
      else { applyAll(group, ids, archivePerson); save(); render(); archivedUndo(group) }
      return true
    }
    // The grey "Tap empty space…" hint (native title, touch "i") stays away while a card is open.
    const hintTitle = wrap.title
    const cardShown = (on: boolean): void => { wrap.classList.toggle('card-open', on); wrap.title = on ? '' : hintTitle }
    let relTimer: ReturnType<typeof setTimeout> | undefined
    const relOpen = (): HTMLElement | null => wrap.querySelector('[data-rel-card]')
    const relEsc = (e: KeyboardEvent): void => { if (e.key === 'Escape') relClose() }
    const relClose = (): void => { clearTimeout(relTimer); relOpen()?.remove(); document.removeEventListener('keydown', relEsc) }
    const hideAll = (): void => {
      clearTimeout(graceTimer); hover = HOVER_IDLE
      wrap.querySelector('[data-ring-card]')?.remove()
      relClose()
      cardShown(false)
      document.removeEventListener('keydown', onEsc)
      picked = clearSelection()
      wrap.querySelectorAll('.multi-sel').forEach((n) => n.classList.remove('multi-sel'))
      if (renamed) { renamed = false; render() }
    }
    const onEsc = (e: KeyboardEvent): void => { if (e.key === 'Escape') hideAll() }
    const showAll = (r: Ring, e: { clientX: number; clientY: number }): void => {
      wrap.querySelector('[data-ring-card]')?.remove()
      const at = localPoint(e, wrap.getBoundingClientRect())
      const box = ringCard(S.ringLabel[r], everyone[r] ?? [], {
        onOpen: (id) => { hideAll(); openWebPage({ kind: 'card', id }) },
        onRename: (p, next) => { p.name = next; renamed = true; save() },
        onArchive: (p) => { if (!bulk('archive')) { archivePerson(p); save(); hideAll(); render(); toast(S.archivedInSettings) } },
        onDelete: () => bulk('delete'),
        onEdit: (p) => { picked = p ? toggleSel(clearSelection(), p.id) : clearSelection(); markPicked() },
        // Wave 39: the ticks beside the names pick several people; "Archive N" archives them in one undo (a single tick archives that one person).
        onPick: (ids) => { picked = new Set(ids); markPicked() },
        onArchiveMany: (ids) => {
          picked = new Set(ids)
          if (bulk('archive')) return
          const one = st().people.find((x) => x.id === ids[0])
          if (one) { archivePerson(one); save(); hideAll(); render(); toast(S.archivedInSettings) }
        },
      })
      box.style.left = Math.min(at.x + 12, RINGS_SIZE - 90) + 'px'
      box.style.top = Math.min(at.y + 12, RINGS_SIZE - 40) + 'px'
      box.addEventListener('pointerenter', () => step({ type: 'enter-card' }))
      box.addEventListener('pointerleave', () => step({ type: 'leave' }))
      wrap.appendChild(box)
      makeResizable(box, r, wrap.getBoundingClientRect().width / RINGS_SIZE)
      cardShown(true)
      document.addEventListener('keydown', onEsc)
    }
    const step = (ev: HoverEvent, e?: { clientX: number; clientY: number }): void => {
      const before = hover.open
      hover = hoverStep(hover, ev)
      clearTimeout(graceTimer)
      if (hover.grace) graceTimer = setTimeout(() => { hover = hoverStep(hover, { type: 'grace-end' }); if (!hover.open && !editing()) hideAll() }, GRACE_MS)
      if (hover.open && e && (ev.type === 'enter-handle' || ev.type === 'enter-ring') && (before !== hover.open || !wrap.querySelector('[data-ring-card]'))) showAll(hover.open, e)
    }
    const mouse = (e: Event): boolean => (e as PointerEvent).pointerType === 'mouse'
    // Wave 40: a dashed line between two contacts opens "Y and Z: friends (we think, 0.7)" with the reasons, Correct this and Not related (hover with the mouse, tap on a phone).
    if (!desk) {
      const showRel = (a: string, b: string, e: { clientX: number; clientY: number }): void => {
        const ppl = st().people
        const r = relationsOf(st(), ppl).relation(a, b)
        relClose()
        if (!r) return
        const save2 = (): void => { s.relations = st().relations; save(); relClose(); render() }
        const box = relationCard(r, (id) => ppl.find((x) => x.id === id)?.name ?? id, {
          // Review wave 40: "Not related" from the line card can be undone from its toast (the line is gone, the person card is far).
          set: (x, y, kind) => {
            const prev = st().relations?.find((q) => (q.a === x && q.b === y) || (q.a === y && q.b === x))
            setStated(st(), x, y, kind, Date.now()); save2()
            if (kind === 'none') toast(S.relations.toastNone, { onClick: () => { if (prev) setStated(st(), x, y, prev.kind, prev.at); else clearStated(st(), x, y); save2() } })
          },
          clear: (x, y) => { clearStated(st(), x, y); save2() },
        })
        const pt = localPoint(e, wrap.getBoundingClientRect())
        box.style.left = Math.min(pt.x + 12, RINGS_SIZE - 90) + 'px'
        box.style.top = Math.min(pt.y + 12, RINGS_SIZE - 40) + 'px'
        for (const t of ['pointerdown', 'click']) box.addEventListener(t, (ev) => ev.stopPropagation())
        box.addEventListener('pointerenter', () => clearTimeout(relTimer))
        box.addEventListener('pointerleave', () => { relTimer = setTimeout(relClose, GRACE_MS) })
        wrap.appendChild(box)
        document.addEventListener('keydown', relEsc)
      }
      svg.querySelectorAll<SVGLineElement>('[data-conn-hit]').forEach((hit) => {
        const [a, b] = (hit.getAttribute('data-conn') ?? '').split('|')
        hit.addEventListener('pointerenter', (e) => { if (mouse(e) && !dragged) { clearTimeout(relTimer); const at0 = { clientX: e.clientX, clientY: e.clientY }; relTimer = setTimeout(() => showRel(a, b, at0), OVERLAY_DWELL_MS) } })
        hit.addEventListener('pointerleave', (e) => { if (mouse(e)) { clearTimeout(relTimer); if (relOpen()) relTimer = setTimeout(relClose, GRACE_MS) } })
        hit.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); if (!dragged) showRel(a, b, e) })
      })
      wrap.addEventListener('pointermove', (e) => { const c = relOpen(); if (c && mouse(e) && nearCard({ x: e.clientX, y: e.clientY }, c.getBoundingClientRect())) clearTimeout(relTimer) })
    }
    // Wave 36: a card opens only after the pointer rested OVERLAY_DWELL_MS on the line (moves of 6 px restart it) and never while a dot is lifted.
    let dwellTimer: ReturnType<typeof setTimeout> | undefined
    let dwellAt = { x: 0, y: 0 }
    const dwell = (ring: Ring, e: PointerEvent): void => {
      clearTimeout(dwellTimer)
      dwellAt = { x: e.clientX, y: e.clientY }
      const since = performance.now()
      dwellTimer = setTimeout(() => { if (overlayAllowed({ dragging: dragged, dwellMs: performance.now() - since })) step({ type: 'enter-ring', ring }, { clientX: dwellAt.x, clientY: dwellAt.y }) }, OVERLAY_DWELL_MS)
    }
    if (!desk) { // the band: the pointer on a ring's stroke (nodes, handles and the card keep their own hover)
      let onBand: Ring | null = null
      let bridged = false
      wrap.addEventListener('pointermove', (e) => {
        const over = e.target as HTMLElement
        if (!mouse(e)) return
        // Wave 39: the card and a margin around it count as the card (hit-tested by position, not by what the pointer is over), so the gap between line and card never closes it.
        const card = hover.open ? wrap.querySelector('[data-ring-card]') : null
        if (card && nearCard({ x: e.clientX, y: e.clientY }, card.getBoundingClientRect())) { clearTimeout(dwellTimer); bridged = true; step({ type: 'enter-card' }); return }
        if (bridged) { bridged = false; step({ type: 'leave' }) }
        if (over.closest('[data-ring-card], [data-rel-card], .ring-toggle')) return
        const band = over.closest('.node, .ring-more, [data-conn-hit]') ? null : onRingLine(ringsGeo, localPoint(e, wrap.getBoundingClientRect()), k) // wave 37: the stroke itself, not the whole annulus
        wrap.classList.toggle('on-ring-line', band !== null)
        if (band === onBand) { if (band && !restedAt(dwellAt, { x: e.clientX, y: e.clientY }) && hover.open !== band) dwell(band, e); return }
        clearTimeout(dwellTimer)
        if (band) dwell(band, e); else if (onBand) step({ type: 'leave' })
        onBand = band
      })
      wrap.addEventListener('pointerleave', () => { clearTimeout(dwellTimer); bridged = false; if (onBand) { onBand = null; step({ type: 'leave' }) } })
      // Wave 39: a drag on a ring's stroke (mouse at once, touch after a 300 ms hold) moves that ring; rings outside or inside it make room. Dots keep their rings (no dot changes).
      wrap.addEventListener('pointerdown', (down) => {
        if ((down.target as HTMLElement).closest('.node, button, a, input, [data-ring-card], [data-rel-card], [data-conn-hit], .ring-toggle, .ring-more')) return
        const at0 = localPoint(down, wrap.getBoundingClientRect())
        const ring = onRingLine(ringsGeo, at0, k)
        if (!ring) return
        const touch = down.pointerType !== 'mouse'
        let radii = { ...ringsGeo.radius }
        const move = (e: PointerEvent): void => {
          if (!ringLineDrag) {
            if (!dragStarts(e.clientX - down.clientX, e.clientY - down.clientY, touch)) return
            if (touch) { clearTimeout(hold); unlisten(); return }   // a finger that moved before the hold is a scroll or pan
            lift()
          }
          const p = localPoint(e, wrap.getBoundingClientRect())
          radii = dragRingTo(ringsGeo.radius, ringsGeo.rings, ring, Math.hypot(p.x - RINGS_SIZE / 2, p.y - RINGS_SIZE / 2) / k)
          wrap.querySelectorAll<SVGCircleElement>('circle[data-ring]').forEach((c) => c.setAttribute('r', String(radii[c.getAttribute('data-ring') as Ring] * k)))
        }
        const lift = (): void => { ringLineDrag = true; dragged = true; clearTimeout(dwellTimer); hideAll(); window.getSelection()?.removeAllRanges() }
        const hold = touch ? window.setTimeout(lift, 300) : 0
        const unlisten = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end) }
        const end = (e: PointerEvent): void => {
          clearTimeout(hold)
          unlisten()
          if (!ringLineDrag) return
          ringLineDrag = false
          if (e.type === 'pointerup') { setUi(st(), 'radii', { ...st().uiRings?.radii, ...Object.fromEntries(ringsGeo.rings.filter((r) => radii[r] !== ringsGeo.radius[r]).map((r) => [r, radii[r]])) }); s.uiRings = st().uiRings; save(); render() }   // only the rings that moved are kept
          setTimeout(() => { dragged = false }, 0)
        }
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end)
      })
      wrap.addEventListener('touchmove', (e) => { if (ringLineDrag) e.preventDefault() }, { passive: false })
    }
    for (const w of rows) {
      const diamond = ringToggle(w.ring, hidden.has(w.ring), w.at.top, w.at.left, false, (btn) => toggle(toggleHidden(hidden, w.ring), btn.parentElement ?? wrap))
      wrap.appendChild(diamond)
      if (!desk) {
        diamond.addEventListener('pointerenter', (e) => { if (mouse(e) && !dragged) { clearTimeout(dwellTimer); dwellAt = { x: e.clientX, y: e.clientY }; const since = performance.now(); dwellTimer = setTimeout(() => { if (overlayAllowed({ dragging: dragged, dwellMs: performance.now() - since })) step({ type: 'enter-handle', ring: w.ring }, { clientX: dwellAt.x, clientY: dwellAt.y }) }, OVERLAY_DWELL_MS) } })
        diamond.addEventListener('pointerleave', (e) => { if (mouse(e)) { clearTimeout(dwellTimer); step({ type: 'leave' }) } })
        contextPress(diamond, () => { if (dragged) return; const b = diamond.getBoundingClientRect(); hover = { open: w.ring, grace: false }; showAll(w.ring, { clientX: b.right, clientY: b.bottom }) })
      }
      if (w.more) {
        const more = ringMore(w.ring, filled.includes(w.ring), (btn) => { { const cur = st().uiRings?.filled ?? []; setUi(st(), 'filled', cur.includes(w.ring) ? cur.filter((x) => x !== w.ring) : [...cur, w.ring]) } s.uiRings = st().uiRings; save(); toggle(hidden, btn.parentElement ?? wrap) })
        more.style.left = w.at.left + EXPAND_DX + 'px'; more.style.top = w.at.top + 'px'
        wrap.appendChild(more)
      }
    }
    // A name being edited keeps the card open: a tap on another dot selects it, a tap on empty space clears the selection first.
    wrap.addEventListener('pointerdown', (e) => {
      if (!editing()) { hideAll(); return }
      const hit = (e.target as HTMLElement).closest<HTMLElement>('.node:not(.you)')
      if (hit) return
      if (picked.size > 1) { picked = toggleSel(clearSelection(), [...picked][0]); markPicked() } else hideAll()
    })
    wrap.addEventListener('click', (e) => {
      const hit = editing() ? (e.target as HTMLElement).closest<HTMLElement>('.node:not(.you)') : null
      if (!hit || !hit.dataset.pid) return
      e.stopPropagation(); e.preventDefault()
      picked = toggleSel(picked, hit.dataset.pid)
      markPicked()
    }, true)
    // Wave 36b: select mode: a tap on a dot ticks it, a tap on empty space leaves the mode.
    if (selectMode && !desk) {
      const markChosen = (): void => {
        wrap.querySelectorAll<HTMLElement>('.node:not(.you)').forEach((n) => n.classList.toggle('multi-sel', chosen.has(n.dataset.pid ?? '')))
        wrap.querySelector('[data-select-count]')?.remove()
        wrap.appendChild(el('span', { class: 'multi-count select-chip', 'data-select-count': String(chosen.size), role: 'status' }, [S.multiCount(chosen.size)]))
      }
      markChosen()
      wrap.addEventListener('click', (e) => {
        const t = e.target as HTMLElement
        if (t.closest('.ring-toggle, .ring-more, .drag-bin, .select-chip, .you')) return
        e.stopPropagation(); e.preventDefault()
        if (dragged) return
        const hit = t.closest<HTMLElement>('.node:not(.you)')
        if (hit?.dataset.pid) { chosen = toggleSel(chosen, hit.dataset.pid); markChosen(); return }
        leaveSelect(); render()
      }, true)
    }
    // Wave 28b: the floating "+" moved into the TrustZones sidebar (zoneColumn), next to expand all.
    return wrap
  }

  /** The sheet "In the expanse": the hidden people, each with Bring back, and Bring all back. */
  function expanseSheet(): void {
    const people = expanseList(st())
    if (!people.length) { closeSheet(); return }
    const back = (fn: () => void): void => { fn(); save(); render(); expanseSheet() }
    openSheet([
      el('h3', {}, [S.expanseTitle]),
      el('p', { class: 'meta', 'data-expanse-count': String(people.length) }, [S.expanseCount(people.length)]),
      el('p', { class: 'meta' }, [S.expanseHint]),
      ...people.map((p) => el('div', { class: 'expanse-row' }, [
        el('span', {}, [displayName(p.name).text]),
        el('button', { class: 'btn btn-ghost btn-sm', 'data-expanse-restore-one': p.id, onclick: () => back(() => bringBack(st(), p.id)) }, [S.expanseBack]),
      ])),
      el('button', { class: 'btn btn-ghost', 'data-expanse-restore': '', onclick: () => back(() => bringAllBack(st())) }, [S.expanseBackAll]),
    ])
  }

  /** Wave 28 (was the "+" that opened the list): beside a membrane's diamond an outliner triangle. The first press fills the ring with everyone in it (a list button appears to its right, the triangle stays in place), the second folds it back to the closest few. */
  function ringMore(ring: Ring, filled: boolean, onFill: (btn: HTMLElement) => void): HTMLElement {
    // Wave 28b (Jakob): the fill control is the expand glyph, not the outliner triangle (that looks like "play").
    const fill = el('button', { type: 'button', class: 'ring-more fill-expand' + (filled ? ' on' : ''), 'data-membrane-more': ring, 'aria-pressed': String(filled), 'data-expanded': filled ? '1' : false, 'aria-label': filled ? S.zoneFillAria(S.ringLabel[ring], filled) : S.zoneExpandTitle, title: filled ? S.zoneFillAria(S.ringLabel[ring], filled) : S.zoneExpandTitle,
      style: `--rc:${toneVar(ring)}`, onpointerdown: (e: Event) => { e.stopPropagation() }, onclick: (e: Event) => { e.stopPropagation(); onFill(fill) } }, ['⛶'])
    return fill
  }

  /** Wave 28: the zzz tap(s): these people move one ring outward (their suggestion), nobody else. */
  function zzzAccept(ids: readonly string[]): void {
    if (releaseTies(st(), Date.now(), new Set(ids)).length) { save(); render() }
  }

  function loadHiddenRings(): ReadonlySet<Ring> {
    try { return parseHidden(window.localStorage.getItem(RINGS_HIDDEN_KEY)) } catch { return new Set() }
  }

  /** The small round button on a ring's guide circle at 12 o'clock: ⊖ while the ring's people show, ⊕ while they are hidden. */
  function ringToggle(ring: Ring, off: boolean, top: number, left: number, tab: boolean, onToggle: (btn: HTMLElement) => void): HTMLElement {
    const b = el('button', {
      class: 'ring-toggle' + (off ? ' off' : '') + (tab ? ' ring-tab' : ''), 'data-hide-ring': ring, 'aria-pressed': String(off), style: `--rc:${ringColor({ ring })}; left:${left}px; top:${top}px`,
      'aria-label': (off ? S.ringShowAria : S.ringHideAria)(S.ringLabel[ring]), // no title: the hover card replaces the plain tooltip (Wave 29)
      // The zoom/pan layer captures every pointer on the rings (setPointerCapture), which retargets the click away from this button.
      onpointerdown: (e: Event) => { e.stopPropagation() },
      onclick: (e: Event) => { e.stopPropagation(); onToggle(e.currentTarget as HTMLElement) },
    }, [off ? '+' : '−'])
    return b
  }

  /** Wave 36b: the select tool: while on, a tap on a dot ticks it and a drag of one ticked dot moves all ticked dots. View state only (I1). */
  let selectMode = false
  let chosen: Selection = clearSelection()
  const leaveSelect = (): void => { selectMode = false; chosen = clearSelection() }
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && selectMode) { leaveSelect(); render() } })

  /** Zoom and pan of the Web screen's content; survives render() and resets when the Web screen is left. View state only (I1). */
  let ringsZoom: RingsZoom = RINGS_ZOOM_HOME
  /** Wave 39: a ring's stroke is being dragged: the pan of the zoom layer stands back. */
  let ringLineDrag = false

  /**
   * Pinch (trackpad ctrl + wheel, Safari gestures, two fingers), pan (one pointer past 6 px at k > 1) and double tap home over the whole
   * Web screen body, and only there: outside the phone, the header and the tab bar the browser zooms as ever. Only the inner layer moves.
   */
  function zoomOnWeb(clip: HTMLElement, layer: HTMLElement): void {
    // Wave 27: the rings' fit zoom (ringsZoom, kept for the way back) must not scale a Network layer: it blew the canvas up and pushed it off-centre.
    if (layer.querySelector('[data-own-zoom]')) return
    // [data-own-zoom] (the Network view) pans and zooms itself in its draw loop, so it stays crisp: this layer leaves it alone.
    const skip = '.node, .ctx-menu, .desire, .hint-i, button, a, input, textarea, [data-own-zoom]'
    const apply = (z: RingsZoom): void => {
      ringsZoom = z
      layer.style.transform = transformOf(z)
      layer.style.setProperty('--rz', String(labelScale(z.k)))
      clip.classList.toggle('zoomed', z.k !== 1)
      layer.querySelector<HTMLElement>('.rings-wrap')?.setAttribute('data-rings-zoom', String(z.k))
    }
    apply(ringsZoom)
    const view = (): ZoomView => ({ w: layer.offsetWidth, h: layer.offsetHeight, cw: clip.clientWidth, ch: clip.clientHeight })
    // Wave 25: without the phone frame the rings fit the window once (after the layer is in the DOM); a later home (k = 1) is a copy, so it is not refit.
    if (ringsZoom === RINGS_ZOOM_HOME && currentLayout() === 'trustweb' && !solo) {
      requestAnimationFrame(() => {
        const wrap = layer.querySelector<HTMLElement>('.rings-wrap')
        if (!wrap || ringsZoom !== RINGS_ZOOM_HOME || !clip.isConnected) return
        const k = fitZoom(wrap.offsetWidth, wrap.offsetHeight, clip.clientWidth, clip.clientHeight)
        if (k > 1) apply(zoomAt(ringsZoom, k, wrap.offsetLeft + wrap.offsetWidth / 2, wrap.offsetTop + wrap.offsetHeight / 2, view()))
      })
    }
    const zoom = (factor: number, e: { clientX: number; clientY: number }): void => {
      if (ringsZoom.k === 1) clip.scrollTop = 0
      const box = layer.getBoundingClientRect()
      apply(zoomAt(ringsZoom, factor, e.clientX - box.left + ringsZoom.x, e.clientY - box.top + ringsZoom.y, view()))
    }
    clip.addEventListener('wheel', (e) => {
      if (!e.ctrlKey || (e.target as HTMLElement).closest('[data-own-zoom]')) return
      e.preventDefault()
      zoom(Math.exp(-e.deltaY * 0.01), e)
    }, { passive: false })
    let last = 1
    type Gesture = Event & { scale: number; clientX: number; clientY: number }
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
      clip.addEventListener(ev, (e) => {
        if ((e.target as HTMLElement).closest('[data-own-zoom]')) return
        e.preventDefault()
        const g = e as Gesture
        if (ev === 'gesturestart') last = 1
        else if (ev === 'gesturechange') { zoom(g.scale / last, g); last = g.scale }
      })
    }
    // A pan ends in a click on the same spot; the rings must not read it as a tap.
    let panned = false
    clip.addEventListener('click', (e) => { if (panned) e.stopPropagation() }, true)
    const down = new Map<number, { x: number; y: number }>()
    const spread = (): number => { const [a, b] = [...down.values()]; return Math.hypot(a.x - b.x, a.y - b.y) }
    let start: { x: number; y: number } | undefined
    let panning = false
    clip.addEventListener('pointerdown', (e) => {
      panned = false
      if ((e.target as HTMLElement).closest('[data-own-zoom]')) return
      down.set(e.pointerId, { x: e.clientX, y: e.clientY })
      start = down.size === 1 && !(e.target as HTMLElement).closest(skip) ? { x: e.clientX, y: e.clientY } : undefined
      if (down.size === 2) { start = undefined; clip.setPointerCapture(e.pointerId) }
    })
    clip.addEventListener('pointermove', (e) => {
      const was = down.get(e.pointerId)
      if (!was) return
      if (down.size === 2) {
        const before = spread()
        down.set(e.pointerId, { x: e.clientX, y: e.clientY })
        const [a, b] = [...down.values()]
        if (before > 0) zoom(spread() / before, { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 })
        return
      }
      if (!start || ringsZoom.k === 1 || ringLineDrag) return
      if (!panning) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 6) return
        panning = panned = true
        clip.setPointerCapture(e.pointerId)
      }
      apply(panBy(ringsZoom, e.clientX - was.x, e.clientY - was.y, view()))
      down.set(e.pointerId, { x: e.clientX, y: e.clientY })
    })
    const lift = (e: PointerEvent): void => {
      down.delete(e.pointerId)
      start = undefined
      if (panning && down.size === 0) { panning = false; setTimeout(() => { panned = false }, 0) }
    }
    clip.addEventListener('pointerup', lift)
    clip.addEventListener('pointercancel', lift)
    clip.addEventListener('dblclick', (e) => {
      if (ringsZoom.k === 1 || (e.target as HTMLElement).closest(skip)) return
      clearTimeout(addTimer)
      apply(RINGS_ZOOM_HOME)
    })
  }

  /**
   * Drag a person's circle to another ring (mouse: after 4 px; touch: after a 300 ms hold, so the page still scrolls). The drop is read
   * from the distance to the centre; "intending to connect" first asks how much (0..10, default 5). The ring is the same value the outliner
   * and the CRM use (changeRing / placeOnRing).
   */
  function dragOnRings(wrap: HTMLElement, s: AppState, setDragged: (v: boolean) => void, settled?: (personId: string, ring: Ring) => void, withBins = false): void {
    let lifted = false
    wrap.addEventListener('touchmove', (e) => { if (lifted) e.preventDefault() }, { passive: false })
    wrap.addEventListener('pointerdown', (down) => {
      const node = (down.target as HTMLElement).closest<HTMLElement>('.node:not(.you)')
      const p = s.people.find((x) => x.id === node?.dataset.pid)
      if (s.uiRings?.pinnedId && s.uiRings.pinnedId !== p?.id) s.uiRings = { ...s.uiRings, pinnedId: undefined } // wave 36b: the pin ends at the next press elsewhere
      if (!node || !p) return
      let ring = webSlot(p)
      let out = false
      let angle = angleOf(p)
      let intoExpanse = false
      let bin: BinKind | null = null
      let bins: HTMLElement | undefined
      // While a person is held, every ring guide shows in full so the drop target is visible.
      const hiddenNow = loadHiddenRings()
      const guides = (dragging: boolean): void => wrap.querySelectorAll<SVGCircleElement>('circle[data-ring]').forEach((c) => { c.style.opacity = guideDimmed(hiddenNow.has(c.getAttribute('data-ring') as Ring), dragging) ? HIDDEN_GUIDE_OPACITY : '' })
      guides(true)
      const place = (e: PointerEvent): void => {
        const { x, y } = localPoint(e, wrap.getBoundingClientRect())
        node.style.left = x + 'px'
        node.style.top = y + 'px'
        for (const l of wrap.querySelectorAll('line[data-conn]')) {
          const [a, b] = l.getAttribute('data-conn')!.split('|')
          if (a === p.id) { l.setAttribute('x1', String(x)); l.setAttribute('y1', String(y)) } else if (b === p.id) { l.setAttribute('x2', String(x)); l.setAttribute('y2', String(y)) }
        }
        const dist = Math.hypot(x - RINGS_SIZE / 2, y - RINGS_SIZE / 2) / ringsK
        angle = angleFromCentre(x - RINGS_SIZE / 2, y - RINGS_SIZE / 2)
        out = beyondRings(dist, ringsGeo)
        ring = ringAt(dist, ringsGeo.radius, ringsGeo.rings)
        // Wave 33: every control in the column takes the drop (each ring's diamond and ⛶).
        const targets = [...wrap.querySelectorAll<HTMLElement>('.ring-toggle, .ring-more')]
        const boxes = targets.map((t) => { const { left, top, right, bottom } = t.getBoundingClientRect(); return { left, top, right, bottom, t } })
        const hit = hitControls(boxes, e.clientX, e.clientY)
        const binBoxes = [...(bins?.querySelectorAll<HTMLElement>('[data-bin]') ?? [])].map((t) => { const { left, top, right, bottom } = t.getBoundingClientRect(); return { left, top, right, bottom, kind: t.dataset.bin as BinKind, t } })
        bin = binAt(binBoxes, e.clientX, e.clientY)
        for (const b of binBoxes) b.t.classList.toggle('drop', b.kind === bin)
        intoExpanse = hit !== null && bin === null
        for (const t of targets) t.classList.toggle('drop', t === hit?.t)
        wrap.classList.toggle('hide-zone', out && !intoExpanse && bin === null)
        wrap.querySelectorAll('circle').forEach((c) => c.classList.toggle('drop', !out && c.getAttribute('data-ring') === ring))
        zoneTitle(!out && !intoExpanse && bin === null ? ring : null)
      }
      // Wave 36: while a dot is held over a ring band, that ring's name sits at 12 o'clock on its line (the diamonds are at 6).
      let title: HTMLElement | undefined
      const zoneTitle = (r: Ring | null): void => {
        if (!r) { title?.remove(); title = undefined; return }
        if (title?.dataset.zoneTitle === r) return
        title?.remove()
        title = el('span', { class: 'zone-title', 'data-zone-title': r }, [S.ringLabel[r]])
        title.style.left = RINGS_SIZE / 2 + 'px'; title.style.top = RINGS_SIZE / 2 - ringsGeo.radius[r] * ringsK + 'px'
        wrap.appendChild(title)
      }
      // Hold on another dot: after HOLD_MS a bubble offers to merge the two (dot_merge.ts); only a tap on Merge goes on.
      let hold = holdStart()
      let holdTimer: number | undefined
      // Wave 36: the offer counts 3-2-1 and merges by itself; leaving the dot, releasing or Escape cancels.
      const countdown = createCountdown()
      let countTimer: number | undefined
      let cancelled = false
      const stopCount = (): void => { clearInterval(countTimer); countTimer = undefined; countdown.cancel() }
      const holdApply = (ev: HoldEvent): void => {
        const was = hold.phase
        hold = holdStep(hold, ev)
        if (hold.phase === 'offer' && was !== 'offer') {
          const over = hold.over
          let shown = 0
          countdown.start(performance.now())
          const step = (): void => {
            const t = countdown.tick(performance.now())
            if (t.fire) { stopCount(); mergeDrop(over); return }
            if (t.secondsLeft !== shown) { shown = t.secondsLeft; offerMerge(p, over, shown, () => { stopCount(); mergeDrop(over) }, () => { cancelled = true; holdApply({ type: 'leave' }) }) }
          }
          step()
          countTimer = window.setInterval(step, 200)
        } else if (hold.phase !== 'offer' && was === 'offer') { stopCount(); hideNotice() }
      }
      const mergeDrop = (otherId: string): void => {
        // The finger is still down: the dot stays "dragged" until it lifts, so the release is no tap that opens the merged-away card.
        hideNotice(); end(); lifted = false
        const release = (): void => { window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release); setTimeout(() => setDragged(false), 0) }
        window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release)
        deps.mergeNow?.(otherId, p.id)
        done()
      }
      const onEscape = (e: KeyboardEvent): void => { if (e.key === 'Escape' && hold.phase !== 'none') { cancelled = true; holdApply({ type: 'leave' }) } }
      window.addEventListener('keydown', onEscape)
      const holdMove = (e: PointerEvent): void => {
        if (!holdEnabled({ canMerge: Boolean(mergeSheet), groupSize: selectMode && chosen.has(p.id) ? chosen.size : 1 })) return
        const dots = [...wrap.querySelectorAll<HTMLElement>('.node:not(.you)')].map((n) => { const r = n.getBoundingClientRect(); return { id: n.dataset.pid ?? '', left: r.left, top: r.top, right: r.right, bottom: r.bottom } })
        const now = performance.now()
        clearTimeout(holdTimer)
        const over = hitDot(dots, p.id, e.clientX, e.clientY)
        if (over === null) cancelled = false
        holdApply({ type: 'move', over: cancelled ? null : over, at: now })
        if (hold.phase === 'pending') holdTimer = window.setTimeout(() => holdApply({ type: 'elapsed', at: performance.now() }), Math.max(0, hold.since + HOLD_MS - now))
      }
      const lift = (): void => {
        lifted = true; node.classList.add('lifted'); setDragged(true)
        if (withBins) {
          const mk = (kind: BinKind, icon: string, word: string, aria: string): HTMLElement => el('span', { class: 'drag-bin', 'data-bin': kind, role: 'img', 'aria-label': aria }, [el('b', {}, [icon]), el('small', {}, [word])])
          bins = el('div', { class: 'drag-bins' }, [mk('archive', '🗃', S.binArchive, S.binArchiveAria), mk('remove', '🗑', S.binRemove, S.binRemoveAria)])
          wrap.appendChild(bins)
        }
      }
      const timer = down.pointerType === 'mouse' ? 0 : window.setTimeout(lift, 300)
      // A second finger is a pinch: the lift ends without moving the dot.
      const second = (e: PointerEvent): void => { if (!e.isPrimary) cancel() }
      wrap.addEventListener('pointerdown', second)
      const move = (e: PointerEvent): void => {
        if (!lifted) {
          if (!dragStarts(e.clientX - down.clientX, e.clientY - down.clientY, Boolean(timer))) return
          if (timer) { end(); return }
          lift()
        }
        place(e)
        holdMove(e)
      }
      const end = (): void => {
        clearTimeout(timer)
        clearTimeout(holdTimer)
        stopCount()
        window.removeEventListener('keydown', onEscape)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', cancel)
        wrap.removeEventListener('pointerdown', second)
        guides(false)
        wrap.querySelectorAll('circle.drop').forEach((c) => c.classList.remove('drop'))
        wrap.classList.remove('hide-zone')
        wrap.querySelectorAll('.ring-toggle.drop, .ring-more.drop').forEach((c) => c.classList.remove('drop'))
        bins?.remove()
        zoneTitle(null)
      }
      // The Desk's lent rings redraw from the Desk (settled), the phone's from render() inside each path.
      const done = (): void => settled?.(p.id, p.ring)
      const cancel = (): void => { const was = lifted; holdApply({ type: 'leave' }); end(); lifted = false; setDragged(false); if (was) { render(); done() } }
      const up = (): void => {
        const was = lifted
        const offered = hold.phase === 'offer'
        end(); lifted = false
        setTimeout(() => setDragged(false), 0)
        if (!was) return
        s.uiRings = { ...s.uiRings, pinnedId: p.id } // wave 36b: the dropped dot stays drawn beside the cut
        if (s.uiRings?.autoAdjust) { // wave 37: opted in: the cut re-applies, dots fade in and out
          if (shownNow) {
            fade = { prev: new Set(shownNow), moved: p.id }
            clearTimeout(fadeTimer)
            const settle = (): void => { if (lifted) { fadeTimer = setTimeout(settle, 500); return } fade = null; render() }
            fadeTimer = setTimeout(settle, 1300)
          }
        } else if (shownNow) s.uiRings = { ...s.uiRings, shown: { key: shownKey(limitOf(s), s.uiRings?.rankBy, s.uiRings?.perRingLimitOff, s.uiRings?.filled ?? []), ids: [...shownNow, p.id], at: Date.now() } } // wave 37: nothing else moves
        if (selectMode && !offered) {
          const ids = new Set(dragIds(chosen, p.id))
          const group: Person[] = []
          applyAll(s.people, ids, (q) => group.push(q))
          selectedDrop(group, { bin, expanse: intoExpanse, outcome: dropOutcome(p, ring, out), ring, angle: avoidSector(angle, keepOutColumn(ringsGeo.radius[ring] * ringsK, (ringsGeo.dot[ring] * ringsK) / 2)), dragged: p })
          done()
          return
        }
        if (bin !== null) {
          if (binDrop(bin, p).do === 'archive') { archivePerson(p); save(); render(); archivedUndo([p]) } else removeNow([p])
          done()
          return
        }
        if (intoExpanse) { hideInExpanse(s, p.id); save(); render(); done(); return }
        // Released while the merge offer shows: the dot goes back, nothing moves or merges.
        if (offered) { render(); done(); return }
        const outcome = dropOutcome(p, ring, out)
        angle = avoidSector(angle, keepOutColumn(ringsGeo.radius[ring] * ringsK, (ringsGeo.dot[ring] * ringsK) / 2))
        if (outcome === 'hide') { void hideOnRings(p).then(done); return }
        if (outcome === 'family-stays') { render(); done(); return }
        // The dot keeps the angle it was dropped at.
        if (outcome === 'same-ring') { p.angle = angle; save(); render(); done(); return }
        if (outcome === 'unplace') { p.angle = angle; unplaceOnRings(p); done(); return }
        if (outcome === 'ask-desire') askDesire(wrap, p, intendingReminder(displayName(p.name).text, knownWays(p), lastMessagedAt(s.chats?.[p.peerId ?? ''])), () => { render(); done() }, (v) => { p.angle = angle; dropOn(p, ring, v); done() })
        else { p.angle = angle; dropOn(p, ring); done() }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', cancel)
    })
  }

  /** Wave 36b: a drag in select mode applies its drop to every ticked dot (dragged one included), in list order, with one Undo (5 s for one dot, 10 s for several). Dots never merge here. */
  function selectedDrop(ps: readonly Person[], d: { bin: BinKind | null; expanse: boolean; outcome: DropOutcome; ring: Ring; angle: number; dragged: Person }): void {
    chosen = clearSelection()
    const undoBtn = (attr: string, run: () => void): HTMLElement => el('button', { class: 'btn btn-ghost btn-sm', [attr]: ps.map((p) => p.id).join(','), 'data-undo-multi': ps.length > 1 ? '' : false, onclick: () => { hideNotice(); run(); save(); render() } }, [S.ringsHiddenUndo])
    if (d.bin === 'remove') { removeNow(ps); return }
    if (d.bin === 'archive') { for (const p of ps) archivePerson(p); save(); render(); archivedUndo(ps); return }
    if (d.expanse || d.outcome === 'hide') {
      const before = [...(st().expanse ?? [])]
      for (const p of ps) hideInExpanse(st(), p.id)
      save(); render()
      showNotice(S.selectInExpanse(ps.length), '', [undoBtn('data-undo-expanse', () => { if (before.length) st().expanse = before; else delete st().expanse })], undoMs(ps.length))
      return
    }
    const was = ps.map((p) => ({ p, ring: p.ring, intending: p.intending, ringSuggested: p.ringSuggested, angle: p.angle }))
    for (const p of ps) {
      if (p.ring === Ring.Family || webSlot(p) === d.ring) { if (p === d.dragged && p.ring !== Ring.Family) p.angle = d.angle; continue }
      changeRing(p, d.ring); ringToTana(p, d.ring)
      placeOnRing(p, d.ring, Date.now())
      delete p.ringSuggested
      if (p === d.dragged) p.angle = d.angle
    }
    save(); render()
    showNotice(S.selectMoved(ps.length, S.ringLabel[d.ring].toLowerCase()), '', [undoBtn('data-undo-move', () => {
      for (const w of was) {
        if (w.p.ring !== w.ring) { changeRing(w.p, w.ring); ringToTana(w.p, w.ring) }
        w.p.intending = w.intending; if (w.intending === undefined) delete w.p.intending
        w.p.ringSuggested = w.ringSuggested; if (w.ringSuggested === undefined) delete w.p.ringSuggested
        w.p.angle = w.angle; if (w.angle === undefined) delete w.p.angle
      }
    })], undoMs(ps.length))
  }

  /** Dropped on the archive box (or archive with several selected): the toast says where they went; Undo (5 s, 10 s for several) puts them back on the ring they had. */
  function archivedUndo(ps: readonly Person[]): void {
    showNotice(S.archivedToast, '', [
      el('button', { class: 'btn btn-ghost btn-sm', 'data-undo-archive': ps.map((p) => p.id).join(','), 'data-undo-multi': ps.length > 1 ? '' : false, onclick: () => { hideNotice(); for (const p of ps) restorePerson(p); save(); render() } }, [S.ringsHiddenUndo]),
    ], undoMs(ps.length))
  }

  /** Dropped on the dustbin or ✕ with a selection: deleted at once (a tombstone, deleted_people.ts); Undo for 5 s (10 s for several), and Settings keeps them 30 days. Nobody else moves. */
  function removeNow(ps: readonly Person[]): void {
    for (const p of ps) deletePersonSoft(p, Date.now())
    save(); render()
    showNotice(ps.length === 1 ? S.deletedToast(displayName(ps[0].name).text) : S.deletedToastMany(ps.length), '', [
      el('button', { class: 'btn btn-ghost btn-sm', 'data-undo-delete': ps.map((p) => p.id).join(','), 'data-undo-multi': ps.length > 1 ? '' : false, onclick: () => { hideNotice(); for (const p of ps) putBack(p); save(); render() } }, [S.undo]),
    ], undoMs(ps.length))
  }

  /** The bubble "Merging A into B … n" (wave 36): nobody presses Yes; staying put merges at 0, the major dot B keeps its name. */
  function offerMerge(p: Person, otherId: string, n: number, yes: () => void, cancel: () => void): void {
    const other = st().people.find((x) => x.id === otherId)
    if (!other || !mergeSheet) return
    showNotice(S.mergeCountdownLead(displayName(p.name).text, displayName(other.name).text), '', [el('span', { class: 'merge-actions' }, [
      el('span', { class: 'countdown-num', 'data-merge-offer': '1', 'data-merge-countdown': String(n) }, [String(n)]),
      el('button', { class: 'btn btn-ghost btn-sm merge-btn', 'data-merge-yes': '', 'aria-label': S.mergeYes, title: S.mergeYes, onclick: yes }, ['✓']),
      el('button', { class: 'btn btn-ghost btn-sm merge-btn', 'data-merge-cancel': '', 'aria-label': S.mergeCancel, title: S.mergeCancel, onclick: cancel }, ['✕']),
    ])], 20000)
  }

  /** "Recently deleted": the deleted people of the last 30 days, each with Put back and the days left. */
  function deletedSheet(): void {
    const now = Date.now()
    const people = recentlyDeleted(st().people, now)
    const back = (p: Person): void => { putBack(p); save(); render(); deletedSheet() }
    openSheet([
      el('h3', {}, [S.recentlyDeletedTitle]),
      el('p', { class: 'meta' }, [S.recentlyDeletedHint]),
      ...people.map((p) => el('div', { class: 'expanse-row', 'data-deleted-row': p.id }, [
        el('span', {}, [displayName(p.name).text, ' ', el('small', { class: 'meta' }, [S.restoreDaysLeft(daysLeft(p, now))])]),
        el('button', { class: 'btn btn-ghost btn-sm', 'data-put-back': p.id, onclick: () => back(p) }, [S.putBack]),
      ])),
    ])
  }

  /** Right click, or a 500 ms hold that moved under 6 px, on empty web space or a ring line: a small menu to space the dots out equally. */
  function ringsMenuOn(wrap: HTMLElement, setHeld: (v: boolean) => void): void {
    let timer: ReturnType<typeof setTimeout> | undefined
    let from = { x: 0, y: 0 }
    const open = (e: MouseEvent): void => {
      const at = localPoint(e, wrap.getBoundingClientRect())
      const { near, onLine } = menuTarget(at, ringsGeo, ringsK)
      const item = (label: string, ring?: Ring): HTMLElement => el('button', { class: 'btn btn-ghost btn-sm', 'data-space-out': ring ?? 'all', onclick: () => spaceOutWeb(ring) }, [label])
      wrap.querySelector('.ctx-menu')?.remove()
      const menu = el('div', { class: 'ctx-menu', role: 'menu' }, [onLine ? item(S.ringsSpaceRing(S.ringLabel[near].toLowerCase()), near) : null, item(S.ringsSpaceAll)])
      const place = menuPlace(at)
      menu.style.left = place.left + 'px'
      menu.style.top = place.top + 'px'
      wrap.appendChild(menu)
      document.addEventListener('pointerdown', (d) => { if (!menu.contains(d.target as Node)) menu.remove() }, { once: true })
    }
    const stop = (): void => { clearTimeout(timer); timer = undefined }
    wrap.addEventListener('pointerdown', (e) => {
      setHeld(false)
      if (!e.isPrimary) { stop(); return }
      if ((e.target as HTMLElement).closest('.node, .ctx-menu, .desire, .hint-i') || e.pointerType === 'mouse') return
      from = { x: e.clientX, y: e.clientY }
      timer = setTimeout(() => { timer = undefined; setHeld(true); navigator.vibrate?.(15); open(e) }, 500)
    })
    wrap.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 6) stop() })
    for (const ev of ['pointerup', 'pointercancel']) wrap.addEventListener(ev, stop)
    wrap.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      if (!(e.target as HTMLElement).closest('.node')) open(e)
    })
  }

  /** Spaces the dots out equally (one ring, or all); Undo for 30 s restores every angle. */
  function spaceOutWeb(ring?: Ring): void {
    const s = st()
    const before = spaceOut(s, ring, (a, r) => avoidSector(a, keepOutColumn(ringsGeo.radius[r] * ringsK, (ringsGeo.dot[r] * ringsK) / 2)))
    save()
    render()
    showNotice(S.ringsSpaced, '', [
      el('button', { class: 'btn btn-ghost btn-sm', 'data-undo-space': '', onclick: () => { hideNotice(); restoreAngles(st(), before); save(); render() } }, [S.ringsHiddenUndo]),
    ], 30000)
  }

  /** A person dragged beyond the outermost ring: hidden like "hide in trustweb" (Curator Settings lists them, with unhide); Undo for 5 s. */
  function hideOnRings(p: Person): Promise<void> {
    const name = displayName(p.name).text
    return curator.hide(p.id).then(() => {
      showNotice(S.ringsHidden(name), S.ringsHiddenBody, [
        el('button', { class: 'btn btn-ghost btn-sm', 'data-undo-hide': p.id, onclick: () => { hideNotice(); void curator.unhide(p.id) } }, [S.ringsHiddenUndo]),
      ], UNDO_SINGLE_MS)
    })
  }

  /** A Web view ring change goes on to Tana through the Curator's sync; the real record only (no solo, demo persona or test account). */
  function ringToTana(p: Person, ring: Ring): void {
    if (demoPhone()) return
    curator.ring(p.id, ring).catch((e: unknown) => console.warn('ring to Tana', e))
  }

  /** A placed person dragged out to the unsorted ring: back to "not placed yet"; Undo for 30 s restores the ring (and its intending value). */
  function unplaceOnRings(p: Person): void {
    const name = displayName(p.name).text
    const { ring, intending } = p
    changeRing(p, Ring.Unsorted)
    ringToTana(p, Ring.Unsorted)
    placeOnRing(p, Ring.Unsorted, Date.now())
    save()
    render()
    showNotice(S.ringsUnplaced(name), S.ringsUnplacedBody, [
      el('button', { class: 'btn btn-ghost btn-sm', 'data-undo-unplace': p.id, onclick: () => { hideNotice(); changeRing(p, ring); ringToTana(p, ring); p.intending = intending; if (!intending) delete p.intending; save(); render() } }, [S.ringsHiddenUndo]),
    ], 30000)
  }

  function dropOn(p: Person, ring: Ring, desire?: number): void {
    const { ring: was, intending, ringSuggested } = p
    if (p.ring === Ring.Family) save()
    else { changeRing(p, ring); ringToTana(p, ring) }
    placeOnRing(p, ring, Date.now(), desire)
    delete p.ringSuggested
    save()
    render()
    if (!ringSuggested) { toast(`${displayName(p.name).text}: ${S.ringLabel[ring].toLowerCase()}`); return }
    // A grey (suggested) dot dropped on a ring confirms it; Undo for 30 s puts the suggestion back.
    showNotice(S.ringsConfirmed(displayName(p.name).text, S.ringLabel[ring].toLowerCase()), '', [
      el('button', { class: 'btn btn-ghost btn-sm', 'data-undo-confirm': p.id, onclick: () => {
        hideNotice(); changeRing(p, was); ringToTana(p, was); p.intending = intending; if (!intending) delete p.intending; p.ringSuggested = true; save(); render()
      } }, [S.ringsHiddenUndo]),
    ], 30000)
  }

  /** The 0 to 10 chip row for "intending to connect" (default 5); nothing changes until "Move here". */
  function askDesire(wrap: HTMLElement, p: Person, reminder: string[], cancel: () => void, done: (value: number) => void): void {
    let value = DESIRE_DEFAULT
    const row = el('div', { class: 'desire', role: 'group', 'aria-label': S.desireAsk(displayName(p.name).text) })
    // A chip is replaced by draw() and Move here by render() while the click is still bubbling: the web's "add someone" tap must not see it.
    row.addEventListener('click', (e) => e.stopPropagation())
    const draw = (): void => row.replaceChildren(
      el('p', {}, [S.desireAsk(displayName(p.name).text)]),
      ...reminder.map((line) => el('p', { class: 'reminder', 'data-intending-reminder': '' }, [line])),
      el('div', { class: 'rchips' }, Array.from({ length: 11 }, (_, n) => el('button', {
        class: 'rchip' + (n === value ? ' on' : ''), style: `--rc:${ringColor({ ring: Ring.Intending })}`, 'aria-pressed': String(n === value),
        onclick: () => { value = n; draw() },
      }, [String(n)]))),
      el('div', { class: 'desire-go' }, [
        el('button', { class: 'btn btn-sm', onclick: () => done(value) }, [S.desireMove]),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: cancel }, [S.desireCancel]),
      ]),
    )
    draw()
    wrap.appendChild(row)
  }

  /**
   * Tap on empty space in the web: "Add someone to your web?". The ring is
   * preselected by how far from you the tap landed. Works while the rings are
   * scaled for the query dock, because it measures the rendered box.
   */
  function onRingsTap(e: MouseEvent, wrap: HTMLElement): void {
    if ((e.target as HTMLElement).closest('.node, .ctx-menu, [data-conn-hit], [data-rel-card]')) return
    ripple(e)
    const at = localPoint(e, wrap.getBoundingClientRect())
    const dx = at.x - RINGS_SIZE / 2
    const dy = at.y - RINGS_SIZE / 2
    const dist = Math.hypot(dx, dy)
    const ring = nearestRing(dist, ringsGeo, ringsK)
    // Let the ripple show before the sheet rises over it.
    clearTimeout(addTimer)
    addTimer = setTimeout(() => addPersonSheet(ring), RIPPLE_LEAD_MS)
  }

  let addTimer: ReturnType<typeof setTimeout> | undefined
  return {
    ringsView,
    zoomOnWeb,
    resetZoom: () => { ringsZoom = RINGS_ZOOM_HOME },
    hideOnRings,
    ringToTana,
    spaceOutWeb,
    openExpanse: expanseSheet,
    openDeleted: deletedSheet,
    toggleSelect: () => { if (selectMode) leaveSelect(); else selectMode = true; return selectMode },
    selectOn: () => selectMode,
    deleteReversibly: removeNow,
  }
}
