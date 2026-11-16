// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-invite-link (MCP parity): the community invite links of Community > Members > Invite (apps/trustweb/src/invite_policy.ts).
 * invite_link_create signs with the record's relay identity through node:crypto (Ed25519, same bytes as the app's @noble signBytes) and
 * derives the QR key of the v2 connect link the same way (HKDF-SHA256, handshake_crypto.ts qrSecretOf). Never returns a DID of a recipient.
 */
import { createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto'
import { buildConnectLinkUrl } from '../../demo/src/connect_link.ts'
import { addInvite, createInvite, inviteLink, inviteStatus, revokeInvites, type InviteEntry, type InviteSettings } from '../../trustweb/src/invite_policy.ts'
import { S, commitTo, load, schema, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

interface InvRec { me?: { id?: string; displayName?: string }; identity?: { did?: string; signingSecretKey?: string; keyAgreementSecretKey?: string }; invites?: InviteEntry[]; inviteSettings?: InviteSettings }

const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex')
const DEFAULT_ORIGIN = 'https://app.trustweb.one/'

function keysOf(r: InvRec): { did: string; sign: (b: Uint8Array) => string; qk: string } {
  const id = r.identity
  if (!id?.did || !id.signingSecretKey || !id.keyAgreementSecretKey) throw new Error('this record has no relay identity yet: open the app once on this device')
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, Buffer.from(id.signingSecretKey, 'base64url')]), format: 'der', type: 'pkcs8' })
  const qk = Buffer.from(hkdfSync('sha256', Buffer.from(id.keyAgreementSecretKey, 'base64url'), Buffer.alloc(0), 'tw-qr-secret-v2', 16)).toString('base64url')
  return { did: id.did, sign: (b) => sign(null, b, key).toString('base64url'), qk }
}

export function inviteTools(o: RecordToolsOptions): Tool[] {
  const now = o.now ?? (() => new Date())
  const read: Tool = {
    name: 'invite_link_status',
    description: 'The community invite links of this device: per link id, kind ("personal" = one person, "open" = can be passed on), tag, community, uses, max, expiresAt (ms) and state (active | used | expired | revoked). Optional tag filters. Never a DID or the token.',
    inputSchema: schema({ tag: S('Community tag id (optional)') }),
    run: (a) => ({ links: inviteStatus((load(o.file) as InvRec).invites, now().getTime(), typeof a.tag === 'string' && a.tag ? a.tag : undefined) }),
  }
  if (!o.write) return [read]
  const create: Tool = {
    name: 'invite_link_create',
    description: 'Make a community invite link (Community > Members > Invite): kind "personal" (works once, for the first person who accepts) or "open" (can be passed on, up to max_uses people; default 10). Expires after days (default 30). Returns {link, id, kind, tag, max, expiresAt}. The link carries a token signed with this device\'s key; the person sees your name and the community before joining.',
    inputSchema: schema({
      kind: S('"personal" or "open"'), tag: S('Community tag id'), label: S('Community name shown to the invited person (default: the tag)'),
      max_uses: { type: 'number', description: 'Open link: how many people (default 10)' }, days: { type: 'number', description: 'Days the link works (default 30)' },
      origin: S('App address the link opens (default https://app.trustweb.one/)'),
    }, ['kind', 'tag']),
    run: (a) => {
      if (a.kind !== 'personal' && a.kind !== 'open') throw new Error('kind must be "personal" or "open"')
      const tag = typeof a.tag === 'string' ? a.tag.trim() : ''
      if (!tag) throw new Error('tag is required')
      const r = load(o.file) as InvRec
      const k = keysOf(r)
      const settings: InviteSettings = { ...r.inviteSettings, ...(typeof a.max_uses === 'number' ? { max: a.max_uses } : {}), ...(typeof a.days === 'number' ? { days: a.days } : {}) }
      const e = createInvite({ kind: a.kind, tag, label: typeof a.label === 'string' && a.label.trim() ? a.label.trim() : tag, inviterDid: k.did, inviterName: r.me?.displayName ?? '', id: randomBytes(16).toString('base64url'), now: now().getTime(), settings, sign: k.sign })
      commitTo(o.file, now, (x) => { (x as InvRec).invites = addInvite((x as InvRec).invites, e) })
      const connect = buildConnectLinkUrl(typeof a.origin === 'string' && a.origin ? a.origin : DEFAULT_ORIGIN, k.did, { id: r.me?.id ?? '', displayName: r.me?.displayName ?? '' }, k.qk)
      return { link: inviteLink(connect, e), id: e.id, kind: e.kind, tag: e.tag, max: e.max, expiresAt: e.x }
    },
  }
  const revoke: Tool = {
    name: 'invite_link_revoke',
    description: 'Revoke all invite links of a community tag (all tags when absent): they stop working; the counter keeps them. Returns {revoked}.',
    inputSchema: schema({ tag: S('Community tag id (optional)') }),
    run: (a) => {
      let revoked = 0
      commitTo(o.file, now, (x) => { const out = revokeInvites((x as InvRec).invites, typeof a.tag === 'string' && a.tag ? a.tag : undefined); (x as InvRec).invites = out.ledger; revoked = out.revoked })
      return { revoked }
    },
  }
  return [read, create, revoke]
}
