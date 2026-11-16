// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-bubble-connect (MCP parity of holding one bubble on another): introduce_people queues "introduce A and B" in the record
 * (bubble_connect.ts queueIntro, the same rules as the sheet). The MCP process has no chat channel: the app asks the acceptor when it next runs. The write switch is the owner's consent here, as for every MCP write.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createIntroLink } from '../../trustweb/src/bubble_card.ts'
import { queueIntro } from '../../trustweb/src/bubble_connect.ts'
import { linkEntries } from '../../trustweb/src/person_links.ts'
import type { Tool } from './protocol.ts'

export function bubbleTools(o: { file: string; write: boolean; now?: () => Date }): Tool[] {
  if (!o.write) return []
  return [{
    name: 'introduce_people',
    description: 'Introduce two connected people: the REQUESTER (the person dragged, who asked for the introduction) to the ACCEPTOR (the person dropped onto). The acceptor is asked "<requester> would like to connect with you, introduced by you" and can accept or decline; the requester gets the acceptor\'s connect code only after acceptance, and both land with each other as friends / acquainted community members. Queued; the app sends it when it next runs. Refused for a blocked person or one who wants to be asked first.',
    inputSchema: { type: 'object', properties: { requester: { type: 'string', description: 'person id of the one who asked for the introduction' }, acceptor: { type: 'string', description: 'person id of the one who must accept' } }, required: ['requester', 'acceptor'], additionalProperties: false },
    run: (x) => {
      if (typeof x.requester !== 'string' || typeof x.acceptor !== 'string' || !x.requester || !x.acceptor) throw new Error('requester and acceptor are required person ids')
      const r = JSON.parse(readFileSync(o.file, 'utf8')) as Parameters<typeof queueIntro>[0]
      const out = queueIntro(r, x.requester, x.acceptor, (o.now ?? (() => new Date()))().getTime())
      if (!out.ok) throw new Error(`cannot introduce: ${out.reason}`)
      const tmp = o.file + '.tmp'
      writeFileSync(tmp, JSON.stringify(r))
      renameSync(tmp, o.file)
      return { queued: true, ...(out.already ? { already: true } : {}) }
    },
  }, {
    name: 'introduce_link_create',
    description: 'Make the introduction link for a person who is NOT connected on TrustWeb yet (dragged) and a connected person (target). Opening the link connects the dragged person with you as acquainted and brings the target\'s card (name, connect link, and only the lines the target lets others pass on). Returns the link; render it as a QR or send it. Needs this account\'s connect code (open the app once). Refused for a blocked person or one who wants to be asked first.',
    inputSchema: { type: 'object', properties: { dragged: { type: 'string', description: 'person id of the one not connected yet' }, target: { type: 'string', description: 'person id of the connected person whose card travels along' } }, required: ['dragged', 'target'], additionalProperties: false },
    run: (x) => {
      if (typeof x.dragged !== 'string' || typeof x.target !== 'string' || !x.dragged || !x.target) throw new Error('dragged and target are required person ids')
      const r = JSON.parse(readFileSync(o.file, 'utf8')) as Parameters<typeof createIntroLink>[0] & { connectCode?: { url?: string }; qrProfileOption?: boolean }
      const mine = r.connectCode?.url
      if (!mine) throw new Error('no connect link yet: open the app once so it makes this account\'s connect code')
      const target = r.people?.find((p) => p.id === x.target) as (NonNullable<typeof r.people>[number] & { links?: Record<string, string> }) | undefined
      const out = createIntroLink(r, x.dragged, x.target, mine, Boolean(r.qrProfileOption), target ? linkEntries(target)[0]?.url : undefined)
      if (!out.ok) throw new Error(`cannot make the link: ${out.reason}`)
      return { link: out.link }
    },
  }]
}
