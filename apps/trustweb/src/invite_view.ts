// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-invite-link: the community invite in the app (rules and token: invite_policy.ts).
 *   inviter    Community > Members "Invite" opens the sheet: Personal (one person) and Open (can be passed on), each Copy + its QR shown at once
 *              (wave 45: the same .qrwrap + renderQr as the top-of-page share QR, payload = the signed link); Advanced (V
 *              expander): max uses of the open link, days of new links, revoke all. A connect-ack carrying a token is checked here
 *              (verdict) against this device's counter; an accepted one tags the new connection with the community (accepted).
 *   recipient  a link with `#inv=` shows the confirmation before anything is sent (gate): inviter name, community, "Only accept if <name>
 *              sent you this". Tampered, expired, or already taken on this phone: refused with a notice, nothing added. After the connect
 *              the community tag is defined here, the inviter carries it and this phone joins it (join).
 */
import { el } from '../../demo/src/ui/dom'
import { randomBytes, toB64u } from '../../demo/src/crypto'
import { signBytes, verifyDidSignature } from '../../demo/src/did'
import type { Identity } from '../../demo/src/did'
import type { ConnectLinkParams } from '../../demo/src/connect_link'
import type { ColourTag } from './colour_tags'
import { tagPerson, createTag } from './tag_create'
import { joinSpace } from './ext/community-mighty/community_model'
import type { AppState, Peer, Person } from './model'
import { S } from './strings'
import { groupOfTag } from './group_store' // wave45 group-chat-list
import {
  addInvite, createInvite, inviteLink, inviteOfHash, inviteSettingsOf, openInviteOf, redeemInvite, revokeInvites, setOpenMax, takeInvite,
  verifyInvite, type InviteEntry, type InviteKind, type InviteToken,
} from './invite_policy'

export interface InviteDeps {
  state(): AppState
  save(): void
  render(): void
  identity(): Identity
  connectLink(): Promise<string>
  openSheet(nodes: (Node | null)[]): void
  closeSheet(): void
  renderQr(target: HTMLElement, payload: string): Promise<void>
  copy(text: string, done: string): void
  notice(title: string, body: string): void
  toast(msg: string): void
  tags(): ColourTag[]
  saveTags(tags: readonly ColourTag[]): void
  /** wave45 group-chat-list: an invite whose tag is a group's (`grp:<id>`, group_store.ts) lets in to just that group, no community tag. */
  group?: { joined(gid: string, name: string, personId: string): void; admitted(gid: string, personId: string): void }
}

const T = S.invite
const day = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

export function createInvites(d: InviteDeps, hash: string) {
  /** The token of the opened link, used once (the confirmation runs for the connect it came with). */
  let incoming = inviteOfHash(hash)
  const verifier = (did: string) => (bytes: Uint8Array, sig: string): boolean => verifyDidSignature(did, bytes, sig)

  function make(kind: InviteKind, tag: string, name?: string): InviteEntry {
    const s = d.state()
    const id = d.identity()
    const label = name ?? d.tags().find((t) => t.id === tag)?.label ?? tag
    const e = createInvite({ kind, tag, label, inviterDid: id.did, inviterName: s.me.displayName, id: toB64u(randomBytes(16)), now: Date.now(), settings: s.inviteSettings, sign: (b) => signBytes(id, b) })
    s.invites = addInvite(s.invites, e)
    d.save()
    return e
  }

  /** The inviter's sheet for one community tag. */
  function openSheet(tag: string, name?: string): void {
    const label = name ?? d.tags().find((t) => t.id === tag)?.label ?? tag
    let personal: InviteEntry | null = null
    let advOpen = false
    const box = el('div', { class: 'invite-sheet', 'data-invite-sheet': tag })
    const qrBox = (attr: string): HTMLElement => el('div', { class: 'qrwrap invite-qr', [attr]: '' })
    const pQr = qrBox('data-invite-qr-personal')
    const oQr = qrBox('data-invite-qr-open')
    const linkOf = async (kind: InviteKind): Promise<string> => {
      const e = kind === 'personal' ? (personal ??= make('personal', tag, name)) : openInviteOf(d.state().invites, tag, Date.now()) ?? make('open', tag, name)
      const link = inviteLink(await d.connectLink(), e)
      draw()
      return link
    }
    const showQr = async (kind: InviteKind, target: HTMLElement): Promise<void> => {
      const link = await linkOf(kind)
      target.hidden = false
      target.dataset.link = link
      target.dataset.payload = link
      await d.renderQr(target, link)
    }
    const actions = (kind: InviteKind, target: HTMLElement): HTMLElement => el('div', { class: 'chips event-share' }, [
      el('button', { class: 'btn btn-ghost', type: 'button', [`data-invite-copy-${kind}`]: '', 'aria-label': `${T.copy}: ${kind === 'personal' ? T.personal : T.open}`, onclick: () => { void linkOf(kind).then((l) => d.copy(l, T.copied)) } }, [el('span', { 'aria-hidden': 'true' }, [S.w43press.iconLink]), ' ', el('u', {}, [T.copy])]),
      el('button', { class: 'btn btn-ghost', type: 'button', [`data-invite-qr-${kind}-btn`]: '', 'aria-label': `${T.qr}: ${kind === 'personal' ? T.personal : T.open}`, onclick: () => { void showQr(kind, target) } }, [el('span', { 'aria-hidden': 'true' }, [S.w43press.iconQr]), ' ', el('u', {}, [T.qr])]),
    ])
    const status = el('div', {})
    const adv = el('div', {})
    function draw(): void {
      const s = d.state()
      const now = Date.now()
      const mine = (s.invites ?? []).filter((e) => e.tag === tag)
      const open = openInviteOf(s.invites, tag, now)
      const pers = mine.filter((e) => e.kind === 'personal')
      status.replaceChildren(...[
        open ? el('p', { class: 'meta', 'data-invite-open-status': '' }, [T.openUses(open.uses.length, open.max, day(open.x))]) : null,
        pers.length ? el('p', { class: 'meta', 'data-invite-personal-status': '' }, [T.personalUses(pers.filter((e) => e.uses.length > 0).length, pers.length)]) : null,
      ].filter((n): n is NonNullable<typeof n> => n !== null))
      const cfg = inviteSettingsOf(s.inviteSettings)
      const num = (attr: string, aria: string, value: number, max: number, set: (v: number) => void): HTMLInputElement => {
        const input = el('input', { class: 'field optional', type: 'number', min: '1', max: String(max), value: String(value), 'aria-label': aria, [attr]: '' })
        input.addEventListener('change', () => { set(Number(input.value)); d.save(); draw() })
        return input
      }
      adv.replaceChildren(...[
        el('div', { class: 'roles-line' }, [
          el('span', { class: 'meta' }, [T.advanced]),
          el('button', { class: 'tw-expander', type: 'button', 'data-invite-advanced': '', 'aria-expanded': String(advOpen), 'aria-label': T.advanced, onclick: () => { advOpen = !advOpen; draw() } }, [advOpen ? '▴' : '▾']),
        ]),
        advOpen ? el('div', { class: 'invite-adv', 'data-invite-adv': '' }, [
          el('label', { class: 'meta' }, [T.maxUses, ' ', num('data-invite-max', T.maxUses, cfg.max, 1000, (v) => {
            const st = d.state()
            st.inviteSettings = { ...st.inviteSettings, max: inviteSettingsOf({ max: v }).max }
            st.invites = setOpenMax(st.invites, tag, v)
          })]),
          el('label', { class: 'meta' }, [T.days, ' ', num('data-invite-days', T.days, cfg.days, 365, (v) => {
            const st = d.state()
            st.inviteSettings = { ...st.inviteSettings, days: inviteSettingsOf({ days: v }).days }
          })]),
          el('small', { class: 'meta' }, [T.daysHint]),
          el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-invite-revoke': '', onclick: () => {
            const st = d.state()
            const r = revokeInvites(st.invites, tag)
            st.invites = r.ledger
            personal = null
            pQr.hidden = true
            oQr.hidden = true
            d.save()
            d.toast(T.revoked(r.revoked))
            draw()
          } }, [el('u', {}, [T.revokeAll])]),
        ]) : null,
      ].filter((n): n is NonNullable<typeof n> => n !== null))
    }
    draw()
    box.append(
      el('h3', {}, [T.title(label)]),
      el('div', { class: 'invite-kind', 'data-invite-kind': 'personal' }, [el('b', {}, [T.personal]), el('p', { class: 'meta' }, [T.personalHint]), actions('personal', pQr), pQr]),
      el('div', { class: 'invite-kind', 'data-invite-kind': 'open' }, [el('b', {}, [T.open]), actions('open', oQr), oQr]),
      status,
      adv,
    )
    d.openSheet([box])
    void showQr('personal', pQr)
    void showQr('open', oQr)
  }

  /**
   * Recipient: before the connect of an opened link. null = no invite with it; false = refused or declined (nothing is sent); a token =
   * the person confirmed (it rides inside the sealed connect-ack).
   */
  async function gate(link: ConnectLinkParams): Promise<string | null | false> {
    const tok = incoming
    incoming = null
    if (!tok) return null
    const v = verifyInvite(tok, link.did, Date.now(), verifier(link.did))
    if (!v.ok) { d.notice(T.refusedTitle, T.refused[v.reason]); return false }
    if ((d.state().invitesTaken ?? []).includes(v.inv.id)) { d.notice(T.refusedTitle, T.refused.used); return false }
    const yes = await confirm(v.inv)
    if (!yes) return false
    const s = d.state()
    s.invitesTaken = takeInvite(s.invitesTaken, v.inv.id)
    d.save()
    return tok
  }

  function confirm(inv: InviteToken): Promise<boolean> {
    return new Promise((resolve) => {
      const done = (v: boolean): void => { d.closeSheet(); resolve(v) }
      d.openSheet([el('div', { class: 'invite-accept', 'data-invite-accept': '' }, [
        el('h3', {}, [T.acceptTitle]),
        el('p', { 'data-invite-accept-lead': '' }, [T.acceptLead(inv.n, inv.l)]),
        el('p', { class: 'invite-warn', 'data-invite-accept-warn': '' }, [el('b', {}, [T.acceptWarn(inv.n)])]),
        el('div', { class: 'row' }, [
          el('button', { class: 'btn btn-electric', type: 'button', 'data-invite-accept-join': '', onclick: () => done(true) }, [T.acceptJoin]),
          el('button', { class: 'btn btn-ghost', type: 'button', 'data-invite-accept-no': '', onclick: () => done(false) }, [el('u', {}, [T.acceptNo])]),
        ]),
      ])])
    })
  }

  /** The community tag here: the token's id, defined (as a community) when this phone does not have it. */
  function ensureTag(id: string, label: string): void {
    const tags = d.tags()
    if (tags.some((t) => t.id === id)) return
    d.saveTags([...tags, { ...createTag(tags, label), id, community: true }])
  }

  /** Recipient, after the connect: the inviter carries the community tag and this phone joins it. */
  function join(tok: string, link: ConnectLinkParams, person: Person): void {
    const v = verifyInvite(tok, link.did, Date.now(), verifier(link.did))
    if (!v.ok) return
    const gid = groupOfTag(v.inv.t)
    if (gid) { d.group?.joined(gid, v.inv.l, person.id); d.toast(T.joined(v.inv.l)); return }   // wave45 group-chat-list
    ensureTag(v.inv.t, v.inv.l)
    tagPerson(person, v.inv.t)
    joinSpace(d.state(), d.tags(), v.inv.t, Date.now())
    d.save()
    d.toast(T.joined(v.inv.l))
  }

  /** Inviter: a connect-ack carried a token. Counted in this device's record; a refusal adds nothing and says why. */
  function verdict(inv: string, fromDid: string): boolean {
    const s = d.state()
    const id = d.identity()
    const r = redeemInvite(s.invites, inv, { myDid: id.did, fromDid, now: Date.now(), verify: verifier(id.did) })
    s.invites = r.ledger
    d.save()
    if (!r.ok && r.reason !== 'rate') d.notice(T.refusedTitle, T.inboundRefused(T.refused[r.reason]))
    return r.ok
  }

  /** Inviter: the accepted connection's card carries the community tag. */
  function accepted(peer: Peer, inv: string): void {
    const s = d.state()
    const e = (s.invites ?? []).find((x) => x.tok === inv)
    const person = s.people.find((p) => p.peerId === peer.id)
    if (!e || !person) return
    const gid = groupOfTag(e.tag)
    if (gid) { d.group?.admitted(gid, person.id); d.render(); return }   // wave45 group-chat-list
    tagPerson(person, e.tag)
    d.save()
    d.render()
  }

  return { openSheet, gate, join, verdict, accepted }
}
