// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43b ask-page-filter (Tana A5, A6, A7): the ONE audience filter of every "find someone in your network" place (ask for support, hints,
 * intros): the zones on top as "this zone and more intimate", below them Also include / Hide from rows (type "@" for people, "#" for tags),
 * and under Advanced the degree (reach) and Public. The pure part decides who is reached; `audienceFilterView` draws the control.
 */
import { el } from '../../demo/src/ui/dom'
import { loadColourTags, saveColourTags } from './colour_tags'
import type { ColourTag } from './colour_tags'
import { Ring } from './model'
import type { Person } from './model'
import { foldText } from './settings_search'
import { S } from './strings'
import { audience } from './support_ask'
import { ZONES } from './audience_zones'
import type { AudienceFilter, Zone, Degree } from './audience_zones'
import { addTagTo } from './card_small'
import { createTag } from './tag_create'

/** What a form adds to the stored filter: a community scope (its tag) and the support-only "not Closest few" switch. */
export interface FilterExtras { only?: string; notClosest?: boolean }

const RING_OF: Record<Zone, Ring> = { closest: Ring.Closest, close: Ring.Close, friend: Ring.Friend }

export const ringOfZone = (z: Zone): Ring => RING_OF[z]
/** The zone a ring stands for; null for a ring that is no zone. */
export const zoneOfRing = (r: unknown): Zone | null => ZONES.find((z) => RING_OF[z] === r) ?? null

export const zonesWithin = (cut: Zone): Zone[] => ZONES.slice(0, ZONES.indexOf(cut) + 1)

/** P2 (greyscale screens): the picked zone is 'on', the narrower ones it includes 'in', wider ones 'off' (struck through). No zone = everybody: all 'in'. */
export const zoneState = (z: Zone, cut: Zone | undefined): 'on' | 'in' | 'off' => (!cut ? 'in' : z === cut ? 'on' : zonesWithin(cut).includes(z) ? 'in' : 'off')

/** I7: someone is hidden and the ask travels beyond my direct contacts (any reach but 1): a friend may still pass it on to the hidden person. */
export const hideLeaks = (f: { exclude: readonly string[]; degree: number }): boolean => f.exclude.length > 0 && f.degree !== 1

type Who = Pick<Person, 'id' | 'ring' | 'fields' | 'peerId'>

/** The connected people the filter reaches: the zone cut (Closest few always in), plus the added people and tags, minus the hidden ones. */
export function peopleFor<T extends Who>(f: AudienceFilter & FilterExtras, people: readonly T[], hasTag: (p: T, tag: string) => boolean): T[] {
  const idsOf = (chips: readonly string[]): string[] => chips.flatMap((c) => (c.startsWith('person:') ? [c.slice(7)] : people.filter((p) => hasTag(p, c.slice(4))).map((p) => p.id)))
  const exclude = idsOf(f.exclude)
  if (!f.zone) return people.filter((p) => p.peerId && !exclude.includes(p.id))
  return audience(people, { zone: f.only ? `tag:${f.only}` : `ring:${RING_OF[f.zone]}`, ...(f.notClosest ? { notClosest: true } : {}), include: idsOf(f.add), exclude }, hasTag)
}

/** "friends of friends", "acquaintances of acquaintances": the zone's own word, repeated per degree. */
export function degreeLabel(zone: Zone, degree: Degree): string {
  const w = S.askPage.degreeWord[zone]
  return Array.from({ length: degree }, () => w).join(' of ')
}

export interface Suggestion { kind: 'person' | 'tag' | 'create'; id?: string; label: string }

/** What the box offers while typing: "@x" people, "#x" tags (plus a "Create tag" row when none is named exactly like it), plain text both. */
export function suggest(q: string, people: readonly Pick<Person, 'id' | 'name'>[], tags: readonly ColourTag[], chosen: readonly string[] = []): Suggestion[] {
  const mark = q.startsWith('@') ? '@' : q.startsWith('#') ? '#' : ''
  const raw = q.slice(mark.length).trim()
  const w = foldText(raw)
  const out: Suggestion[] = []
  if (mark !== '#') out.push(...people.filter((p) => !chosen.includes(`person:${p.id}`) && foldText(p.name).includes(w)).slice(0, 6).map((p) => ({ kind: 'person' as const, id: p.id, label: p.name })))
  if (mark !== '@') out.push(...tags.filter((t) => !chosen.includes(`tag:${t.id}`) && foldText(t.label ?? t.id).includes(w)).slice(0, 6).map((t) => ({ kind: 'tag' as const, id: t.id, label: t.label ?? t.id })))
  if (mark === '#' && raw && !tags.some((t) => foldText(t.label ?? t.id) === w)) out.push({ kind: 'create', label: raw })
  return out
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const clip = (s: string): string => (s.length > 12 ? s.slice(0, 11) + '…' : s)

/** A7: you -> ring -> ring -> ring with the reached steps highlighted; `sets` (custom) draws the added and hidden names as chips under the rings. Plain SVG text, every label escaped. */
export function stepsDiagram(steps: number, labels: { you: string; ring: (n: number) => string; alt: (n: number) => string }, sets?: { add: readonly string[]; exclude: readonly string[] }): string {
  const on = Math.min(3, Math.max(1, steps))
  const nodes = [0, 1, 2, 3].map((i) => {
    const x = 28 + i * 80
    const cls = i === 0 ? 'you' : i <= on ? 'on' : 'off'
    const mark = i === 0 ? '' : i <= on ? ' data-step-on' : ' data-step-off'
    return `${i ? `<line x1="${x - 56}" y1="40" x2="${x - 24}" y2="40" class="arrow"/>` : ''}<circle cx="${x}" cy="40" r="22" class="node ${cls}"${mark}/><text x="${x}" y="44" text-anchor="middle" class="lbl">${esc(clip(i === 0 ? labels.you : labels.ring(i)))}</text>`
  }).join('')
  const more = steps > 3 ? '<text x="300" y="46" class="lbl" data-step-more>…</text>' : ''
  const chip = (names: readonly string[], row: number, kind: 'add' | 'exclude'): string => names.length
    ? `<g data-set-${kind} class="set ${kind}">${names.slice(0, 3).map((n, i) => `<text x="${8 + i * 92}" y="${84 + row * 20}">${kind === 'add' ? '+' : '−'} ${esc(clip(n))}</text>`).join('')}${names.length > 3 ? `<text x="${8 + 3 * 92}" y="${84 + row * 20}">+${names.length - 3}</text>` : ''}</g>` : ''
  const rows = (sets?.add.length ? 1 : 0) + (sets?.exclude.length ? 1 : 0)
  const body = sets ? chip(sets.add, 0, 'add') + chip(sets.exclude, sets.add.length ? 1 : 0, 'exclude') : ''
  const alt = esc(labels.alt(steps))
  return `<svg class="steps-diagram" viewBox="0 0 320 ${76 + rows * 20 + 8}" role="img" aria-label="${alt}" data-steps-diagram="${steps}"><title>${labels.alt(steps)}</title>${nodes}${more}${body}</svg>`
}

export interface FilterView {
  /** The filter as it stands (the form keeps it; the view edits it in place and calls `changed`). */
  filter: AudienceFilter & FilterExtras
  people: () => readonly Pick<Person, 'id' | 'name' | 'fields' | 'ring'>[]
  changed: () => void
  /** Hints and intros: the zone can be un-picked (= everybody); support always has one. */
  zoneRequired: boolean
  /** Inside Advanced: the form's own controls (the "not Closest few" switch). */
  advanced: readonly (Node | null)[]
  /** Wave 44: controls on the main form, under the Hide from row (the "How far?" chooser). */
  main?: readonly (Node | null)[]
  /** Overlay for "Create tag": hands over the rows to show; main.ts supplies the sheet. */
  openSheet: (children: (Node | null)[]) => void
  closeSheet: () => void
  /** How far the ask travels (askReachOf); absent = direct contacts only (the support ask). */
  steps?: number
}

const tagName = (id: string, tags: readonly ColourTag[]): string => tags.find((t) => t.id === id)?.label ?? id

function zoneBar(v: FilterView): HTMLElement {
  const f = v.filter
  return el('div', { class: 'afv-zones', 'data-aud-zones': '' }, [
    el('p', { class: 'chips-lbl' }, [S.askPage.zonesLbl]),
    el('div', { class: 'seg afv-seg', role: 'group', 'aria-label': S.askPage.zoneAria }, ZONES.map((z) => el('button', {
      class: { on: 'on', in: 'in', off: 'tw-off' }[zoneState(z, f.zone)], type: 'button', 'data-aud-zone': z, 'data-aud-zone-state': zoneState(z, f.zone), 'aria-pressed': String(z === f.zone),
      onclick: () => { f.zone = z === f.zone && !v.zoneRequired ? undefined : z; v.changed() },
    }, [S.ringLabel[RING_OF[z]]]))),
    el('p', { class: 'hint', 'data-aud-zone-hint': '' }, [S.askPage.zoneHint]),
  ])
}

/** The small overlay of "Create tag '<x>'": pick the people, the tag is made and added to the row. */
function newTagSheet(v: FilterView, label: string, done: (t: ColourTag) => void): void {
  const picked = new Set<string>()
  const list = v.people().map((p) => el('button', {
    class: 'chip', type: 'button', 'aria-pressed': 'false', 'data-aud-new-person': p.id,
    onclick: (e) => { const b = e.currentTarget as HTMLElement; if (picked.delete(p.id)) b.classList.remove('on'); else { picked.add(p.id); b.classList.add('on') } b.setAttribute('aria-pressed', String(picked.has(p.id))) },
  }, [p.name]))
  v.openSheet([
    el('h3', {}, [S.askPage.newTagTitle(label)]),
    el('p', { class: 'chips-lbl' }, [S.askPage.newTagPick]),
    el('div', { class: 'chips', 'data-aud-new-people': '' }, list),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn btn-electric', type: 'button', 'data-aud-new-save': '', onclick: () => {
        const tags = loadColourTags()
        const tag = createTag(tags, label)
        saveColourTags([...tags, tag])
        for (const p of v.people()) if (picked.has(p.id)) addTagTo(p as Pick<Person, 'fields'>, tag.id)
        v.closeSheet()
        done(tag)
      } }, [S.askPage.newTagSave]),
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: v.closeSheet }, [S.askPage.newTagCancel]),
    ]),
  ])
}

/** One of the two rows: its chips, the "@ / #" box and the suggestions under it. */
function chipRow(v: FilterView, kind: 'add' | 'exclude'): HTMLElement {
  const f = v.filter
  const chips = f[kind]
  const tags = loadColourTags()
  const nameOf = (c: string): string => (c.startsWith('person:') ? v.people().find((p) => p.id === c.slice(7))?.name ?? '' : '#' + tagName(c.slice(4), tags))
  const found = el('div', { class: 'afv-found', 'data-aud-found': kind })
  const input = el('input', { class: 'field', type: 'search', autocomplete: 'off', placeholder: S.askPage.typePh, 'aria-label': kind === 'add' ? S.askPage.addLbl : S.askPage.excludeLbl, 'data-aud-input': kind }) as HTMLInputElement
  const take = (chip: string): void => {
    const other = kind === 'add' ? f.exclude : f.add
    if (other.includes(chip)) other.splice(other.indexOf(chip), 1)
    if (!chips.includes(chip)) chips.push(chip)
    input.value = ''
    v.changed()
  }
  const draw = (): void => {
    const q = input.value.trim()
    const rows = q ? suggest(q, v.people(), tags, [...f.add, ...f.exclude]) : []
    found.replaceChildren(...rows.map((s) => s.kind === 'create'
      ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-aud-create': s.label, onclick: () => newTagSheet(v, s.label, (t) => take(`tag:${t.id}`)) }, [S.askPage.createTag(s.label)])
      : el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-aud-pick': `${s.kind}:${s.id}`, onclick: () => take(`${s.kind}:${s.id}`) }, [(s.kind === 'tag' ? '#' : '@') + s.label])))
  }
  input.addEventListener('input', draw)
  return el('div', { class: 'afv-row', 'data-aud-row': kind }, [
    el('p', { class: 'chips-lbl' }, [kind === 'add' ? S.askPage.addLbl : S.askPage.excludeLbl]),
    chips.length ? el('div', { class: 'chips', 'data-aud-chips': kind }, chips.map((c) => el('button', {
      class: 'chip on', type: 'button', 'aria-label': S.askPage.remove(nameOf(c)), 'data-aud-chip': c,
      onclick: () => { chips.splice(chips.indexOf(c), 1); v.changed() },
    }, [nameOf(c) + ' ×']))) : null,
    input,
    found,
  ])
}

/** Advanced stays open across the redraws a choice causes (the dock is rebuilt on every change). */
let advancedOpen = false
function advancedBox(v: FilterView): HTMLElement {
  const d = el('details', { class: 'afv-adv', 'data-aud-advanced': '', ...(v.advanced.some((n) => n) ? {} : { hidden: '' }) }, [el('summary', {}, [S.askPage.advanced]), ...v.advanced]) as HTMLDetailsElement
  d.open = advancedOpen
  d.addEventListener('toggle', () => { advancedOpen = d.open })
  return d
}

/** The filter view: zones, Also include, Hide from, Advanced. One component for support, hints and intros. */
export function audienceFilterView(v: FilterView): HTMLElement {
  const f = v.filter
  const tags = loadColourTags()
  return el('div', { class: 'afv-filter', 'data-aud-filter': '' }, [
    zoneBar(v),
    f.only ? el('div', { class: 'chips', 'data-aud-only': f.only }, [el('button', {
      class: 'chip on', type: 'button', 'aria-label': S.askPage.remove('#' + tagName(f.only, tags)),
      onclick: () => { delete f.only; v.changed() },
    }, [S.askPage.onlyTag(tagName(f.only, tags)) + ' ×'])]) : null,
    chipRow(v, 'add'),
    chipRow(v, 'exclude'),
    ...(v.main ?? []),
    hideLeaks({ exclude: f.exclude, degree: v.steps ?? 1 }) ? el('p', { class: 'hint', 'data-aud-hide-travels': '' }, [S.askPage.hideTravels]) : null,
    advancedBox(v),
  ].filter((n): n is HTMLElement => n !== null))
}

export { DEFAULT_FILTER, PUBLIC_ASK_ENABLED, ZONES, parseFilter } from './audience_zones'
export type { AudienceFilter, Degree, Zone } from './audience_zones'
