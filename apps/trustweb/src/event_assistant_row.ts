// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-ask-placement-3: the event editor's one OPTIONAL row "Draft with assistant". Never required; without a configured AI it
 * shrinks to a greyed hint (P7). Own module so the chain-rebase wires one call into event_editor_view.ts (see the report's NOTE).
 * The deps (ready / open) come from main.ts through setEventAssistantDeps, so this file stays DOM-only and testable.
 */
import { el } from '../../demo/src/ui/dom'
import { S } from './strings'

export interface EventAssistantDeps {
  /** True once an AI is configured and the assistant is on. */
  ready: () => boolean
  /** Opens the assistant with `text` prefilled. */
  open: (text: string) => void
}
/** The slice of the editor's fields the prefill reads (event_draft.ts EditorFields satisfies it). */
export interface EventAssistantFields { name?: string; from?: string; to?: string; where?: string; description?: string }

let deps: EventAssistantDeps = { ready: () => false, open: () => {} }
/** Registration hook: main.ts calls this once. */
export function setEventAssistantDeps(d: EventAssistantDeps): void { deps = d }

export function eventAssistantText(f: EventAssistantFields): string {
  const lines = ([['name', f.name], ['from', f.from], ['to', f.to], ['where', f.where], ['description', f.description]] as const)
    .filter(([, v]) => !!v?.trim())
    .map(([k, v]) => `${k}: ${v}`)
  return S.w44ap3.prompt(lines.join('\n'))
}

/** `fields` is the editor's live field object, read at tap time so later typing is included. */
export function eventAssistantRow(fields: EventAssistantFields, d: EventAssistantDeps = deps): HTMLElement {
  if (!d.ready()) return el('div', { class: 'ev-row', 'data-editor-row': 'assistant' }, [el('p', { class: 'meta opt-min' }, [S.w44ap3.hint])])
  return el('div', { class: 'ev-row', 'data-editor-row': 'assistant' }, [
    el('button', { class: 'btn btn-ghost wide', type: 'button', 'data-editor-assistant': '', onclick: () => d.open(eventAssistantText(fields)) }, [S.w44ap3.row]),
  ])
}
