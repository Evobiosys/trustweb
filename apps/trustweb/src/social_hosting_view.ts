// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c social-hosting: the screens and the running part. One factory, createSocial(hooks), returns what main.ts mounts:
 *   profileBlock   Settings > Your Profile: "Discoverable by name" (OFF is struck through, P2) with a V expander for "Open to connect" (P3)
 *   settingsGroup  Advanced > People and servers: "Only through people I trust (no servers)", "Host my friends' names", the server list
 *   findBlock      "Find someone by name" under the Network search: global hits "not yet connected" with "Intend to connect"
 *   trustRow       the person page: Trust by ring | Trusted | Not trusted
 *   connectButton  a person found by name who wants to connect: "Connect"
 *   start / onHost / onHeard   the running part: publish, pull intents, answer friends, hand the record to the server when this device goes offline
 * Logic lives in social_hosting.ts, directory_client.ts, name_record.ts and trust_mode.ts; this file only draws and wires.
 */
import { deserializeIdentity, signBytes, verifyDidSignature } from '../../demo/src/did'
import type { Identity } from '../../demo/src/did'
import { el } from '../../demo/src/ui/dom'
import type { HostEnvelope } from '../../demo/src/types'
import { deleteRecord, serversOf } from './directory_client'
import type { DirDeps } from './directory_client'
import type { AppState, Peer, Person } from './model'
import { Ring } from './model'
import { makeIntent, makeRecord } from './name_record'
import type { NameRecord } from './name_record'
import { SocialHost, applyIntent, markIntended } from './social_hosting'
import type { HostMsg } from './social_hosting'
import { S } from './strings'
import { serversAllowed, setTrustOverride, setTrustedOnly, trustLabel, trustedOnly } from './trust_mode'

export interface SocialHooks {
  state: () => AppState
  save: () => void
  /** net.sendHost: one `host` wire to a connected peer. */
  sendHost: (peer: Peer, m: HostEnvelope['m']) => Promise<void>
  /** net.completeConnect for a did found in the directory (the connect-ack goes out). */
  connect: (did: string, name: string) => Promise<Peer>
  origin: string
  fetch: typeof fetch
  now: () => number
  toast: (msg: string) => void
  /** The screen draws again (a person appeared or changed). */
  render: () => void
  newId: () => string
}

/** "Ada Lovelace" -> first "Ada", last "Lovelace"; a single word has no last name. */
export function splitName(displayName: string): { first: string; last: string } {
  const [first = '', ...rest] = displayName.trim().split(/\s+/).filter(Boolean)
  return { first, last: rest.join(' ') }
}

const HEARTBEAT_MS = 5 * 60_000

export interface Social {
  start: () => void
  onHost: (fromDid: string, m: Record<string, unknown>) => void
  onHeard: (fromDid: string) => void
  profileBlock: (redraw: () => void) => HTMLElement
  settingsGroup: (redraw: () => void) => HTMLElement
  findBlock: () => HTMLElement
  trustRow: (p: Person, redraw: () => void) => HTMLElement
  connectButton: (p: Person, redraw: () => void) => HTMLElement | null
}

export function createSocial(h: SocialHooks): Social {
  let node: SocialHost | null = null
  let timer: ReturnType<typeof setInterval> | undefined

  const identity = (): Identity | null => { const i = h.state().identity; try { return i ? deserializeIdentity(i) : null } catch { return null } }
  const dirDeps = (): DirDeps => ({
    fetch: (url, init) => h.fetch(url, { ...init, keepalive: true, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }),
    origins: serversOf(h.state(), h.origin), now: h.now, verify: verifyDidSignature,
  })

  function host(): SocialHost | null {
    if (node) return node
    const id = identity()
    if (!id) return null
    node = new SocialHost({
      self: { did: id.did }, state: () => h.state(), sign: (b) => signBytes(id, b), verify: verifyDidSignature, now: h.now, save: h.save,
      wait: (ms) => new Promise((r) => setTimeout(r, ms)),
      send: async (toDid, msg: HostMsg) => { const peer = h.state().peers.find((p) => p.did === toDid); if (!peer) throw new Error('not a connection'); await h.sendHost(peer, msg as unknown as HostEnvelope['m']) },
      dir: () => (serversAllowed(h.state()) ? dirDeps() : null),
      onIntent: () => applyPending(),
    })
    return node
  }

  /** The signed record of the owner's own listing, from the profile name; null when not discoverable or the name has no last word. */
  function ownRecord(): NameRecord | null {
    const s = h.state(); const id = identity(); const { first, last } = splitName(s.me.displayName)
    if (!s.discoverable || !id || !first || !last) return null
    return makeRecord((b) => signBytes(id, b), { first, last, key: id.did, ts: h.now(), open: s.discoverOpen !== false, srv: serversAllowed(s) })
  }

  async function publish(): Promise<void> {
    const rec = ownRecord()
    if (rec) await host()?.publish(rec)
  }

  function applyPending(): void {
    const s = h.state()
    const waiting = s.intentsIn ?? []
    if (!waiting.length) return
    s.intentsIn = []
    let n = 0
    for (const i of waiting) { const p = applyIntent(s as never, i, h.newId, h.now()); if (p) { n += 1; h.toast(S.social.arrived(p.name)) } }
    h.save()
    if (n) h.render()
  }

  async function tick(): Promise<void> {
    await host()?.pullIntents()
    applyPending()
    await publish()
  }

  function start(): void {
    if (timer || !host()) return
    void tick()
    timer = setInterval(() => void tick(), HEARTBEAT_MS)
    // This device is leaving: the last host of a record hands it to the server (best effort, keepalive).
    window.addEventListener('pagehide', () => void host()?.handOff())
  }

  /** The switches changed: publish, or withdraw from friends and (while servers are still allowed) from the server. */
  async function settled(): Promise<void> {
    if (h.state().discoverable) { await publish(); return }
    await host()?.withdraw()
    const id = identity()
    if (id && serversAllowed(h.state())) await deleteRecord(dirDeps(), id.did, (b) => signBytes(id, b))
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------------------------

  function switchRow(id: string, label: string, hint: string, on: boolean, toggle: () => void, disabled = false): HTMLElement {
    const sw = el('button', {
      class: 'tr-toggle' + (on ? ' on' : ''), type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-pressed': String(on), 'aria-label': label,
      'data-social-switch': id, ...(disabled ? { disabled: '' } : {}), onclick: toggle,
    }, [el('span', { class: 'tr-led', 'aria-hidden': 'true' })])
    return el('div', { class: 'set-row', 'data-social': id }, [el('div', { class: 'set-row-text' }, [el('b', { class: on ? '' : 'tw-off' }, [label]), el('small', {}, [hint])]), sw])
  }

  function profileBlock(redraw: () => void): HTMLElement {
    const s = h.state()
    const named = Boolean(splitName(s.me.displayName).last)
    const on = s.discoverable === true
    const hint = !named ? S.social.discNeedsName : trustedOnly(s) ? S.social.discNoServer : S.social.discHint
    let open = false
    const more = el('div', { class: 'social-more', 'data-social-more': '', hidden: '' }, [
      switchRow('open', S.social.openTitle, S.social.openHint, s.discoverOpen !== false, () => {
        if (s.discoverOpen === false) delete s.discoverOpen; else s.discoverOpen = false
        h.save(); void settled(); redraw()
      }),
    ])
    const expander = el('button', { class: 'tw-expander', type: 'button', 'data-social-expander': '', 'aria-expanded': 'false', 'aria-label': S.social.discMore, onclick: () => {
      open = !open; more.hidden = !open; expander.setAttribute('aria-expanded', String(open)); expander.textContent = open ? '▴' : '▾'
    } }, ['▾'])
    const row = switchRow('discoverable', S.social.discTitle, hint, on, () => {
      if (!named && !on) return
      if (on) delete s.discoverable; else s.discoverable = true
      h.save(); void settled(); redraw()
    }, !named && !on)
    return el('div', { class: 'social-profile', 'data-social-profile': '' }, [el('div', { class: 'social-row' }, [row, expander]), more])
  }

  function settingsGroup(redraw: () => void): HTMLElement {
    const s = h.state()
    const only = trustedOnly(s)
    const servers = s.directoryServers ?? []
    const rows = (servers.length ? servers : ['']).map((u) => el('div', { class: 'social-server', 'data-social-server': u }, [
      el('span', {}, [u || S.social.serversDefault]),
      u ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-social-server-remove': u, 'aria-label': S.social.serversRemove(u), onclick: () => {
        s.directoryServers = servers.filter((x) => x !== u); if (!s.directoryServers.length) delete s.directoryServers
        h.save(); redraw()
      } }, ['×']) : null,
    ]))
    const input = el('input', { class: 'field', type: 'url', placeholder: S.social.serversPh, 'aria-label': S.social.serversTitle, 'data-social-server-input': '', autocomplete: 'off' }) as HTMLInputElement
    const add = (): void => {
      const u = input.value.trim().replace(/\/+$/, '')
      if (!/^https:\/\/[^/\s]+$/.test(u)) { h.toast(S.social.serversBad); return }
      if (!servers.includes(u)) s.directoryServers = [...servers, u]
      h.save(); redraw()
    }
    input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') add() })
    const choose = (['off', 'closest', 'close'] as const).map((m) => {
      const cur = (s.hostFriends ?? 'closest') === m
      return el('button', { class: 'radio' + (cur ? ' on' : ''), type: 'button', 'aria-pressed': String(cur), 'data-social-host': m, onclick: () => {
        if (m === 'closest') delete s.hostFriends; else s.hostFriends = m as 'off' | 'close'
        h.save(); redraw()
      } }, [el('b', { class: cur ? '' : 'tw-off' }, [S.social.host[m]])])
    })
    return el('div', { 'data-settings-group': 'social', class: 'social-settings' }, [
      el('h4', { class: 'eyebrow' }, [S.social.advTitle]),
      switchRow('trusted-only', S.social.trustedOnly, only ? S.social.trustedOnlyOn : S.social.trustedOnlyHint, only, () => {
        // Turning it on: take my listing off the server first, while servers are still allowed; the friends keep it.
        void (async () => {
          if (!only) { const id = identity(); if (id && s.discoverable) await deleteRecord(dirDeps(), id.did, (b) => signBytes(id, b)) }
          setTrustedOnly(s, !only); h.save(); void settled(); redraw()
        })()
      }),
      el('div', { class: 'set-row-text' }, [el('b', {}, [S.social.hostTitle]), el('small', {}, [S.social.hostHint])]),
      el('div', { class: 'social-host' }, choose),
      el('div', { class: 'set-row-text' }, [el('b', {}, [S.social.serversTitle]), el('small', {}, [only ? S.social.serversOff : ''])]),
      ...rows,
      el('div', { class: 'social-server-add' }, [input, el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-social-server-add': '', onclick: add }, [S.social.serversAdd])]),
    ])
  }

  function trustRow(p: Person, redraw: () => void): HTMLElement {
    const cur = p.trust === 'yes' ? 'trusted' : p.trust === 'no' ? 'not' : 'default'
    const now = trustLabel(p)
    return el('div', { class: 'social-trust', 'data-social-trust': p.id }, [
      el('b', {}, [S.social.trustTitle]),
      el('small', { 'data-social-trust-now': String(now.trusted) }, [S.social.trustNow(now.trusted, now.why)]),
      el('div', { class: 'social-trust-choice' }, (['default', 'trusted', 'not'] as const).map((v) => el('button', {
        class: 'radio' + (cur === v ? ' on' : ''), type: 'button', 'aria-pressed': String(cur === v), 'data-social-trust-set': v,
        onclick: () => { setTrustOverride(p, v); h.save(); redraw() },
      }, [el('b', { class: cur === v ? '' : 'tw-off' }, [S.social.trustChoice[v]])]))),
    ])
  }

  function connectButton(p: Person, redraw: () => void): HTMLElement | null {
    if (!p.globalKey || p.peerId) return null
    return el('button', { class: 'btn btn-electric', type: 'button', 'data-social-connect': p.id, onclick: () => {
      void h.connect(p.globalKey as string, p.name).then((peer) => {
        p.peerId = peer.id; p.ring = Ring.Acquaintance; delete p.reachedOut
        h.save(); h.toast(S.social.connectDone(p.name)); redraw()
      }, () => h.toast(S.social.serversBad))
    } }, [S.social.connect])
  }

  function findBlock(): HTMLElement {
    const s = h.state()
    const first = el('input', { class: 'field', type: 'search', placeholder: S.social.findFirst, 'aria-label': S.social.findFirst, 'data-find-first': '', autocomplete: 'off' }) as HTMLInputElement
    const last = el('input', { class: 'field', type: 'search', placeholder: S.social.findLast, 'aria-label': S.social.findLast, 'data-find-last': '', autocomplete: 'off' }) as HTMLInputElement
    const out = el('div', { class: 'social-hits', 'data-find-results': '' })
    const note = el('p', { class: 'meta', 'data-find-note': '' }, [trustedOnly(s) ? S.social.findOffServer : ''])
    const mine = identity()?.did
    const hitRow = (r: NameRecord): HTMLElement => {
      const peer = s.peers.find((x) => x.did === r.key)
      const person = s.people.find((x) => x.globalKey === r.key)
      const sent = person?.reachedOut === 'sent'
      const name = `${r.first} ${r.last}`
      const status = peer ? S.social.connected : S.social.notYet
      const action = peer || r.key === mine ? null : el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-find-intend': r.key, ...(sent ? { disabled: '' } : {}), onclick: () => intend(r, row) }, [sent ? S.social.intended : S.social.intend])
      const row: HTMLElement = el('div', { class: 'prow find-hit', 'data-find-hit': r.key }, [el('div', { class: 'who' }, [el('b', {}, [name]), el('i', { 'data-find-status': peer ? 'connected' : 'not-yet' }, [status])]), action])
      return row
    }
    async function intend(r: NameRecord, row: HTMLElement): Promise<void> {
      const id = identity(); const me = splitName(s.me.displayName)
      if (!id || !me.first || !me.last) { h.toast(S.social.intendNeedsName); return }
      markIntended(s as never, { first: r.first, last: r.last, key: r.key }, h.newId, h.now())
      h.save()
      await host()?.sendIntent(makeIntent((b) => signBytes(id, b), { to: r.key, first: me.first, last: me.last, key: id.did, ts: h.now() }))
      h.toast(S.social.intendSent(`${r.first} ${r.last}`))
      const b = row.querySelector('[data-find-intend]'); if (b) { b.setAttribute('disabled', ''); b.textContent = S.social.intended }
      h.render()
    }
    async function go(deep = false): Promise<void> {
      const f = first.value.trim(); const l = last.value.trim()
      if (!f || !l) return
      out.replaceChildren(el('p', { class: 'meta' }, [S.social.findBusy]))
      const node = host()
      const res = node ? await node.lookup(f, l, { deep }) : { records: [], via: null }
      const shown = res.records.filter((r) => r.key !== mine)
      const deepBtn = res.via === 'friends' && serversAllowed(s) && !deep ? [el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-find-deep': '', onclick: () => void go(true) }, [S.social.deep])] : []
      out.replaceChildren(
        ...(res.via ? [el('p', { class: 'meta', 'data-find-via': res.via }, [S.social.via[res.via]])] : []),
        ...(shown.length ? shown.map(hitRow) : [el('p', { class: 'meta', 'data-find-none': '' }, [S.social.findNone])]),
        ...deepBtn,
      )
    }
    const submit = (): void => void go()
    for (const i of [first, last]) i.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') submit() })
    return el('div', { class: 'social-find', 'data-social-find': '' }, [
      el('h4', { class: 'eyebrow' }, [S.social.findTitle]),
      el('div', { class: 'social-find-inputs' }, [first, last, el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-find-go': '', onclick: submit }, [S.social.findGo])]),
      note, out,
    ])
  }

  return {
    start,
    onHost: (did, m) => void host()?.onMessage(did, m),
    onHeard: (did) => host()?.seen(did),
    profileBlock, settingsGroup, findBlock, trustRow, connectButton,
  }
}
