// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// WhatsApp chat export (_chat.txt, iOS and Android layouts) -> counterparts + interaction evidence. Pure; never throws.
// Message TEXT is read only to find the sender and is never copied anywhere: evidence rows carry time, direction and a line reference.
import { normalizeName, normalizePhone } from './dedup'
import type { Evidence } from './evidence'
import { ContactSource, type ImportedContact } from './types'

export interface WhatsAppOptions {
  /** The owner's own display name as it appears in the export ("You" is not a name the export uses for others). */
  me: string
  /** Overrides the date-order guess when the export is ambiguous (every date has day and month <= 12). */
  dayFirst?: boolean
}

export interface WhatsAppResult {
  contacts: ImportedContact[]
  evidence: Evidence[]
  /** 'ambiguous': no date had a day above 12, so `dayFirst` (default true) was used; the caller may ask once. */
  dateOrder: 'dmy' | 'mdy' | 'ambiguous'
}

// "[DD.MM.YY, HH:MM:SS] Name: text" (iOS) and "DD/MM/YYYY, HH:MM - Name: text" (Android); the separators vary by locale.
const HEADER = /^\[?(\d{1,2})[./](\d{1,2})[./](\d{2,4}),? (\d{1,2}:\d{2}(?::\d{2})?)(?:\]|\s-)\s?(.*)$/
const SENDER = /^([^:]{1,80}?): /
// Bidi and no-break marks some exporters put in front of a line.
const INVISIBLE = /^[‎‏‪-‮﻿]+/

interface Raw { a: number; b: number; y: number; time: string; sender: string | null; line: number }

function scan(text: string): Raw[] {
  const out: Raw[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const m = HEADER.exec(raw.replace(INVISIBLE, ''))
    if (!m) return
    const y = Number(m[3])
    const sender = SENDER.exec(m[5])
    out.push({
      a: Number(m[1]),
      b: Number(m[2]),
      y: y < 100 ? 2000 + y : y,
      time: m[4],
      sender: sender ? sender[1].trim() : null,
      line: i + 1,
    })
  })
  return out
}

function dateOrderOf(rows: readonly Raw[]): WhatsAppResult['dateOrder'] {
  if (rows.some((r) => r.a > 12)) return 'dmy'
  if (rows.some((r) => r.b > 12)) return 'mdy'
  return 'ambiguous'
}

function toMs(r: Raw, dayFirst: boolean): number {
  const [day, month] = dayFirst ? [r.a, r.b] : [r.b, r.a]
  const [h, mi, s = '0'] = r.time.split(':')
  return Date.UTC(r.y, month - 1, day, Number(h), Number(mi), Number(s))
}

const personKeyOf = (name: string): string => `wa:${normalizeName(name)}`

export function parseWhatsApp(text: string, file: string, opts: WhatsAppOptions): WhatsAppResult {
  try {
    const rows = scan(text)
    const dateOrder = dateOrderOf(rows)
    const dayFirst = dateOrder === 'mdy' ? false : dateOrder === 'dmy' ? true : opts.dayFirst ?? true
    const me = normalizeName(opts.me)
    const messages = rows.filter((r) => r.sender !== null)
    const others = new Map<string, string>()
    for (const r of messages) {
      const key = normalizeName(r.sender!)
      if (key && key !== me && !others.has(key)) others.set(key, r.sender!.trim())
    }
    // A my-message counts as "out" only in a one-to-one chat; in a group the owner's line has no single recipient.
    const oneToOne = others.size === 1
    const evidence: Evidence[] = []
    for (const r of messages) {
      const key = normalizeName(r.sender!)
      const mine = key === me
      if (mine && !oneToOne) continue
      const counterpart = mine ? [...others.keys()][0] : key
      if (!counterpart) continue
      evidence.push({
        id: `wa:${file}:${r.line}`,
        personKey: personKeyOf(others.get(counterpart) ?? r.sender!),
        source: ContactSource.WhatsApp,
        ts: toMs(r, dayFirst),
        dir: mine ? 'out' : 'in',
        kind: 'msg',
        ref: `${file}#line:${r.line}`,
      })
    }
    const contacts: ImportedContact[] = [...others.entries()].map(([key, name]) => {
      const phone = normalizePhone(name)
      return {
        source: ContactSource.WhatsApp,
        file,
        sourceRef: `wa:${key}`,
        name,
        phones: phone ? [phone] : [],
        emails: [],
        labels: [],
      }
    })
    return { contacts, evidence, dateOrder }
  } catch {
    return { contacts: [], evidence: [], dateOrder: 'ambiguous' }
  }
}
