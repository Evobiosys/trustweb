// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-ask-placement-2 (POLICY P02, MCP parity): "Which AI answers?" in Settings > Your AI. Claude (the subscription) or my own
 * computer (the Custom endpoint, e.g. pc24); both stay set up, the choice swaps which one is advanced.ai (apps/trustweb/src/ai_choice.ts).
 */
import { AI_CHOICES, aiChoiceOf, chooseAi, type AiAdvanced, type AiChoice } from '../../trustweb/src/ai_choice.ts'
import { commitTo, load, schema, type Rec, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

const answers = (r: Rec): { answers: AiChoice; claudeReady: boolean; ownReady: boolean } => {
  const adv = (r.advanced ?? {}) as AiAdvanced
  const set = [adv.ai, adv.aiAlt]
  return { answers: aiChoiceOf(adv.ai), claudeReady: set.some((e) => Boolean(e?.sub?.token)), ownReady: set.some((e) => e !== undefined && aiChoiceOf(e) === 'own' && Boolean(e.baseUrl.trim() && e.model.trim())) }
}

export function aiChoiceTools(o: RecordToolsOptions): Tool[] {
  const read: Tool[] = [{
    name: 'ai_provider_get', description: 'Which AI answers (Settings > Your AI): "claude" (the TrustInTheWeb subscription) or "own" (my own computer, e.g. pc24), and whether each is set up.',
    inputSchema: schema({}), run: () => answers(load(o.file)),
  }]
  if (!o.write) return read
  return [...read, {
    name: 'ai_provider_set', description: 'Choose which AI answers: "claude" or "own". Both stay set up; the other waits. "claude" needs the subscription first.',
    inputSchema: schema({ provider: { type: 'string', enum: [...AI_CHOICES] } }, ['provider']),
    run: (a) => {
      const to = String(a.provider)
      if (!(AI_CHOICES as readonly string[]).includes(to)) throw new Error(`provider must be one of ${AI_CHOICES.join(', ')}`)
      let out = answers(load(o.file))
      commitTo(o.file, o.now ?? (() => new Date()), (r) => {
        const adv = (r.advanced ??= {}) as AiAdvanced
        if (!chooseAi(adv, to as AiChoice)) throw new Error('Claude needs the subscription first (Settings > Your AI)')
        out = answers(r)
      })
      return out
    },
  }]
}
