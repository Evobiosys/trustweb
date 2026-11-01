// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Settings > Advanced > Your AI: provider preset, base URL, key, model and a Test button. Kept on this phone and in the sealed record. */
import { el } from '../../demo/src/ui/dom'
import { askEndpoint, configured, PRESETS } from './llm_endpoint'
import type { AiEndpoint, AppState } from './model'
import { S } from './strings'

export interface AiViewHooks {
  state: () => AppState
  save: () => void
  toast: (msg: string) => void
  /** The dev record is loaded: the pc24 preset shows. */
  devRecord: boolean
}

export function aiSettings(h: AiViewHooks): HTMLElement[] {
  const box = el('div', { class: 'channels', 'data-ai': '' })
  const ai = (): AiEndpoint => {
    const a = h.state()
    return (a.advanced ??= {}).ai ??= { preset: 'custom', baseUrl: '', apiKey: '', model: '' }
  }
  const field = (key: 'baseUrl' | 'apiKey' | 'model', label: string, type: string): HTMLElement => {
    const input = el('input', { class: 'field', type, placeholder: label, 'aria-label': label, value: ai()[key], autocomplete: 'off', 'data-ai-field': key }) as HTMLInputElement
    input.addEventListener('change', () => { ai()[key] = input.value.trim(); h.save() })
    return input
  }
  const draw = (): void => {
    const names: AiEndpoint['preset'][] = ['openai', 'ollama', 'custom', ...(h.devRecord ? ['pc24' as const] : [])]
    const presets = names.map((p) => el('button', {
      class: 'radio' + (ai().preset === p ? ' on' : ''), 'aria-pressed': String(ai().preset === p), 'data-ai-preset': p,
      onclick: () => { Object.assign(ai(), { preset: p, ...(p === 'custom' ? {} : PRESETS[p]) }); h.save(); draw() },
    }, [el('b', {}, [S.aiPreset[p]])]))
    const result = el('p', { class: 'meta', 'data-ai-result': '' })
    box.replaceChildren(
      el('h4', { class: 'eyebrow' }, [S.aiTitle]),
      ...presets,
      field('baseUrl', S.aiBaseUrl, 'url'), field('apiKey', S.aiKey, 'password'), field('model', S.aiModel, 'text'),
      el('button', {
        class: 'btn btn-ghost btn-sm', 'data-ai-test': '1',
        onclick: async () => {
          if (!configured(h.state().advanced?.ai)) { result.textContent = S.aiNotSet; return }
          result.textContent = S.aiTesting
          try { await askEndpoint(ai(), 'I want to play padel'); result.textContent = S.aiOk } catch (e) { result.textContent = S.aiError((e as Error).message) }
        },
      }, [S.aiTest]),
      result,
      el('p', { class: 'meta' }, [S.aiHint]),
    )
  }
  draw()
  return [box]
}
