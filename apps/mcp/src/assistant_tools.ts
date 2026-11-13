// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 assistant: the assistant's settings and one question to it, over the same record file as record_tools.ts and the same provider
 * chain as the app (trustweb/src/ext/assistant/providers.ts, Berget > Infomaniak > pc24). Keys are never returned. The question
 * carries no people and no notes: only the identity line and the text asked.
 */
import { renameSync, writeFileSync } from 'node:fs'
import { applyModel, chainOf, completeOnce, identityLine, runChain, type AssistantCfg, type Thinking, THINKING } from '../../trustweb/src/ext/assistant/providers.ts'
import { load } from './record_tools.ts'
import type { Tool } from './protocol.ts'

export interface AssistantToolsOptions {
  file: string
  /** Offer the tool that changes the record. */
  write: boolean
  fetchFn?: typeof fetch
}

const schema = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({ type: 'object', properties, required, additionalProperties: false })
const S = (description: string): Record<string, unknown> => ({ type: 'string', description })

export function assistantTools(o: AssistantToolsOptions): Tool[] {
  const advanced = (): { ai?: never; assistant?: AssistantCfg } => (load(o.file).advanced ?? {}) as never
  const providers = (): unknown => chainOf(advanced() as never).map((p, i) => ({ order: i + 1, id: p.id, name: p.name, model: p.model, address: p.baseUrl }))

  const read: Tool[] = [
    {
      name: 'assistant_providers', description: 'The assistant\'s provider chain in the order it is tried (Berget, Infomaniak, then the own endpoint as pc24): id, name, model, address. Never keys.',
      inputSchema: schema({}),
      run: () => ({ providers: providers(), thinking: advanced().assistant?.thinking ?? null }),
    },
    {
      name: 'assistant_ask', description: 'Ask the assistant one question through the provider chain; returns the answer and which provider and model gave it. Sends only the question, no people or notes.',
      inputSchema: schema({ text: S('the question') }, ['text']),
      run: async (a) => {
        const text = typeof a.text === 'string' ? a.text.trim() : ''
        if (!text) throw new Error('text is required')
        const adv = advanced()
        const r = await runChain(chainOf(adv as never), (p, c) => completeOnce(p, [{ role: 'system', content: `You are the TrustWeb assistant. ${identityLine(p)}` }, { role: 'user', content: text }], c, o.fetchFn, adv.assistant?.thinking))
        return { provider: r.provider.name, model: r.provider.model, text: r.text }
      },
    },
  ]
  const write: Tool[] = [
    {
      name: 'assistant_set_model', description: 'Same as /model in the chat: a provider id (berget, infomaniak, pc24) makes it the first link; any other text is the model id of the first link. Optional thinking: off, low, medium, high.',
      inputSchema: schema({ id: S('provider id or model id'), thinking: S('off | low | medium | high') }, ['id']),
      run: (a) => {
        const rec = load(o.file)
        let cfg = applyModel(rec.advanced?.assistant ?? {}, typeof a.id === 'string' ? a.id : '')
        if (a.thinking !== undefined) {
          if (!THINKING.includes(a.thinking as Thinking)) throw new Error(`thinking must be one of ${THINKING.join(', ')}`)
          cfg = { ...cfg, thinking: a.thinking as Thinking }
        }
        rec.advanced = { ...rec.advanced, assistant: cfg }
        const tmp = o.file + '.tmp'
        writeFileSync(tmp, JSON.stringify(rec))
        renameSync(tmp, o.file)
        return { assistant: { prefer: cfg.prefer ?? null, model: cfg.model ?? null, thinking: cfg.thinking ?? null } }
      },
    },
  ]
  return [...read, ...(o.write ? write : [])]
}
