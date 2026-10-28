// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Drag and drop between the core and extension modules (wave 24): ids and a display name only, never record data. Pure. */
export const PERSON_MIME = 'text/x-trustweb-person'
export const EVENT_MIME = 'text/x-trustweb-event'

export interface DragRef { id: string; name: string }

const MAX = 512

export const encodeDrag = (r: DragRef): string => JSON.stringify({ id: r.id, name: r.name })

/** The dragged reference, or null for anything that is not exactly {id, name} strings within 512 chars. */
export function decodeDrag(raw: string): DragRef | null {
  if (!raw || raw.length > MAX) return null
  try {
    const o: unknown = JSON.parse(raw)
    if (typeof o !== 'object' || o === null || Array.isArray(o)) return null
    const { id, name } = o as Record<string, unknown>
    return typeof id === 'string' && id && typeof name === 'string' ? { id, name } : null
  } catch {
    return null
  }
}

/** Makes a node a drag source for a person (HTML5 drag; mouse and trackpad. Touch uses the pickers). */
export function dragPerson(node: HTMLElement, ref: DragRef): void {
  node.draggable = true
  node.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData(PERSON_MIME, encodeDrag(ref))
    e.dataTransfer?.setData('text/plain', ref.name)
  })
}

/** Makes a node accept a dropped person: dragover only when the type is present, `.cal-drop-over` while hovering. */
export function acceptPerson(node: HTMLElement, onPerson: (ref: DragRef) => void): void {
  const has = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes(PERSON_MIME)
  node.addEventListener('dragover', (e) => { if (has(e)) { e.preventDefault(); node.classList.add('cal-drop-over') } })
  node.addEventListener('dragleave', () => node.classList.remove('cal-drop-over'))
  node.addEventListener('drop', (e) => {
    node.classList.remove('cal-drop-over')
    const ref = has(e) ? decodeDrag(e.dataTransfer?.getData(PERSON_MIME) ?? '') : null
    if (ref) { e.preventDefault(); onPerson(ref) }
  })
}
