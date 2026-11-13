// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 mcp-parity: lists the assistant registry's actions and Settings registry entries against the MCP tools and prints what has no tool.
 *   node apps/mcp/scripts/parity_check.mjs        (exit 1 when anything is missing; node 22.18+ loads the .ts files itself)
 * Actions are read from the source (app_actions.ts is not loadable in node: it imports the app's enums), the rest from the registries themselves.
 * test/unit/mcp_parity.test.mjs checks the same against the real registry.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ACTION_MCP } from '../../trustweb/src/ext/assistant/actions.ts'
import { SETTINGS_REGISTRY } from '../../trustweb/src/settings_registry.ts'
import { allTools } from '../src/tools.ts'

/** Every file that defines registry actions (main.ts calls each define* on the one registry). */
const ACTION_FILES = ['app_actions.ts', 'event_actions.ts'].map((f) => fileURLToPath(new URL(`../../trustweb/src/${f}`, import.meta.url)))

export function parityReport() {
  const actions = ACTION_FILES.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/reg\.define(?:<[^\n]*?>)?\(\{\s*type: '([a-z-]+)'/g)].map((m) => m[1]))
  const tools = allTools({ file: '/nonexistent', write: true }).map((t) => t.name)
  const missing = [
    ...actions.filter((a) => !tools.includes(ACTION_MCP[a])).map((a) => `action ${a}`),
    ...SETTINGS_REGISTRY.filter((s) => s.type !== 'action' && !(s.get && s.set)).map((s) => `setting ${s.id}`),
    ...['settings_list', 'settings_get', 'settings_set'].filter((t) => !tools.includes(t)).map((t) => `tool ${t}`),
  ]
  return { actions, settings: SETTINGS_REGISTRY.map((s) => s.id), tools, missing }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = parityReport()
  console.log(`actions ${r.actions.length}: ${r.actions.map((a) => `${a}->${ACTION_MCP[a] ?? '?'}`).join(', ')}`)
  console.log(`settings ${r.settings.length}: all reachable through settings_list/get/set (screen entries open via app_action open)`)
  console.log(`tools ${r.tools.length}: ${r.tools.join(', ')}`)
  console.log(r.missing.length ? `MISSING: ${r.missing.join('; ')}` : 'parity ok')
  process.exit(r.missing.length ? 1 : 0)
}
