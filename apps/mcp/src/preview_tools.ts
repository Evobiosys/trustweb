// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 review-panel (MCP parity, P02): what the dev preview panel does, as tools over the dev server's /__tw/preview (loopback only):
 * preview_rows (read), preview_verdict and preview_mark_merged (write). Rows carry keys, titles and branches, never record data.
 */
import type { Tool } from './protocol.ts'

export interface PreviewToolsOptions { url: string; write: boolean; fetch?: typeof fetch }
type Obj = Record<string, unknown>
interface Row { key: string; title: string; branch: string; requires: string[]; checked: boolean; verdict?: string | null; merged?: boolean }
interface Reg { features: Row[]; assembled?: { error: string | null } | null; gate?: { action?: string } | null }

const need = (v: unknown, what: string): string => { if (typeof v !== 'string' || !v.trim()) throw new Error(`${what} is required`); return v.trim() }

export function previewTools(o: PreviewToolsOptions): Tool[] {
  const base = new URL(o.url)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('the preview url must be loopback (127.0.0.1)')
  const get = o.fetch ?? fetch
  async function call(method: 'GET' | 'POST', sub: string, body?: Obj): Promise<Reg> {
    const r = await get(new URL('/__tw/preview' + sub, base).toString(), { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
    const j = await r.json() as Reg & { error?: string }
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
    return j
  }
  const state = (f: Row): string => (f.verdict === 'merge' && f.checked ? 'approved' : f.verdict === 'needs-work' && !f.checked ? 'needs-work' : 'review')
  const schema = (properties: Obj, required: string[]): Obj => ({ type: 'object', properties, required, additionalProperties: false })
  const rows: Tool = {
    name: 'preview_rows', description: 'The review panel rows of the dev preview: key, title, branch, loaded, state (review | approved | needs-work), requires; plus the assembly conflict (first line and the gate action, e.g. "mark-merged <key>") when there is one.',
    inputSchema: schema({}, []),
    run: async () => {
      const p = await call('GET', '')
      const first = p.assembled?.error?.split('\n')[0]
      return {
        rows: p.features.filter((f) => !f.merged).map((f) => ({ key: f.key, title: f.title, branch: f.branch, loaded: f.checked, state: state(f), requires: f.requires })),
        ...(first ? { conflict: { first, ...(p.gate?.action ? { action: p.gate.action } : {}) } } : {}),
      }
    },
  }
  const write: Tool[] = [
    {
      name: 'preview_verdict', description: 'Set a review row\'s verdict: merge (approve), needs-work, or clear.',
      inputSchema: schema({ key: { type: 'string', description: 'row key' }, verdict: { type: 'string', enum: ['merge', 'needs-work', 'clear'] } }, ['key', 'verdict']),
      run: async (a) => {
        const key = need(a.key, 'key')
        if (a.verdict !== 'merge' && a.verdict !== 'needs-work' && a.verdict !== 'clear') throw new Error('verdict must be merge, needs-work or clear')
        await call('POST', '/verdict', { feature: key, verdict: a.verdict === 'clear' ? null : a.verdict })
        return { key, verdict: a.verdict }
      },
    },
    {
      name: 'preview_mark_merged', description: 'Mark a row as merged when its branch is already in main (the panel\'s "Mark as merged"; ops gate action "mark-merged <key>").',
      inputSchema: schema({ key: { type: 'string', description: 'row key' } }, ['key']),
      run: async (a) => { const key = need(a.key, 'key'); await call('POST', '/mark-merged', { feature: key }); return { key, marked: true } },
    },
  ]
  return [rows, ...(o.write ? write : [])]
}
