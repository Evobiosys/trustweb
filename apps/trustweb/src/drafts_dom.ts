// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c event-autosave: the DOM side of drafts.ts. main.ts sets the host once (setDraftHost); every editor or composer then calls
 * draftable(root, editor, target) when it builds its form and .clear() when it sends or saves. Typing saves 500 ms later, leaving the field
 * (a tab switch) or hiding the page saves at once; an editor that opens empty while a draft waits gets it back with "Draft restored · Discard".
 * Editors whose state is more than their fields (the event editor) use autosaveOf + restoredNotice directly. Settings > Drafts lists them all.
 */
import { el } from '../../demo/src/ui/dom'
import { createAutosave, discardDraft, draftKey, getDraft, listDrafts } from './drafts'
import type { Autosave, DraftHost, DraftOutcome } from './drafts'
import type { AppState } from './model'
import { S } from './strings'

let host: DraftHost | null = null
/** The latest autosave per draft key: what a hidden page flushes. */
const live = new Map<string, Autosave>()
/** The draft version (updatedAt) each key restored, so a redraw keeps the notice until the next change. */
const restored = new Map<string, number>()

const flushAll = (): void => { for (const a of live.values()) if (a.pending()) a.flush() }

export function setDraftHost(h: { state: () => Pick<AppState, 'drafts'>; save: () => void }): void {
  host = { state: h.state, save: h.save, now: Date.now, later: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t) } }
  addEventListener('pagehide', flushAll)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll() })
}

/** An autosave on this device's record (null before setDraftHost: tests, the MCP). */
export function autosaveOf<T>(editor: string, target: string, read: () => T, isEmpty?: (v: T) => boolean, onOutcome?: (o: DraftOutcome) => void): Autosave | null {
  if (!host) return null
  const a = createAutosave(host, editor, target, read, isEmpty, onOutcome)
  live.set(draftKey(editor, target), a as Autosave)
  return a
}

/** "Draft restored · Discard", one line. */
export function restoredNotice(onDiscard: () => void): HTMLElement {
  return el('p', { class: 'meta draft-note', 'data-draft-restored': '' }, [S.drafts44c.restored, ' · ', el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-draft-restored-discard': '', onclick: onDiscard }, [S.drafts44c.discard])])
}
export const tooBigNotice = (): HTMLElement => el('p', { class: 'meta draft-note', 'data-draft-too-big': '' }, [S.drafts44c.tooBig])

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
const FIELDS = 'textarea, select, input:not([type=hidden]):not([type=file]):not([type=password]):not([type=checkbox]):not([type=radio]):not([type=search]):not([type=button]):not([type=submit])'
const TEXTY = new Set(['textarea', 'text', 'url', 'email', 'tel', ''])

/** The fields of a form by a name that survives a redraw: its first data-* attribute, else name, aria-label or placeholder; repeats get #n. */
function fieldsOf(root: HTMLElement): Map<string, Field> {
  const out = new Map<string, Field>()
  for (const f of root.querySelectorAll<Field>(FIELDS)) {
    const data = [...f.attributes].find((a) => a.name.startsWith('data-'))
    const base = data ? `${data.name}=${data.value}` : f.getAttribute('name') ?? f.getAttribute('aria-label') ?? f.getAttribute('placeholder') ?? f.tagName
    let k = base
    for (let n = 2; out.has(k); n++) k = `${base}#${n}`
    out.set(k, f)
  }
  return out
}
const snapshot = (root: HTMLElement): Record<string, string> => Object.fromEntries([...fieldsOf(root)].map(([k, f]) => [k, f.value]))
const texty = (f: Field): boolean => TEXTY.has(f instanceof HTMLTextAreaElement ? 'textarea' : f instanceof HTMLInputElement ? f.getAttribute('type') ?? '' : 'select')
const blank = (root: HTMLElement): boolean => [...fieldsOf(root).values()].every((f) => !texty(f) || !f.value.trim())
const set = (f: Field, v: string): void => { f.value = v; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })) }

/** Autosaves the fields of `root` as the draft editor:target; returns clear() for the editor's send / save. */
export function draftable(root: HTMLElement, editor: string, target: string): { clear: () => void } {
  const key = draftKey(editor, target)
  let notice: HTMLElement | null = null
  const note = (n: HTMLElement | null): void => { notice?.remove(); notice = n; if (n) root.prepend(n) }
  const auto = autosaveOf(editor, target, () => snapshot(root), () => blank(root), (o) => { if (o === 'too-big') note(tooBigNotice()) })
  if (!auto || !host) return { clear: () => undefined }
  const h = host
  // Only what the person does counts; the restore's own events (untrusted) change nothing.
  root.addEventListener('input', (e) => { if (!e.isTrusted) return; restored.delete(key); if (notice?.hasAttribute('data-draft-restored')) note(null); auto.changed() })
  root.addEventListener('change', (e) => { if (e.isTrusted) auto.changed() })
  root.addEventListener('focusout', () => { if (auto.pending()) auto.flush() })
  const discard = (): void => {
    restored.delete(key)
    for (const f of fieldsOf(root).values()) if (texty(f)) set(f, '')
    auto.clear()
    if (discardDraft(h.state(), key)) h.save()
    note(null)
  }
  // After the editor is in the page (its own input handlers may redraw): an empty form gets the waiting draft back.
  setTimeout(() => {
    const d = getDraft(h.state(), editor, target)
    if (!d || !root.isConnected) return
    const value = d.value as Record<string, string>
    if (blank(root)) {
      const fields = fieldsOf(root)
      for (const [k, v] of Object.entries(value)) { const f = fields.get(k); if (f && f.value !== v) set(f, v) }
      restored.set(key, d.updatedAt)
    }
    if (restored.get(key) === getDraft(h.state(), editor, target)?.updatedAt && root.isConnected) note(restoredNotice(discard))
  })
  return { clear: () => { restored.delete(key); auto.clear(); note(null) } }
}

/** Settings > Drafts: every draft with its size and a Discard. */
export function draftsSettingsRows(s: Pick<AppState, 'drafts'>, save: () => void, redraw: () => void): Node[] {
  const all = listDrafts(s)
  return [
    el('p', { class: 'meta' }, [S.drafts44c.hint]),
    ...(all.length ? all.map((d) => {
      const what = `${S.drafts44c.editors[d.editor] ?? d.editor} · ${d.target}`
      return el('div', { class: 'prow', 'data-draft-row': draftKey(d.editor, d.target) }, [
        el('span', { class: 'who' }, [el('b', {}, [what]), ' ', el('small', { class: 'meta' }, [`${S.drafts44c.size(d.size)} · ${new Date(d.updatedAt).toLocaleString()}`])]),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': S.drafts44c.discardAria(what), 'data-draft-discard': draftKey(d.editor, d.target), onclick: () => { discardDraft(s, draftKey(d.editor, d.target)); save(); redraw() } }, ['×']),
      ])
    }) : [el('p', { class: 'meta', 'data-drafts-none': '' }, [S.drafts44c.none])]),
  ]
}
