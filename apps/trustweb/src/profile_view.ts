/**
 * "My profile" sheet and the block a connected person's card shows (wave 7). DOM and words only: the rules are profile.ts; what is
 * saved is the caller's business (`commit` saves and redraws).
 */
import { el } from '../../demo/src/ui/dom'
import { Audience } from './model'
import type { InventoryItem } from './model'
import { NORMS, Norm, ONE_MAX, PROFILE_AUDIENCES, audienceOf, isStale } from './profile'
import type { Dated, MyProfile, OneKey, ProfileAudience, ProfileSection, SharedProfile } from './profile'
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
  setAudience: (section: ProfileSection, audience: ProfileAudience) => void
  /** My picture (wave 19): the round face (initials or the picture), pick a file, remove it. `has`: one is set. */
  picture: { face(): HTMLElement; has(): boolean; choose(file: File): void; remove(): void }
  openInventory: () => void
}

const day = (at: number): string => new Date(at).toISOString().slice(0, 10)
const normName = (norm: Norm, text: string): string => (norm === Norm.Custom ? text : text ? `${S.normLabel[norm]} (${text})` : S.normLabel[norm])

/** "by me · 2026-10-14", plus a stale chip after 90 days. */
function stamp(d: Dated, now: number): HTMLElement {
  return el('small', { class: 'meta prof-stamp' }, [`${d.by === 'ai' ? S.profByAi : S.profByMe} · ${day(d.at)}`, isStale(d.at, now) ? el('em', { class: 'prof-stale', 'data-stale': '1' }, [' ' + S.profStale]) : null])
}

/** What I can offer, read only: the My Resources lines that anyone in my rings may ask about. */
export function offerLines(items: readonly InventoryItem[]): InventoryItem[] {
  return items.filter((i) => i.included && i.audience === Audience.FriendsOfFriends)
}

/** Under each section: "Share with: Close | Friends | Acquaintances | Public | Nobody" (profile.ts sliceFor). */
function audienceSeg(d: ProfileViewDeps, section: ProfileSection): HTMLElement {
  const cur = audienceOf(d.profile(), section)
  return el('div', { class: 'prof-audience' }, [
    el('small', { class: 'meta' }, [section === 'picture' ? S.profPictureReach : S.profShareWith]),
    el('div', { class: 'seg', role: 'group', 'aria-label': S.profShareWith, [`data-audience-${section}`]: cur }, PROFILE_AUDIENCES.map((a) => el('button', {
      type: 'button', class: a === cur ? 'on' : '', 'aria-pressed': String(a === cur), 'data-audience': a,
      onclick: () => { d.setAudience(section, a); d.commit() },
    }, [S.profAudience[a]]))),
  ])
}

/** The top of the editor: the face, "Choose a picture" (capture is left to the phone's own picker), "Remove", and who might reach me with it. */
function pictureSection(d: ProfileViewDeps): HTMLElement {
  const input = el('input', { type: 'file', accept: 'image/*', hidden: '', 'aria-label': S.profPictureChoose, 'data-prof-picture-input': '1' }) as HTMLInputElement
  input.addEventListener('change', () => { const f = input.files?.[0]; if (f) d.picture.choose(f) })
  return el('div', { class: 'prof-picture', 'data-prof-picture': d.picture.has() ? 'set' : 'none' }, [
    el('h4', { class: 'eyebrow' }, [S.profPicture]),
    el('div', { class: 'prof-picture-row' }, [
      d.picture.face(),
      el('button', { class: 'btn btn-electric btn-sm', type: 'button', 'data-prof-picture-choose': '1', onclick: () => input.click() }, [d.picture.has() ? S.profPictureChange : S.profPictureChoose]),
      d.picture.has() ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-prof-picture-remove': '1', onclick: d.picture.remove }, [S.profPictureRemove]) : null,
      input,
    ]),
    audienceSeg(d, 'picture'),
    el('p', { class: 'meta' }, [S.profPictureHint]),
  ])
}

function oneField(d: ProfileViewDeps, key: OneKey, label: string, ph: string): HTMLElement {
  const cur = d.profile()[key]
  const input = el('input', { class: 'field', placeholder: ph, maxlength: String(ONE_MAX[key]), value: cur?.text ?? '', 'aria-label': label, 'data-prof-input': key })
  const save = (): void => { d.setOne(key, input.value); d.commit() }
  input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') save() })
  return el('div', { class: 'prof-one' }, [
    el('h4', { class: 'eyebrow' }, [label]), input,
    el('div', { class: 'rec-saves' }, [el('button', { class: 'btn btn-electric btn-sm', type: 'button', 'data-prof-save': key, onclick: save }, [S.chSave]), cur ? stamp(cur, d.now()) : null]),
    audienceSeg(d, key),
  ])
}

export function profileSheetNodes(d: ProfileViewDeps): Node[] {
  const p = d.profile()
  const offers = offerLines(d.inventory())
  const pick = el('select', { class: 'field', 'aria-label': S.profNormPick, 'data-prof-norm-pick': '1' }, NORMS.map((n) => el('option', { value: n }, [S.normLabel[n]])))
  const text = el('input', { class: 'field', placeholder: S.profNormPh, maxlength: '40', 'aria-label': S.profNormPh, 'data-prof-norm-text': '1' })
  const add = (): void => { d.addNorm(pick.value as Norm, text.value); d.commit() }
  return [
    el('h3', {}, [S.profTitle]),
    el('p', { class: 'meta' }, [S.profLead]),
    pictureSection(d),
    el('h4', { class: 'eyebrow' }, [S.profOffer]),
    offers.length ? el('ul', { class: 'prof-offers', 'data-prof-offers': '1' }, offers.map((i) => el('li', {}, [i.text]))) : el('p', { class: 'meta' }, [S.profOfferNone]),
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: d.openInventory }, [S.profOfferEdit]),
    el('h4', { class: 'eyebrow' }, [S.profNorms]),
    ...p.norms.map((n, i) => el('div', { class: 'cb-row', 'data-prof-norm': n.norm }, [
      el('b', {}, [normName(n.norm, n.text)]), stamp(n, d.now()),
      el('button', { class: 'mini', type: 'button', 'aria-label': S.profRemove, onclick: () => { d.removeNorm(i); d.commit() } }, ['×']),
    ])),
    el('div', { class: 'cb-row editing' }, [pick, text, el('button', { class: 'btn btn-electric btn-sm', type: 'button', 'data-prof-norm-add': '1', onclick: add }, [S.profNormAdd])]),
    audienceSeg(d, 'norms'),
    oneField(d, 'favourite', S.profFavourite, S.profFavouritePh),
    oneField(d, 'intro', S.profIntro, S.profIntroPh),
    oneField(d, 'website', S.profWebsite, S.profWebsitePh),
    oneField(d, 'offers', S.profOffers, S.profOffersPh),
    oneField(d, 'working', S.profWorking, S.profWorkingPh),
    oneField(d, 'address', S.profAddress, S.profAddressPh),
    el('p', { class: 'meta' }, [S.profShareHint]),
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
    ...(['website', 'offers', 'working', 'address'] as const).map((k) => (t[k] ? el('div', { class: 'prof-line', [`data-their-${k}`]: '1' }, [S.profTheirLabel[k] + ': ' + t[k]]) : null)),
    stamp({ text: '', at: t.at, by: 'me' }, now),
  ])
}
