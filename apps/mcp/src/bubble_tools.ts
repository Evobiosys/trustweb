// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-bubble-connect (MCP parity of holding one bubble on another): introduce_people queues "introduce A and B" in the record
 * (bubble_connect.ts queueIntro, the same rules as the sheet). The MCP process has no chat channel: the app sends each of the two the
 * other's code when it next runs. The write switch is the owner's consent here, as for every MCP write.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { queueIntro } from '../../trustweb/src/bubble_connect.ts'
import type { Tool } from './protocol.ts'

export function bubbleTools(o: { file: string; write: boolean; now?: () => Date }): Tool[] {
  if (!o.write) return []
  return [{
    name: 'introduce_people',
    description: 'Introduce two connected people: each gets the other\'s connect code in a chat text, and lands with the other as a friend / acquainted community member once they accept. Queued; the app sends it when it next runs. Refused for a blocked person or one who wants to be asked first.',
    inputSchema: { type: 'object', properties: { a: { type: 'string', description: 'person id of the first' }, b: { type: 'string', description: 'person id of the second' } }, required: ['a', 'b'], additionalProperties: false },
    run: (x) => {
      if (typeof x.a !== 'string' || typeof x.b !== 'string' || !x.a || !x.b) throw new Error('a and b are required person ids')
      const r = JSON.parse(readFileSync(o.file, 'utf8')) as Parameters<typeof queueIntro>[0]
      const out = queueIntro(r, x.a, x.b, (o.now ?? (() => new Date()))().getTime())
      if (!out.ok) throw new Error(`cannot introduce: ${out.reason}`)
      const tmp = o.file + '.tmp'
      writeFileSync(tmp, JSON.stringify(r))
      renameSync(tmp, o.file)
      return { queued: true, ...(out.already ? { already: true } : {}) }
    },
  }]
}
