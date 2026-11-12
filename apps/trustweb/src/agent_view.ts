// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Settings > AI > Agent (pi): the loopback address and a Check button; a good answer unlocks the Your AI button (ai_button.ts). */
import { el } from '../../demo/src/ui/dom'
import { AGENT_DEFAULT_URL, checkAgent, piConnected } from './ai_button'
import type { AgentLink, AppState } from './model'
import { S } from './strings'

export function agentSettings(h: { state: () => AppState; save: () => void }): HTMLElement[] {
  const link = (): AgentLink => (h.state().agent ??= { baseUrl: AGENT_DEFAULT_URL })
  const result = el('p', { class: 'meta', 'data-agent-result': '' })
  const show = (): void => {
    const at = h.state().agent?.connectedAt
    result.textContent = piConnected(h.state().agent, Date.now()) && at ? S.agentConnected(new Date(at).toLocaleTimeString()) : S.agentNotConnected
  }
  const input = el('input', { class: 'field', type: 'url', placeholder: S.agentUrl, 'aria-label': S.agentUrl, value: link().baseUrl, autocomplete: 'off', 'data-agent-url': '' }) as HTMLInputElement
  input.addEventListener('change', () => { link().baseUrl = input.value.trim(); delete link().connectedAt; h.save(); show() })
  const check = el('button', {
    class: 'btn btn-ghost btn-sm', 'data-agent-check': '',
    onclick: async () => {
      link().baseUrl = input.value.trim()
      result.textContent = S.agentChecking
      if (await checkAgent(link().baseUrl)) link().connectedAt = new Date().toISOString(); else delete link().connectedAt
      h.save(); show()
    },
  }, [S.agentCheck])
  show()
  return [el('div', { class: 'channels', 'data-agent': '' }, [el('h4', { class: 'eyebrow' }, [S.agentBlockTitle]), input, check, result, el('p', { class: 'meta' }, [S.agentHint])])]
}
