// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 mcp-local: "MCP & agents" under Settings > General > Extensions. Heavy: only this stub is in the main bundle; the rows load when the module is on.
 * The MCP server itself is apps/mcp (a separate program an agent starts); this module only explains how to connect it and keeps the list of
 * other services' MCP servers TrustWeb may call.
 */
import { S } from '../../strings'
import type { TwModule } from '../tw_registry'

export const module: TwModule = {
  id: 'mcp-local',
  title: S.mcp.title,
  description: S.mcp.desc,
  kind: 'settings',
  enabledByDefault: false,
  heavy: true,
  load: () => import('./mcp_body').then((m) => m.body),
}
