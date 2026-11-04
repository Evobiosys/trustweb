// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 31 wabridge-ingest: reads the JSON of trustweb-ops/phone/wa_phone_export.py (whatsapp-phone-export.json) into the same shapes the chat
 * .txt parser gives planServices (contacts + evidence + one-to-one / group maps), plus the interaction signals and item guesses per person.
 * Pure. A message row carries time, direction and kind; text only when the owner exported it with --with-text, and only guessItems reads it.
 */
import { normalizeName } from '../../crm/src/import/dedup'
import { ContactSource } from '../../crm/src/import/types'
import type { ImportedContact } from '../../crm/src/import/types'
import type { Evidence } from '../../crm/src/import/evidence'
import { guessItems } from './inventory_guess'
import type { Guess } from './inventory_guess'
import { closeness, signalsFor } from './interaction_signals'
import type { Msg } from './interaction_signals'

interface ExportMessage { chat: string; sender: string | null; from_me: boolean; ts: number; text?: string }
export interface PhoneExport {
  contacts: { jid: string; name?: string | null; phone?: string | null }[]
  chats: { jid: string; name?: string | null; is_group: boolean; participants?: string[] }[]
  messages: ExportMessage[]
}

/** null unless the text is the phone export (cheap check first: chat .txt files never start with a brace). */
export function parsePhoneExport(text: string): PhoneExport | null {
  if (!text.trimStart().startsWith('{')) return null
  try {
    const j = JSON.parse(text) as Partial<PhoneExport>
    return Array.isArray(j.contacts) && Array.isArray(j.chats) && Array.isArray(j.messages) ? (j as PhoneExport) : null
  } catch { return null }
}
export const isPhoneExport = (text: string): boolean => parsePhoneExport(text) !== null
/** Messages in the text without parsing it twice. */
export const phoneMessageCount = (text: string): number => text.split('"from_me"').length - 1

export interface PhoneExtras { closeness: number; items: Guess[] }
export interface PhoneRead {
  contacts: ImportedContact[]
  evidence: Evidence[]
  /** sourceRef of people seen in a one-to-one chat. */
  direct: Set<string>
  /** sourceRef -> the first group the person was seen in. */
  groupOf: Map<string, string>
  extras: Map<string, PhoneExtras>
}

const ITEMS_MAX = 10
const digits = (jid: string): string => jid.split('@')[0].replace(/\D/g, '')

export function readPhoneExport(px: PhoneExport, file: string, now: number): PhoneRead {
  const known = new Map(px.contacts.map((c) => [c.jid, c]))
  const chatName = new Map(px.chats.filter((c) => !c.is_group).map((c) => [c.jid, c.name]))
  const nameOf = (jid: string): string => known.get(jid)?.name || chatName.get(jid) || (digits(jid) ? `+${digits(jid)}` : jid)
  const refOf = (jid: string): string => `wa:${normalizeName(nameOf(jid))}`

  const contacts = new Map<string, ImportedContact>()
  const add = (jid: string): string => {
    const ref = refOf(jid)
    if (!contacts.has(ref)) {
      const phone = known.get(jid)?.phone || digits(jid)
      contacts.set(ref, { source: ContactSource.WhatsApp, file, sourceRef: ref, name: nameOf(jid), phones: phone ? [phone] : [], emails: [], labels: [] })
    }
    return ref
  }
  const groups = new Map(px.chats.filter((c) => c.is_group).map((c) => [c.jid, c]))
  const direct = new Set<string>()
  const groupOf = new Map<string, string>()
  const evidence: Evidence[] = []
  const chatMsgs = new Map<string, Msg[]>()
  const texts = new Map<string, string[]>()
  const shared = new Map<string, Set<string>>()
  const share = (ref: string, group: string): void => { shared.set(ref, (shared.get(ref) ?? new Set()).add(group)) }

  px.messages.forEach((m, i) => {
    if (!Number.isFinite(m.ts)) return
    const g = groups.get(m.chat)
    // As in the .txt parser: in a group my own line has no single recipient, so it is no evidence.
    if (m.from_me && g) return
    const jid = g ? m.sender : m.chat
    if (!jid) return
    const ref = add(jid)
    if (g) { if (!groupOf.has(ref)) groupOf.set(ref, g.name || g.jid); share(ref, g.jid) } else direct.add(ref)
    evidence.push({ id: `wa:${file}:${i}`, personKey: ref, source: ContactSource.WhatsApp, ts: m.ts, dir: m.from_me ? 'out' : 'in', kind: 'msg', ref: `${file}#msg:${i}` })
    if (g) return
    chatMsgs.set(ref, [...(chatMsgs.get(ref) ?? []), { ts: m.ts, fromMe: m.from_me }])
    if (!m.from_me && m.text) texts.set(ref, [...(texts.get(ref) ?? []), m.text])
  })
  for (const g of groups.values()) for (const jid of g.participants ?? []) if (known.has(jid) || chatName.has(jid)) { const ref = refOf(jid); if (contacts.has(ref)) share(ref, g.jid) }

  const extras = new Map<string, PhoneExtras>()
  for (const ref of contacts.keys()) {
    const sig = signalsFor(chatMsgs.get(ref) ?? [], shared.get(ref)?.size ?? 0)
    extras.set(ref, { closeness: closeness(sig, now), items: guessItems(texts.get(ref) ?? []).slice(0, ITEMS_MAX) })
  }
  return { contacts: [...contacts.values()], evidence, direct, groupOf, extras }
}
