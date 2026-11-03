/**
 * "My profile" sheet and the block a connected person's card shows (wave 7; E3: six sections, each with one "Who sees this" scope).
 * DOM and words only: the rules are profile.ts (scopeOf, sliceForViewer, previewSection), the scope editor is scope_editor_view.ts,
 * the summary words scope_summary.ts; what is saved is the caller's business (`commit` saves and redraws).
 */
import { el } from '../../demo/src/ui/dom'
import { CITY_MAX } from './ask_examples'
import { Audience } from './model'
import type { InventoryItem } from './model'
import { NORMS, Norm, ONE_MAX, SECTION_FIELDS, SECTION_KEYS, isStale, previewSection, scopeOf, sliceForViewer } from './profile'
import type { Dated, MyProfile, OneKey, ProfileSection, SectionKey, SharedProfile } from './profile'
import { ZONE_CHOICES, candidates, type Basis, type Candidate } from './share_page'
import type { Scope } from './share_sink/share_lines'
import { Zone } from './share_sink/zones'
import { labelFor, scopeEditor } from './scope_editor_view'
import { VIEWER_ZONES, scopeSummary, viewerOf } from './scope_summary'
import { S } from './strings'

export interface ProfileViewDeps {
  profile: () => MyProfile
  inventory: () => readonly InventoryItem[]
  now: () => number
  /** Saves the profile after a change; the sheet redraws. */
  commit: () => void
  addNorm: (norm: Norm, text: string) => void
  removeNorm: (index: number) => void
  setOne: (key: OneKey, text: string) => void
  /** E3: who sees a section (profile.ts setScope); the caller's commit saves it. */
  setScope: (section: SectionKey, scope: Scope) => void
  /** E3: opens the section's scope editor as a page (scopePageNodes); Done goes back. */
  openScopeEditor: (section: SectionKey) => void
  /** E3: the people, tags, events and shares the checks read (share_page_view.ts basisOf). */
  basis: () => Basis
  /** E3: my display name, for the "as seen by" preview (the receiving phone's own block). */
  myName: () => string
  /** My picture (wave 19): the round face (initials or the picture), its URL for the preview, pick a file, remove it. `has`: one is set. */
  picture: { face(): HTMLElement; url(): string | undefined; has(): boolean; choose(file: File): void; remove(): void }
  openInventory: () => void
  /** Wave 25: "Your city" for the ask sheet's example (AppState.city; empty = Vienna). */
  city: { get(): string; set(v: string): void }
}

const day = (at: number): string => new Date(at).toISOString().slice(0, 10)
const normName = (norm: Norm, text: string): string => (norm === Norm.Custom ? text : text ? `${S.normLabel[norm]} (${text})` : S.normLabel[norm])

/** The radios a profile section offers: the Share page's ladder plus Only me. */
export const PROFILE_ZONES: readonly Zone[] = [...ZONE_CHOICES, Zone.Self]

/** Each one-line field: its label and placeholder. */
const ONE_WORDS: Record<OneKey, [string, string]> = {
  intro: [S.profIntro, S.profIntroPh], interests: [S.profInterests, S.profInterestsPh], favourite: [S.profFavourite, S.profFavouritePh],
  address: [S.profAddress, S.profAddressPh], website: [S.profWebsite, S.profWebsitePh], offers: [S.profOffers, S.profOffersPh],
  working: [S.profWorking, S.profWorkingPh], availability: [S.profAvailability, S.profAvailabilityPh],
}

/** "by me · 2026-10-14", plus a stale chip after 90 days. */
function stamp(d: Dated, now: number): HTMLElement {
  return el('small', { class: 'meta prof-stamp' }, [`${d.by === 'ai' ? S.profByAi : S.profByMe} · ${day(d.at)}`, isStale(d.at, now) ? el('em', { class: 'prof-stale', 'data-stale': '1' }, [' ' + S.profStale]) : null])
}

/** What I can offer, read only: the Resources lines that anyone in my rings may ask about. */
export function offerLines(items: readonly InventoryItem[]): InventoryItem[] {
  return items.filter((i) => i.included && i.audience === Audience.FriendsOfFriends)
}

/** "Friends and closer · also #garden · except @Ada", from the same labels as the editor's chips. */
function summaryOf(scope: Scope, cands: readonly Candidate[]): string {
  return scopeSummary(scope, labelFor(cands), { zone: (z) => S.scopeZoneSummary[z] ?? z, also: S.scopeAlsoWord, except: S.scopeExceptWord })
}

/** Under each section: "Who sees this: <summary>" and Edit (the scope editor page). */
function scopeLine(d: ProfileViewDeps, section: SectionKey, cands: readonly Candidate[]): HTMLElement {
  return el('div', { class: 'prof-scope' }, [
    el('small', { class: 'meta' }, [S.profWhoSees]),
    el('span', { class: 'prof-scope-text', 'data-prof-scope': section }, [summaryOf(scopeOf(d.profile(), section), cands)]),
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-prof-scope-edit': section, 'aria-label': S.profScopeEditAria(S.profSection[section]), onclick: () => d.openScopeEditor(section) }, [S.profScopeEdit]),
  ])
}

/** The face, "Choose a picture" (capture is left to the phone's own picker), "Remove". */
function pictureField(d: ProfileViewDeps): HTMLElement {
  const input = el('input', { type: 'file', accept: 'image/*', hidden: '', 'aria-label': S.profPictureChoose, 'data-prof-picture-input': '1' }) as HTMLInputElement
  input.addEventListener('change', () => { const f = input.files?.[0]; if (f) d.picture.choose(f) })
  return el('div', { class: 'prof-picture', 'data-prof-picture': d.picture.has() ? 'set' : 'none' }, [
    el('div', { class: 'prof-picture-row' }, [
      d.picture.face(),
      el('button', { class: 'btn btn-electric btn-sm', type: 'button', 'data-prof-picture-choose': '1', onclick: () => input.click() }, [d.picture.has() ? S.profPictureChange : S.profPictureChoose]),
      d.picture.has() ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-prof-picture-remove': '1', onclick: d.picture.remove }, [S.profPictureRemove]) : null,
      input,
    ]),
    el('p', { class: 'meta' }, [S.profPictureHint]),
  ])
}

function oneField(d: ProfileViewDeps, key: OneKey): HTMLElement {
  const [label, ph] = ONE_WORDS[key]
  const cur = d.profile()[key]
  const input = el('input', { class: 'field', placeholder: ph, maxlength: String(ONE_MAX[key]), value: cur?.text ?? '', 'aria-label': label, 'data-prof-input': key })
  const save = (): void => { d.setOne(key, input.value); d.commit() }
  input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') save() })
  return el('div', { class: 'prof-one' }, [
    el('label', { class: 'prof-label' }, [label]), input,
    el('div', { class: 'rec-saves' }, [el('button', { class: 'btn btn-electric btn-sm', type: 'button', 'data-prof-save': key, onclick: save }, [S.chSave]), cur ? stamp(cur, d.now()) : null]),
  ])
}

/** Contact norms: the ones set, then pick + own words + Add. */
function normsField(d: ProfileViewDeps): HTMLElement {
  const pick = el('select', { class: 'field', 'aria-label': S.profNormPick, 'data-prof-norm-pick': '1' }, NORMS.map((n) => el('option', { value: n }, [S.normLabel[n]])))
  const text = el('input', { class: 'field', placeholder: S.profNormPh, maxlength: '40', 'aria-label': S.profNormPh, 'data-prof-norm-text': '1' })
  const add = (): void => { d.addNorm(pick.value as Norm, text.value); d.commit() }
  return el('div', { class: 'prof-norms' }, [
    el('label', { class: 'prof-label' }, [S.profNorms]),
    ...d.profile().norms.map((n, i) => el('div', { class: 'cb-row', 'data-prof-norm': n.norm }, [
      el('b', {}, [normName(n.norm, n.text)]), stamp(n, d.now()),
      el('button', { class: 'mini', type: 'button', 'aria-label': S.profRemove, onclick: () => { d.removeNorm(i); d.commit() } }, ['×']),
    ])),
    el('div', { class: 'cb-row editing' }, [pick, text, el('button', { class: 'btn btn-electric btn-sm', type: 'button', 'data-prof-norm-add': '1', onclick: add }, [S.profNormAdd])]),
  ])
}

const fieldNode = (d: ProfileViewDeps, f: ProfileSection): HTMLElement => (f === 'picture' ? pictureField(d) : f === 'norms' ? normsField(d) : oneField(d, f))

function sectionBox(d: ProfileViewDeps, section: SectionKey, cands: readonly Candidate[]): HTMLElement {
  return el('section', { class: 'prof-section', 'data-prof-section': section }, [
    el('h4', { class: 'eyebrow' }, [S.profSection[section]]),
    ...SECTION_FIELDS[section].map((f) => fieldNode(d, f)),
    scopeLine(d, section, cands),
  ])
}

function cityField(d: ProfileViewDeps): HTMLElement {
  const input = el('input', { class: 'field', placeholder: S.profCityPh, maxlength: String(CITY_MAX), value: d.city.get(), 'aria-label': S.profCity, 'data-prof-city': '1' })
  input.addEventListener('change', () => { d.city.set(input.value); d.commit() })
  return el('div', { class: 'prof-one' }, [el('label', { class: 'prof-label' }, [S.profCity]), input])
}

/** The viewer the preview shows; kept across the sheet's redraws (UI state only, never saved). */
let viewerChoice = 'zone:acquaintance'

/** "Your profile as seen by [viewer]": the receiving phone's own block (theirProfileBlock) for exactly the slice that viewer would get. */
function previewBlock(d: ProfileViewDeps, basis: Basis, cands: readonly Candidate[]): HTMLElement {
  const label = labelFor(cands)
  const group = (title: string, prefix: string): HTMLElement | null => {
    const list = cands.filter((c) => c.id.startsWith(prefix))
    return list.length ? el('optgroup', { label: title }, list.map((c) => el('option', { value: c.id }, [label(c.id)]))) : null
  }
  const select = el('select', { class: 'field', 'aria-label': S.profPreview, 'data-prof-viewer': '1' }, [
    el('optgroup', { label: S.profViewerGroupZones }, VIEWER_ZONES.map((z) => el('option', { value: `zone:${z}` }, [S.profViewerZone[z]]))),
    group(S.profViewerGroupTags, 'tag:'), group(S.profViewerGroupEvents, 'event:'), group(S.profViewerGroupPeople, 'person:'),
  ]) as HTMLSelectElement
  if (!cands.some((c) => c.id === viewerChoice) && !viewerChoice.startsWith('zone:')) viewerChoice = 'zone:acquaintance'
  select.value = viewerChoice
  const body = el('div', { class: 'prof-preview-body', 'data-prof-preview-body': '1' })
  const show = (): void => {
    const v = viewerOf(viewerChoice)
    const t = v ? sliceForViewer(d.profile(), v, basis, new Date(d.now()), d.picture.url()) : null
    body.dataset.profPreviewBody = viewerChoice
    body.replaceChildren(theirProfileBlock(d.myName(), t ?? undefined, d.now()) ?? el('p', { class: 'meta', 'data-prof-preview-nothing': '1' }, [S.profPreviewNothing]))
  }
  select.addEventListener('change', () => { viewerChoice = select.value; show() })
  show()
  return el('div', { class: 'prof-preview', 'data-prof-preview': '1' }, [
    el('label', { class: 'prof-label' }, [S.profPreview]), select,
    el('p', { class: 'meta' }, [S.profPreviewHint]),
    body,
  ])
}

export function profileSheetNodes(d: ProfileViewDeps): Node[] {
  const basis = d.basis()
  const cands = candidates(basis)
  const offers = offerLines(d.inventory())
  return [
    el('h3', {}, [S.profTitle]),
    el('p', { class: 'meta' }, [S.profLead]),
    previewBlock(d, basis, cands),
    ...SECTION_KEYS.map((k) => sectionBox(d, k, cands)),
    el('p', { class: 'meta' }, [S.profShareHint]),
    el('section', { class: 'prof-section prof-local', 'data-prof-local': '1' }, [
      el('h4', { class: 'eyebrow' }, [S.profOffer]),
      offers.length ? el('ul', { class: 'prof-offers', 'data-prof-offers': '1' }, offers.map((i) => el('li', {}, [i.text]))) : el('p', { class: 'meta' }, [S.profOfferNone]),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: d.openInventory }, [S.profOfferEdit]),
      cityField(d),
      el('p', { class: 'meta' }, [S.profNotShared]),
    ]),
  ]
}

/** The scope editor page of one section (main.ts opens it with pages.open): the ladder plus Only me, Also / Except, the preview, Done. */
export function scopePageNodes(d: ProfileViewDeps, section: SectionKey, close: () => void): Node[] {
  let scope = scopeOf(d.profile(), section)
  const cands = candidates(d.basis())
  return [
    el('p', { class: 'meta' }, [S.scopeLead]),
    scopeEditor({
      scope, zones: PROFILE_ZONES, candidates: cands, label: labelFor(cands),
      preview: (sc) => previewSection(d.profile(), section, sc, d.basis(), new Date(d.now())),
      onChange: (sc) => { scope = sc },
    }),
    el('button', { class: 'btn btn-electric wide', type: 'button', 'data-scope-done': section, onclick: () => { d.setScope(section, scope); d.commit(); close() } }, [S.scopeDone]),
  ]
}

/** What a connected person shared about themselves, for their card; null when nothing was shared. */
export function theirProfileBlock(name: string, t: SharedProfile | undefined, now: number): HTMLElement | null {
  if (!t) return null
  return el('div', { class: 'prof-their', 'data-their-profile': '1' }, [
    el('h4', { class: 'eyebrow' }, [S.profTheirs(name)]),
    ...t.norms.map((n) => el('div', { class: 'prof-line', 'data-their-norm': n.norm }, [normName(n.norm, n.text)])),
    t.picture ? el('img', { class: 'prof-their-pic', src: t.picture, alt: S.profPictureOf(name), 'data-their-picture': '1' }) : null,
    t.favourite ? el('div', { class: 'prof-line' }, [S.profFavourite + ': ' + t.favourite]) : null,
    t.intro ? el('div', { class: 'prof-line' }, [t.intro]) : null,
    ...(['interests', 'website', 'offers', 'working', 'address', 'availability'] as const).map((k) => (t[k] ? el('div', { class: 'prof-line', [`data-their-${k}`]: '1' }, [S.profTheirLabel[k] + ': ' + t[k]]) : null)),
    stamp({ text: '', at: t.at, by: 'me' }, now),
  ])
}
