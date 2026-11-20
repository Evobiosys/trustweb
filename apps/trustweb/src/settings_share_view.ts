// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 settings-suggest: Settings > Share settings (settings_share.ts is the logic). Incoming suggestions with their diff and Accept / Decline,
 * follow requests with Allow / Decline, "Suggest these settings to…" and "Follow someone's settings" (sheets: group, person, auto-apply), my follows
 * with their auto-apply switch and Stop. The transport is the existing sealed notes relay (notes_relay.ts postPayload / pollPayloads, sealed per
 * person like the co-notes chat): the outbox goes out and the relay is read on start, every POLL_MS while visible, and when Settings opens.
 * main.ts: one create call next to the module hooks and one rows call in Settings.
 */
import { el } from '../../demo/src/ui/dom'
import { randomId } from '../../demo/src/crypto'
import type { Identity } from '../../demo/src/did'
import type { AppState, Person } from './model'
import { pollPayloads, postPayload, type RelayDeps } from './notes_relay'
import { settingById, type Rec, type SettingValue } from './settings_registry'
import {
  GROUP_SETTINGS, SHARE_GROUPS, answer, diffOf, dropOutgoing, dueFollowerUpdates, follow, followers, follows, parseWire, reachable, receive, setFollowAuto, shareOf, suggest,
  takeOutgoing, unfollow, type Reach, type ShareGroup,
} from './settings_share'
import { S } from './strings'

/** How often the relay is read while the app is visible. */
export const POLL_MS = 120_000
/** Opening Settings reads the relay again only after this pause. */
const OPEN_POLL_GAP_MS = 5_000

export interface ShareHost {
  state: () => AppState
  save: () => void
  toast: (msg: string) => void
  sheet: (children: (Node | null)[]) => void
  closeSheet: () => void
  relay: () => { deps: RelayDeps; identity: Identity } | null
  didOf: (personId: string) => string | undefined
}

const T = S.w45ss
const groupName = (g: ShareGroup): string => T.groups[g]
const show = (v: SettingValue): string => (v === true ? T.on : v === false ? T.off : String(v))

export function createSettingsShare(h: ShareHost): { rows: (redraw: () => void) => Node[]; tick: () => Promise<boolean> } {
  const rec = (): Rec => h.state() as unknown as Rec
  const people = (): Person[] => h.state().people
  const nameOf = (id: string): string => people().find((p) => p.id === id)?.name || T.someone
  let redraw: (() => void) | null = null
  let busy: Promise<boolean> | null = null
  let lastTick = 0
  const shown = (): boolean => typeof document !== 'undefined' && document.querySelector('[data-settings-share]')?.isConnected === true

  /** Sends my due follower updates and the outbox, then reads what was left for me. True when the record changed. */
  async function run(): Promise<boolean> {
    let r: Rec
    try { r = rec() } catch { return false }
    lastTick = Date.now()
    let changed = dueFollowerUpdates(r, Date.now(), () => randomId(12)) > 0
    const relay = h.relay()
    if (relay) {
      for (const o of takeOutgoing(r)) {
        const did = h.didOf(o.to)
        if (did && await postPayload(relay.deps, o.msg, relay.identity, did)) { dropOutgoing(r, o.id); changed = true }
      }
      const bySender = (did: string): Person | undefined => people().find((p) => h.didOf(p.id) === did)
      const got = await pollPayloads(relay.deps, relay.identity, (did) => bySender(did) !== undefined, parseWire)
      let arrived = 0
      for (const { from, item } of got) {
        const p = bySender(from)
        if (!p) continue
        const outcome = receive(r, p.id, item, Date.now())
        if (outcome === 'applied') h.toast(T.applied(p.name, groupName(item.group)))
        if (outcome === 'inbox') arrived++
        changed = true
      }
      if (arrived) h.toast(T.arrived(arrived))
    }
    if (changed) { h.save(); if (redraw && shown()) redraw() }
    return changed
  }
  const tick = (): Promise<boolean> => (busy ??= run().finally(() => { busy = null }))

  if (typeof window !== 'undefined') {
    setTimeout(() => void tick(), 3_000)
    setInterval(() => { if (document.visibilityState === 'visible') void tick() }, POLL_MS)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void tick() })
  }

  const back = (): void => { h.closeSheet(); redraw?.() }
  /** The section stays open over the redraws a tap causes. */
  let keepOpen = false

  /** One pick row of radio buttons; `on` marks the picked one, the others are struck through once something is picked (P2). */
  const picks = <K extends string>(attr: string, items: readonly { id: K; label: string; hint?: string }[], cur: K | null, pick: (k: K) => void): HTMLElement[] =>
    items.map((it) => el('button', {
      class: 'radio' + (it.id === cur ? ' on' : cur ? ' tw-off' : ''), role: 'radio', 'aria-checked': String(it.id === cur), 'aria-pressed': String(it.id === cur), [attr]: it.id,
      onclick: () => pick(it.id),
    }, [el('b', {}, [it.label]), it.hint ? el('small', {}, [it.hint]) : null]))

  const groupItems = SHARE_GROUPS.map((g) => ({ id: g, label: groupName(g), hint: shareGroupHint(g) }))

  function suggestSheet(group: ShareGroup | null = null, person: string | null = null): void {
    const list = reachable(people(), 'direct', h.didOf).concat(reachable(people(), 'fof', h.didOf))
    const name = person ? nameOf(person) : ''
    h.sheet([
      el('h3', {}, [T.suggestTitle]),
      el('h4', { class: 'eyebrow' }, [T.pickGroup]),
      ...picks('data-ss-group', groupItems, group, (g) => suggestSheet(g, person)),
      el('h4', { class: 'eyebrow' }, [T.pickPerson]),
      ...(list.length ? picks('data-ss-person', list.map((p) => ({ id: p.id, label: p.name })), person, (p) => suggestSheet(group, p)) : [el('p', { class: 'meta', 'data-ss-nobody': '' }, [T.nobody])]),
      el('button', {
        class: 'btn btn-electric', 'data-ss-send': '', ...(group && person ? {} : { disabled: '' }),
        onclick: () => {
          if (!group || !person) return
          suggest(rec(), person, group, Date.now(), () => randomId(12))
          h.save(); h.toast(T.sent(name)); back(); void tick()
        },
      }, [group && person ? T.send(name) : T.sendPick]),
      el('button', { class: 'btn btn-ghost', onclick: back }, [S.setTitle]),
    ])
  }

  function followSheet(group: ShareGroup | null = null, reach: Reach = 'direct', person: string | null = null, auto = false): void {
    const list = reachable(people(), reach, h.didOf)
    const name = person ? nameOf(person) : ''
    h.sheet([
      el('h3', {}, [T.followTitle]),
      el('h4', { class: 'eyebrow' }, [T.pickGroup]),
      ...picks('data-ss-group', groupItems, group, (g) => followSheet(g, reach, person, auto)),
      el('h4', { class: 'eyebrow' }, [T.pickWhom]),
      el('div', { class: 'ss-reach' }, picks<Reach>('data-ss-reach', [{ id: 'direct', label: T.reachDirect }, { id: 'fof', label: T.reachFof }], reach, (r) => followSheet(group, r, null, auto))),
      ...(list.length ? picks('data-ss-person', list.map((p) => ({ id: p.id, label: p.name })), person, (p) => followSheet(group, reach, p, auto)) : [el('p', { class: 'meta', 'data-ss-nobody': '' }, [T.nobody])]),
      el('button', {
        class: 'radio' + (auto ? ' on' : ' tw-off'), role: 'switch', 'aria-checked': String(auto), 'aria-pressed': String(auto), 'data-ss-auto-new': '',
        onclick: () => followSheet(group, reach, person, !auto),
      }, [el('b', {}, [T.auto]), el('small', {}, [T.autoHint])]),
      el('button', {
        class: 'btn btn-electric', 'data-ss-follow': '', ...(group && person ? {} : { disabled: '' }),
        onclick: () => {
          if (!group || !person) return
          follow(rec(), person, group, auto, Date.now(), () => randomId(12))
          h.save(); h.toast(T.followSent(name)); back(); void tick()
        },
      }, [group && person ? T.followDo(name) : T.sendPick]),
      el('button', { class: 'btn btn-ghost', onclick: back }, [S.setTitle]),
    ])
  }

  /** A tap: the step, saved, Settings redrawn; a step on an item already answered (a double tap) only redraws. */
  const act = (fn: () => void, msg?: string): void => {
    try { fn(); h.save(); if (msg) h.toast(msg) } catch { /* already answered */ }
    redraw?.(); void tick()
  }

  function rows(again: () => void): Node[] {
    redraw = again
    if (Date.now() - lastTick > OPEN_POLL_GAP_MS) void tick()
    const r = rec()
    const share = shareOf(r)
    const items = share.inbox.map((i) => {
      const who = nameOf(i.from)
      const g = groupName(i.group)
      if (i.t === 'follow') {
        return el('div', { class: 'ss-item', 'data-ss-item': i.id, 'data-ss-kind': 'follow' }, [
          el('b', {}, [T.wantsFollow(who, g)]),
          el('small', { class: 'meta' }, [T.wantsFollowHint]),
          el('div', { class: 'ss-actions' }, [
            el('button', { class: 'chip ss-yes', 'data-ss-accept': i.id, onclick: () => act(() => answer(r, i.id, true, Date.now(), () => randomId(12))) }, [T.allow]),
            el('button', { class: 'chip', 'data-ss-decline': i.id, onclick: () => act(() => answer(r, i.id, false, Date.now(), () => randomId(12))) }, [T.decline]),
          ]),
        ])
      }
      const diff = diffOf(r, i.group, i.values)
      return el('div', { class: 'ss-item', 'data-ss-item': i.id, 'data-ss-kind': 'suggest' }, [
        el('b', {}, [i.follow ? T.changed(who, g) : T.suggests(who, g)]),
        diff.length
          ? el('ul', { class: 'ss-diff' }, diff.map((d) => el('li', { 'data-ss-diff': d.id }, [`${settingById(d.id)?.label ?? d.id}: `, el('s', {}, [show(d.from)]), ' → ', el('b', {}, [show(d.to)])])))
          : el('small', { class: 'meta' }, [T.noChange]),
        el('div', { class: 'ss-actions' }, [
          el('button', { class: 'chip ss-yes', 'data-ss-accept': i.id, onclick: () => act(() => answer(r, i.id, true, Date.now(), () => randomId(12)), T.accepted) }, [T.accept]),
          el('button', { class: 'chip', 'data-ss-decline': i.id, onclick: () => act(() => answer(r, i.id, false, Date.now(), () => randomId(12))) }, [T.decline]),
        ]),
      ])
    })
    const mine = follows(r).map((f) => el('div', { class: 'ss-follow', 'data-ss-following': f.group }, [
      el('span', {}, [T.following(nameOf(f.person), groupName(f.group)), f.waiting ? el('small', { class: 'meta' }, [` · ${T.waiting}`]) : null]),
      el('button', {
        class: 'radio' + (f.auto ? ' on' : ' tw-off'), role: 'switch', 'aria-checked': String(f.auto), 'aria-pressed': String(f.auto), 'data-ss-auto': f.group,
        onclick: () => act(() => setFollowAuto(r, f.group, !f.auto)),
      }, [el('b', {}, [T.auto]), el('small', {}, [T.autoHint])]),
      el('button', { class: 'chip', 'data-ss-stop': f.group, onclick: () => act(() => unfollow(r, f.group, Date.now(), () => randomId(12))) }, [T.stop]),
    ]))
    const byGroup = SHARE_GROUPS.flatMap((g) => { const names = followers(r).filter((f) => f.group === g).map((f) => nameOf(f.person)); return names.length ? [el('p', { class: 'meta', 'data-ss-followers': g }, [T.followers(names.join(', '), groupName(g))])] : [] })
    const d = el('details', { class: 'settings-adv', 'data-settings-section': 'share-settings', 'data-settings-share': '', 'data-settings-group': 'share-settings' }, [
      el('summary', { class: 'adv-toggle' }, [T.title, items.length ? el('span', { class: 'ss-new', 'data-ss-new': '' }, [` · ${T.newCount(items.length)}`]) : null]),
      el('p', { class: 'meta' }, [T.hint]),
      ...items,
      el('div', { class: 'ss-actions' }, [
        el('button', { class: 'chip ss-open', 'data-ss-suggest-open': '', onclick: () => suggestSheet() }, [T.suggestOpen]),
        el('button', { class: 'chip ss-open', 'data-ss-follow-open': '', onclick: () => followSheet() }, [T.followOpen]),
      ]),
      ...mine,
      ...byGroup,
    ]) as HTMLDetailsElement
    d.open = items.length > 0 || keepOpen
    d.addEventListener('toggle', () => { keepOpen = d.open })
    return [d]
  }
  return { rows, tick }
}

/** The labels a group carries, for the group picker. */
export const shareGroupHint = (g: ShareGroup): string => GROUP_SETTINGS[g].map((id) => settingById(id)?.label ?? id).join(' · ')
