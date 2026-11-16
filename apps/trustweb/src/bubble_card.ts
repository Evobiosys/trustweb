// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-bubble-connect-3 (Jakob 2026-11-16): a person I am NOT yet connected to is dragged onto one I am. The sheet then gives a link + QR:
 * opened by the dragged person it connects them with me (placed as acquainted, `acq=1`) and carries the drop-target's contact card in the URL
 * FRAGMENT (`#ic=`, never sent to the app host): name, connect link, and only the lines I may share (the rules of qr_modes.ts `mode`, person).
 * Pure; no runtime imports (apps/mcp loads this file under plain node).
 */
import type { PeerRef, Who } from './bubble_connect'

export const CARD_KEY = 'ic'
/** A longer link does not fit a QR the camera reads; the sheet then says so and offers Copy only. */
export const CARD_LINK_MAX = 1800
/** Query parameter that places the opener as acquainted (bubble_links.ts INTRO_PARAM). */
const ACQ = 'acq=1'

export interface Card { n: string; l: string; u?: string; p?: string }
export type CardWho = Who & { publicUsername?: string; profile?: string }
export type LinkBlock = 'same' | 'blocked' | 'ask-first' | 'unknown' | 'target-not-connected'

const enc = (s: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const dec = (s: string): string => new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))

/** Link mode: the dragged person has no live connection, the drop target has. Null = allowed. */
export function linkBlock(dragged: Who, target: Who, peers: readonly PeerRef[]): LinkBlock | null {
  if (dragged.id === target.id) return 'same'
  if (!target.peerId || !peers.some((x) => x.id === target.peerId && x.did)) return 'target-not-connected'
  if ((dragged.blocked ?? 0) > 0 || (target.blocked ?? 0) > 0) return 'blocked'
  if (target.introducePermission === 'ask-first') return 'ask-first'
  return null
}

/** The card of `target`: name + connect link always; username unless ask-first; profile only with the option on and one-ring-closer (qr_modes.ts mode). */
export function cardOf(target: CardWho, targetLink: string, profileOption: boolean): Card {
  const perm = target.introducePermission ?? 'public'
  return {
    n: target.name, l: targetLink,
    ...(perm !== 'ask-first' && target.publicUsername ? { u: target.publicUsername } : {}),
    ...(profileOption && perm === 'one-ring-closer' && target.profile ? { p: target.profile } : {}),
  }
}

/** My connect link (query only) marked as an introduction, with the card behind the fragment. Null when it would not fit a QR. */
export function introLink(myLink: string, card: Card): string | null {
  const base = myLink.split('#')[0]
  const link = `${base}${base.includes('?') ? '&' : '?'}${ACQ}#${CARD_KEY}=${enc(JSON.stringify(card))}`
  return link.length <= CARD_LINK_MAX ? link : null
}

/** The card in an opened link's fragment; null for a link without one or a mangled one. Never throws. */
export function readCard(hash: string): Card | null {
  try {
    const raw = new URLSearchParams(hash.replace(/^#/, '')).get(CARD_KEY)
    const o: unknown = raw && JSON.parse(dec(raw))
    if (typeof o !== 'object' || o === null) return null
    const { n, l, u, p } = o as Record<string, unknown>
    if (typeof n !== 'string' || !n || typeof l !== 'string') return null
    if (!new URL(l).searchParams.get('connect')) return null
    return { n: n.slice(0, 60), l, ...(typeof u === 'string' && u ? { u: u.slice(0, 30) } : {}), ...(typeof p === 'string' && p ? { p: p.slice(0, 2000) } : {}) }
  } catch { return null }
}

/** The card's connect link as the opener takes it: acquainted, like the introduced link they came by. */
export const cardConnectLink = (c: Card): string => `${c.l}${c.l.includes('?') ? '&' : '?'}${ACQ}`

/** The connect link of a peer, on the same app address as `base` (my own connect link). */
export function peerLinkFrom(base: string, peer: PeerRef): string {
  const u = new URL(base)
  u.search = ''
  u.hash = ''
  u.searchParams.set('connect', peer.did)
  u.searchParams.set('id', peer.id)
  u.searchParams.set('name', peer.displayName)
  return u.toString()
}

interface LinkRecord { people?: CardWho[]; peers?: PeerRef[] }
/** The whole link for "dragged is not connected yet, target is": sheet and MCP tool share this. `profile` = the target's first messenger link. */
export function createIntroLink(rec: LinkRecord, draggedId: string, targetId: string, myLink: string, profileOption: boolean, profile?: string): { ok: true; link: string } | { ok: false; reason: LinkBlock | 'too-long' | 'dragged-connected' } {
  const dragged = rec.people?.find((p) => p.id === draggedId)
  const target = rec.people?.find((p) => p.id === targetId)
  if (!dragged || !target) return { ok: false, reason: 'unknown' }
  const peers = rec.peers ?? []
  const block = linkBlock(dragged, target, peers)
  if (block) return { ok: false, reason: block }
  if (dragged.peerId && peers.some((x) => x.id === dragged.peerId && x.did)) return { ok: false, reason: 'dragged-connected' }
  const link = introLink(myLink, cardOf({ ...target, ...(profile ? { profile } : {}) }, peerLinkFrom(myLink, peers.find((x) => x.id === target.peerId)!), profileOption))
  return link ? { ok: true, link } : { ok: false, reason: 'too-long' }
}
