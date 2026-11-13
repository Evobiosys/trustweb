// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 settings-llm-first: the short Settings page drawn from settings_registry.ts (simple entries only), the Advanced
 * disclosure that holds everything else, and the switch upgrade that leaves no native checkbox in Settings (B07).
 * Plain-state in, DOM out; main.ts calls simpleBlock + advancedBlock once each.
 */
import { el } from '../../demo/src/ui/dom'
import { S } from './strings'
import { SETTINGS_REGISTRY, readSetting, writeSetting, type Rec, type SettingType, type SettingValue } from './settings_registry'

export interface SimpleRow { id: string; label: string; hint?: string; type: SettingType; value?: SettingValue }

/** The simple entries with their current value (actions carry none). Pure. */
export function simpleRows(r: Rec): SimpleRow[] {
  return SETTINGS_REGISTRY.filter((d) => d.simple).map((d) => ({ id: d.id, label: d.label, ...(d.hint ? { hint: d.hint } : {}), type: d.type, ...(d.type === 'action' ? {} : { value: readSetting(r, d.id) }) }))
}

/** The short page's own rows: value rows are TrustWeb toggles (role=switch), action rows open their screen. */
export function simpleBlock(h: { state: () => Rec; save: () => void; render: () => void; redraw: () => void; actions: Record<string, () => void> }): HTMLElement {
  const rows = simpleRows(h.state()).map((row) => {
    const text = [el('b', {}, [row.label]), row.hint ? el('small', {}, [row.hint]) : null]
    if (row.type === 'action') return el('button', { class: 'radio set-action', 'data-setting': row.id, onclick: () => h.actions[row.id]?.() }, text)
    const on = row.value === true
    const sw = el('button', {
      class: 'tr-toggle' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on), 'aria-label': row.label, 'data-setting-switch': row.id,
      onclick: () => { writeSetting(h.state(), row.id, !on); h.save(); h.render(); h.redraw() },
    }, [el('span', { class: 'tr-led', 'aria-hidden': 'true' })])
    return el('div', { class: 'set-row', 'data-setting': row.id }, [el('div', { class: 'set-row-text' }, text), sw])
  })
  return el('div', { 'data-settings-group': 'simple', class: 'settings-simple' }, rows)
}

/** The Advanced disclosure around every other group; its open state is remembered per device. */
export function advancedBlock(children: (Node | null)[]): HTMLDetailsElement {
  const key = 'trustweb.ui.settings.advanced-all'
  const d = el('details', { class: 'settings-advanced-all', 'data-settings-group': 'advanced-all', 'data-settings-advanced-all': '' }, [
    el('summary', { class: 'settings-group-title' }, [S.setAdvanced]),
    ...children,
  ]) as HTMLDetailsElement
  try { d.open = localStorage.getItem(key) === '1' } catch { d.open = false }
  d.addEventListener('toggle', () => { try { localStorage.setItem(key, d.open ? '1' : '0') } catch { /* not remembered */ } })
  return d
}

/** B07: every checkbox under `root` becomes the TrustWeb switch (CSS .tr-switch draws it; the input stays for keyboards and screen readers). */
export function upgradeSwitches(root: { querySelectorAll: (s: string) => ArrayLike<{ checked: boolean; setAttribute: (k: string, v: string) => void; classList: { add: (c: string) => void } }> }): void {
  for (const box of Array.from(root.querySelectorAll('input[type=checkbox]'))) {
    box.setAttribute('role', 'switch')
    box.setAttribute('aria-checked', String(box.checked))
    box.classList.add('tr-switch')
    ;(box as unknown as HTMLElement).addEventListener?.('change', () => box.setAttribute('aria-checked', String(box.checked)))
  }
}
