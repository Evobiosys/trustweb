// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b hide-from-crypto (POLICY P02, MCP parity): ask_tamper_reports_list reads the verified reports that a device on the way changed
 * (or could not check) the sealed "Hide from" list of one of my asks (apps/trustweb/src/hide_reports.ts). Read only; no DID, no name.
 */
import { hideReportsList } from '../../trustweb/src/hide_reports.ts'
import { load, schema, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

export function hideTools(o: RecordToolsOptions): Tool[] {
  return [{
    name: 'ask_tamper_reports_list',
    description: 'Verified tamper reports of my asks\' sealed "Hide from" list, newest first: askId, text (the ask), step (1 = a direct contact found it, 2 = a friend of a friend, ...), why ("tampered" = a device on the way changed the list, the ask stopped there; "unsupported" = a device could not check it and did not pass the ask on), at.',
    inputSchema: schema({}),
    run: () => hideReportsList(load(o.file) as Parameters<typeof hideReportsList>[0]),
  }]
}
