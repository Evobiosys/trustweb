// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c seen-through (POLICY P02, MCP parity): people_seen_through_list reads the people I see only through a friend (apps/trustweb/src/seen_through.ts). Read only; a nameless one carries no name. */
import { seenThroughList } from '../../trustweb/src/seen_through.ts'
import { load, schema, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

export function seenThroughTools(o: RecordToolsOptions): Tool[] {
  return [{
    name: 'people_seen_through_list',
    description: 'People seen only through a friend, drawn outside the Web rings: id, name (empty when they did not agree to be shown), anonymous, via (the friend\'s id) and viaName, source ("event" introduction, "intro" ask, resource "ask"), resource (the ask), event (its id), at.',
    inputSchema: schema({}),
    run: () => seenThroughList(load(o.file) as unknown as Parameters<typeof seenThroughList>[0]),
  }]
}
