/**
 * "My profile" sheet and the block a connected person's card shows (wave 7). DOM and words only: the rules are profile.ts; what is
 * saved is the caller's business (`commit` saves and redraws).
 */
import { el } from '../../demo/src/ui/dom'
import { Audience } from './model'
import type { InventoryItem } from './model'
import { NORMS, Norm, isStale } from './profile'
import type { Dated, MyProfile, SharedProfile } from './profile'
import { S } from './strings'

export interface ProfileViewDeps {
  profile: () => MyProfile
  inventory: () => readonly InventoryItem[]
  now: () => number
  /** Saves the profile after a change; the sheet redraws. */
  commit: () => void
  addNorm: (norm: Norm, text: string) => void
  removeNorm: (index: number) => void
  setOne: (key: 'favourite' | 'intro', text: string) => void
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

function oneField(d: ProfileViewDeps, key: 'favourite' | 'intro', label: string, ph: string, max: number): HTMLElement {
  const cur = d.profile()[key]
  const input = el('input', { class: 'field', placeholder: ph, maxlength: String(max), value: cur?.text ?? '', 'aria-label': label, 'data-prof-input': key })
  const save = (): void => { d.setOne(key, input.value); d.commit() }
  input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') save() })
  return el('div', { class: 'prof-one' }, [
    el('h4', { class: 'eyebrow' }, [label]), input,
    el('div', { class: 'rec-saves' }, [el('button', { class: 'btn btn-electric btn-sm', type: 'button', 'data-prof-save': key, onclick: save }, [S.chSave]), cur ? stamp(cur, d.now()) : null]),
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
    el('h4', { class: 'eyebrow' }, [S.profOffer]),
    offers.length ? el('ul', { class: 'prof-offers', 'data-prof-offers': '1' }, offers.map((i) => el('li', {}, [i.text]))) : el('p', { class: 'meta' }, [S.profOfferNone]),
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: d.openInventory }, [S.profOfferEdit]),
    el('h4', { class: 'eyebrow' }, [S.profNorms]),
    ...p.norms.map((n, i) => el('div', { class: 'cb-row', 'data-prof-norm': n.norm }, [
      el('b', {}, [normName(n.norm, n.text)]), stamp(n, d.now()),
      el('button', { class: 'mini', type: 'button', 'aria-label': S.profRemove, onclick: () => { d.removeNorm(i); d.commit() } }, ['×']),
    ])),
    el('div', { class: 'cb-row editing' }, [pick, text, el('button', { class: 'btn btn-electric btn-sm', type: 'button', 'data-prof-norm-add': '1', onclick: add }, [S.profNormAdd])]),
    oneField(d, 'favourite', S.profFavourite, S.profFavouritePh, 40),
    oneField(d, 'intro', S.profIntro, S.profIntroPh, 100),
    el('p', { class: 'meta' }, [S.profShareHint]),
  ]
}

/** What a connected person shared about themselves, for their card; null when nothing was shared. */
export function theirProfileBlock(name: string, t: SharedProfile | undefined, now: number): HTMLElement | null {
  if (!t) return null
  return el('div', { class: 'prof-their', 'data-their-profile': '1' }, [
    el('h4', { class: 'eyebrow' }, [S.profTheirs(name)]),
    ...t.norms.map((n) => el('div', { class: 'prof-line', 'data-their-norm': n.norm }, [normName(n.norm, n.text)])),
    t.favourite ? el('div', { class: 'prof-line' }, [S.profFavourite + ': ' + t.favourite]) : null,
    t.intro ? el('div', { class: 'prof-line' }, [t.intro]) : null,
    stamp({ text: '', at: t.at, by: 'me' }, now),
  ])
}
