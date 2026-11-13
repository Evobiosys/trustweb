// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 mcp-parity: the ONE list of tools the server offers (server.ts) and the tests check (mcp_parity.test.mjs, against MCP_TOOLS in
 * apps/trustweb/src/ext/mcp-local/mcp_config.ts and the action registry). A branch that adds a tool adds its tools function here.
 * Every tool that exists only with writes on announces itself after it ran (events.ts), so an open preview shows a card for it.
 */
import { announce } from './events.ts'
import { assistantTools } from './assistant_tools.ts'
import { billingTools } from './billing_tools.ts'
import { importTools } from './import_tools.ts'
import { parityTools } from './parity_tools.ts'
import { previewTools } from './preview_tools.ts'
import type { Tool } from './protocol.ts'
import { recordTools, type RecordToolsOptions } from './record_tools.ts'

export interface AllToolsOptions extends RecordToolsOptions {
  /** The server the app talks to (billing tools). Default https://app.trustweb.one. */
  apiBase?: string
  /** Loopback dev server of a preview: adds the review panel's tools (preview_rows, preview_verdict, preview_mark_merged). */
  previewUrl?: string
}

/** Tools that change the preview registry, not the record: no card in the preview. */
const NO_CARD = new Set(['preview_verdict', 'preview_mark_merged'])

export function allTools(o: AllToolsOptions, allow?: readonly string[]): Tool[] {
  const build = (write: boolean): Tool[] => [
    ...recordTools({ ...o, write }), ...assistantTools({ ...o, write }), ...parityTools({ ...o, write }), ...importTools({ ...o, write }),
    ...billingTools({ file: o.file, write, apiBase: o.apiBase || 'https://app.trustweb.one' }),
    ...(o.previewUrl ? previewTools({ url: o.previewUrl, write }) : []),
  ]
  const readOnly = new Set(build(false).map((t) => t.name))
  const now = o.now ?? (() => new Date())
  return build(o.write)
    .filter((t) => !allow || allow.includes(t.name))
    .map((t) => (readOnly.has(t.name) || NO_CARD.has(t.name) || t.name === 'app_action' ? t : {
      ...t,
      run: (a: Record<string, unknown>) => {
        const tell = (out: unknown): unknown => { announce(o.file, { at: now().toISOString(), kind: 'record', tool: t.name, summary: `${t.name} ${JSON.stringify(a)}`.slice(0, 200) }); return out }
        const out = t.run(a)
        return out instanceof Promise ? out.then(tell) : tell(out)
      },
    }))
}
