// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Invite someone (wave 21): the text and link of the share, and the share-or-copy step. No server call; the count is a number in the record. */
import { S } from './strings'

export interface Invite { title: string; text: string; url: string }

/** My public link when I hold a name, else the connect link the QR shows. */
export function inviteText(name: string | null, connectLink: string): Invite {
  const url = name ? `https://trustweb.one/${name}` : connectLink
  return { title: S.inviteTitle, text: `${S.inviteText} ${url}`, url }
}

export interface InviteIo { share?: (d: Invite) => Promise<void>; copy: (text: string) => Promise<void> }

/** Opens the share sheet when there is one, else copies the text. True when it resolved (counts as one invite sent). */
export async function sendInvite(inv: Invite, io: InviteIo): Promise<boolean> {
  try {
    if (io.share) await io.share(inv)
    else await io.copy(inv.text)
    return true
  } catch { return false }
}
