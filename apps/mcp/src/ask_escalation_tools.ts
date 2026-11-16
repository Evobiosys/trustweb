// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-ask-escalation, MCP parity: ask_escalation_get / ask_escalation_set over the record.
 * `askShowAsked` (false = Closest few and Close are not told who else was asked; absent = on), `askEscalate` {text, zone} (the second round
 * "Do you know someone who has this?", queued: the app shows a card and sends only when the person taps Send) and, read-only, who the asks
 * held on this phone say were asked (HeldAsk.askedNames).
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { ZONES } from '../../trustweb/src/audience_zones.ts'
import type { Tool } from './protocol.ts'

interface Held { qid?: string; fromName?: string; askedNames?: string[] }
type Rec = Record<string, unknown> & { askShowAsked?: false; askEscalate?: { text: string; zone: string }; heldAsks?: Held[] }

function shape(r: Rec): Record<string, unknown> {
  return {
    showAsked: r.askShowAsked !== false,
    queued: r.askEscalate ?? null,
    askedWho: (r.heldAsks ?? []).filter((h) => Array.isArray(h.askedNames) && h.askedNames.length > 0).map((h) => ({ qid: h.qid, from: h.fromName, asked: h.askedNames })),
  }
}

export function askEscalationTools(o: { file: string; write: boolean }): Tool[] {
  const load = (): Rec => JSON.parse(readFileSync(o.file, 'utf8')) as Rec
  const read: Tool[] = [{
    name: 'ask_escalation_get', description: 'Ask escalation: whether an ask tells Closest few and Close who else was asked (showAsked), the queued second round "Do you know someone who has this?" (queued), and who the asks sent to me say were asked (askedWho; only asks from people who placed me as Closest few or Close).',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }, run: () => shape(load()),
  }]
  const write: Tool[] = [{
    name: 'ask_escalation_set', description: 'Set show_asked (true = Closest few and Close can see who was asked, the default), and/or queue the second round: escalate {text, zone (closest, close, friend)} asks that zone and narrower "Do you know someone who has this?" once the person taps Send in the app; discard:true removes the queued round.',
    inputSchema: {
      type: 'object',
      properties: {
        show_asked: { type: 'boolean' }, discard: { type: 'boolean' },
        escalate: { type: 'object', properties: { text: { type: 'string' }, zone: { type: 'string', enum: [...ZONES] } }, required: ['text', 'zone'], additionalProperties: false },
      },
      required: [], additionalProperties: false,
    },
    run: (a) => {
      const r = load()
      if (a.show_asked !== undefined && typeof a.show_asked !== 'boolean') throw new Error('show_asked is true or false')
      const e = a.escalate as { text?: unknown; zone?: unknown } | undefined
      if (e !== undefined) {
        const text = typeof e.text === 'string' ? e.text.trim().slice(0, 200) : ''
        if (!text) throw new Error('escalate needs the question text')
        if (!ZONES.includes(e.zone as never)) throw new Error(`zone is one of ${ZONES.join(', ')}`)
        r.askEscalate = { text, zone: e.zone as string }
      }
      if (a.discard === true) delete r.askEscalate
      if (a.show_asked === true) delete r.askShowAsked
      else if (a.show_asked === false) r.askShowAsked = false
      const tmp = o.file + '.tmp'
      writeFileSync(tmp, JSON.stringify(r))
      renameSync(tmp, o.file)
      return shape(r)
    },
  }]
  return [...read, ...(o.write ? write : [])]
}
