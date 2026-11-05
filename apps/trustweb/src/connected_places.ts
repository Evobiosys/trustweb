// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 32 card-connected-icons: every place a person is connected with me, from what the card already holds. Pure, no DOM. */
import { toE164 } from './channel'
import { EMAIL_FIELD } from './intending_reminder'
import { Channel, Provenance } from './model'
import type { Person } from './model'
import { reachableChannels } from './contact_share'
import { sourceOfPerson } from './sources'
import { S } from './strings'

export interface ConnectedPlace {
  id: string
  /** The tooltip and aria-label. */
  label: string
  /** A key of ICONS (icons.ts). */
  icon: string
  /** Where a tap opens this channel; absent: the icon only tells. */
  href?: string
}

type Carrier = Pick<Person, 'id' | 'peerId' | 'channels' | 'theirChannels' | 'sources' | 'fields'>

/** TrustWeb first (a peer id is set), then the typed or shared messengers, a WhatsApp import, Phone (a number behind WhatsApp or Signal), Mail, and the Tana / notes source. */
export function connectedPlaces(p: Carrier): ConnectedPlace[] {
  const out: ConnectedPlace[] = []
  if (p.peerId) out.push({ id: 'trustweb', label: S.cardGlyphConnected, icon: 'web' })
  const reach = reachableChannels(p)
  const imported = p.sources?.some((s) => s.source === 'whatsapp') === true
  for (const ch of [...reach.map((r) => r.channel), ...(imported ? [Channel.WhatsApp] : [])].filter((c, i, all) => all.indexOf(c) === i)) {
    const r = reach.find((x) => x.channel === ch)
    out.push({ id: ch, label: S.chLabel[ch], icon: ch === Channel.Delta ? 'email' : ch, ...(r ? { href: r.link } : {}) })
  }
  const number = [Channel.WhatsApp, Channel.Signal].map((c) => toE164(reach.find((r) => r.channel === c)?.value ?? '')).find((n) => n !== null)
  if (number) out.push({ id: 'phone', label: S.connectedPhone, icon: 'phone', href: `tel:${number}` })
  const mail = p.fields?.[EMAIL_FIELD]
  if (mail) out.push({ id: 'mail', label: S.connectedMail, icon: 'email', href: `mailto:${mail}` })
  const src = sourceOfPerson(p)
  if (src === Provenance.Tana) out.push({ id: 'tana', label: S.connectedTana, icon: 'list' })
  if (src === Provenance.Local) out.push({ id: 'notes', label: S.connectedNotes, icon: 'list' })
  return out
}
