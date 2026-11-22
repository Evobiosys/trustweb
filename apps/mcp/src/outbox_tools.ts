// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 offline-outbox: Settings > Pending over MCP. outbox_list shows what waits to be sent and what went out lately (never the envelope's content). */
import { readFileSync } from 'node:fs'
import { shownItems } from '../../trustweb/src/outbox.ts'
import type { Tool } from './protocol.ts'

export function outboxTools(o: { file: string; now?: () => Date }): Tool[] {
  return [{
    name: 'outbox_list', description: 'Settings > Pending: messages (texts, hosting, event envelopes) saved offline and not yet sent, plus those sent in the last day, newest first: id, peerId, kind, state (waiting|sent|failed), tries, queuedAt, nextAt, sentAt.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    run: () => {
      const items = shownItems(JSON.parse(readFileSync(o.file, 'utf8')) as { sendQueue?: never }, (o.now ?? (() => new Date()))().getTime())
      return { waiting: items.filter((x) => x.state === 'waiting').length, items: items.map(({ env: _env, ...x }) => x) }
    },
  }]
}
