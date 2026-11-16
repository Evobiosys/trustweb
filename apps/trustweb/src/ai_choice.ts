// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-ask-placement-2: "Which AI answers?" Two choices, both kept at once: Claude (the TrustInTheWeb subscription) and
 * my own computer (the Custom endpoint, e.g. pc24). advanced.ai stays THE active endpoint (every call site already reads it);
 * the other one waits in advanced.aiAlt, so switching is one tap and loses nothing. The sign-up (sub, bill) follows the switch.
 * Pure: no DOM, no network; apps/mcp loads it through settings_registry.
 */
import type { AiEndpoint } from './model'

export const AI_CHOICES = ['claude', 'own'] as const
export type AiChoice = (typeof AI_CHOICES)[number]
export interface AiAdvanced { ai?: AiEndpoint; aiAlt?: AiEndpoint }

export const aiChoiceOf = (ai: AiEndpoint | undefined): AiChoice => (ai?.preset === 'tw-subscription' ? 'claude' : 'own')

/** What ai_subscription.ts activeEndpoint builds (a node-loadable copy: that module has no .ts import paths). */
const claudeEndpoint = (base: string, token: string): AiEndpoint => ({ preset: 'tw-subscription', baseUrl: `${base}/api/ai`, apiKey: token, model: 'trustweb' })
const blankOwn = (): AiEndpoint => ({ preset: 'custom', baseUrl: '', apiKey: '', model: '' })

/** Makes `to` the active endpoint; the previous one is kept in aiAlt. False (nothing changed) when Claude is chosen without a subscription token. */
export function chooseAi(adv: AiAdvanced, to: AiChoice, base = ''): boolean {
  const cur = adv.ai ?? blankOwn()
  if (aiChoiceOf(cur) === to) return true
  const kept = adv.aiAlt && aiChoiceOf(adv.aiAlt) === to ? adv.aiAlt : undefined
  const token = cur.sub?.token ?? kept?.sub?.token
  if (to === 'claude' && !kept && !token) return false
  const next = kept ?? (to === 'claude' ? claudeEndpoint(base, token as string) : blankOwn())
  const { sub: _sub, bill: _bill, ...stash } = cur
  adv.aiAlt = stash
  const sub = cur.sub ?? next.sub
  const bill = cur.bill ?? next.bill
  adv.ai = { ...next, ...(sub ? { sub } : {}), ...(bill ? { bill } : {}) }
  return true
}
