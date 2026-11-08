// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 37 (co-notes-link): the owner's invites and the guest's arrival, wired to the record and the relay. The rules live in co_invite.ts and
 * co_invite_relay.ts; this file only moves state. Every create, open and redeem leaves one readable line in the local log (I6).
 */
import { randomId } from '../../../../demo/src/crypto'
import { Ring } from '../../model'
import { S } from '../../strings'
import { merge, cleanDoc, type CoDoc } from './co_doc'
import type { CoCtx } from './co_editor'
import { advance, inviteUrl, newInvite, parseInviteLink, ringFor, type CoInvite, type InviteLink, type InviteMode } from './co_invite'
import { claimInvite, pollOpened, publishInvite, reportOpened, revokeInvite } from './co_invite_relay'
import { forSend } from './co_links'

const S_ = S.coLink

export type Created = { ok: true; invite: CoInvite } | { ok: false; why: 'norelay' | 'failed' }
export type Redeemed = { ok: true } | { ok: false; why: 'refused' | 'offline' }

export interface Linker {
  invites: (noteId: string) => CoInvite[]
  url: (inv: CoInvite) => string
  create: (doc: CoDoc, who: { name: string; did?: string; personId?: string; ring: Ring; mode?: InviteMode; watch?: boolean }) => Promise<Created>
  /** Takes the link back. True when the relay confirmed it (nobody had opened it). */
  remove: (inv: CoInvite) => Promise<boolean>
  /** Looks for guests that opened my links; true when something changed. */
  refresh: () => Promise<boolean>
  /** The link this address carries (readable before the record exists: the start screen of a new visitor). */
  pending: () => InviteLink | null
  redeem: (link: InviteLink) => Promise<Redeemed>
}

export function createLinker(c: CoCtx): Linker {
  const { h } = c
  const st = (): ReturnType<typeof h.state> => h.state()
  const all = (): CoInvite[] => st().coInvites ?? []
  const setAll = (next: CoInvite[]): void => { st().coInvites = next; h.save() }
  const owner = (): { did: string; id: string; name: string } => ({ did: h.me().did ?? '', id: st().me.id, name: st().me.displayName })
  const handled = new Set<string>()

  const invites = (noteId: string): CoInvite[] => all().filter((i) => i.noteId === noteId)
  const url = (inv: CoInvite): string => inviteUrl(h.origin, inv, owner())

  async function create(doc: CoDoc, who: Parameters<Linker['create']>[1]): Promise<Created> {
    const r = h.relay()
    if (!r) return { ok: false, why: 'norelay' }
    const inv = newInvite({ noteId: doc.id, now: Date.now(), ...who })
    const ev = doc.eventId ? st().events?.find((e) => e.id === doc.eventId) : undefined
    const sent = await publishInvite(r.deps, r.identity, inv, { doc: forSend(doc), ...(ev ? { event: h.eventLink(ev) } : {}) })
    if (!sent) return { ok: false, why: 'failed' }
    setAll([...all(), inv])
    c.log(`Made a ${inv.mode === 'anyone' ? 'anonymous link' : 'single-use link for ' + inv.name} to "${doc.title}"`)
    return { ok: true, invite: inv }
  }

  async function remove(inv: CoInvite): Promise<boolean> {
    const r = h.relay()
    const gone = inv.state === 'invited' && r ? await revokeInvite(r.deps, inv) : false
    setAll(all().filter((i) => i.id !== inv.id))
    c.log(`Removed the ${inv.mode === 'anyone' ? 'anonymous link' : 'link for ' + inv.name} to a note${gone ? ' (it no longer opens)' : ''}`)
    return gone
  }

  /** A guest connected: the person is in my web (in the ring I chose when they are new) and in the note. */
  function joined(inv: CoInvite, did: string, name: string): void {
    const people = st().people
    let person = people.find((p) => h.didOf(p.id) === did)
    if (!person) {
      person = { id: h.newId(), name: name || inv.name, context: '', ring: inv.ring, metAt: Date.now(), lines: [], did }
      people.push(person)
    } else {
      const ring = ringFor(inv, person)
      if (ring) person.ring = ring
    }
    const doc = c.get(inv.noteId)
    if (doc && !doc.people.some((p) => p.did === did)) {
      c.put({ ...doc, people: [...doc.people, { did, name: person.name }] })
      h.toast(S_.connectedNow(person.name))
    }
  }

  async function refresh(): Promise<boolean> {
    const r = h.relay()
    if (!r) return false
    let changed = false
    for (const inv of all().filter((i) => i.state !== 'connected' && (i.mode === 'person' || i.watch))) {
      let next = inv
      for (const hello of await pollOpened(r.deps, r.identity, inv)) {
        next = advance(next, 'opened', hello.at)
        if (inv.mode === 'anyone') h.toast(S_.someoneReading(c.get(inv.noteId)?.title ?? ''))
        else if (hello.did) { joined(inv, hello.did, hello.name ?? ''); next = advance(next, 'connected', hello.at) }
        c.log(`${inv.mode === 'anyone' ? 'Someone' : hello.name || inv.name} opened "${c.get(inv.noteId)?.title ?? ''}"`)
      }
      if (next !== inv) { setAll(all().map((i) => (i.id === inv.id ? next : i))); changed = true }
    }
    return changed
  }

  function pending(): InviteLink | null {
    const link = parseInviteLink(h.boot.search, h.boot.hash)
    return link && !handled.has(link.id) ? link : null
  }

  async function redeem(link: InviteLink): Promise<Redeemed> {
    const deps = h.relayDeps()
    if (!deps) return { ok: false, why: 'offline' }
    const s = st()
    s.coDevice ??= randomId(24)
    h.save()
    const got = await claimInvite(deps, link, s.coDevice)
    if (!got.ok) return got
    const snap = (got.snapshot ?? {}) as { doc?: unknown; event?: unknown }
    const incoming = cleanDoc(snap.doc)
    if (!incoming) return { ok: false, why: 'refused' }
    handled.add(link.id)
    const me = link.anonymous ? null : { did: h.me().did ?? '', name: h.me().name || '?' }
    const local = c.get(incoming.id)
    const base = local ? merge(local, incoming) : { ...incoming, mode: 'outline' as const }
    const doc = me?.did && !base.people.some((p) => p.did === me.did) ? { ...base, people: [...base.people, me] } : base
    s.coNotesOn = true
    c.put(doc, link.anonymous)
    const eventId = typeof snap.event === 'string' ? h.joinEventLink(snap.event) : null
    s.coGuest = { noteId: doc.id, inviteId: link.id, owner: link.owner, anonymous: link.anonymous, ...(eventId ? { eventId } : {}) }
    c.log(`Opened "${doc.title}" shared by ${link.owner.name || 'someone'}${link.anonymous ? ' (anonymous link)' : ''}`)
    h.save()
    if (!link.anonymous || link.watch) await reportOpened(deps, link, s.coDevice, me ? { name: me.name, did: me.did } : {}, Date.now())
    h.guestChanged(true)
    return { ok: true }
  }

  return { invites, url, create, remove, refresh, pending, redeem }
}
