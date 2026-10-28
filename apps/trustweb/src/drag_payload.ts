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

const dragSource = (mime: string) => (node: HTMLElement, ref: DragRef, label = ref.name): void => {
  node.draggable = true
  node.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData(mime, encodeDrag(ref))
    e.dataTransfer?.setData('text/plain', label)
  })
}

/** Makes a node a drag source for a person or an event (HTML5 drag; mouse and trackpad. Touch uses the pickers). */
export const dragPerson = dragSource(PERSON_MIME)
export const dragEvent = dragSource(EVENT_MIME)

const dropTarget = (mime: string) => (node: HTMLElement, onDrop: (ref: DragRef) => void): void => {
  const has = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes(mime)
  node.addEventListener('dragover', (e) => { if (has(e)) { e.preventDefault(); node.classList.add('cal-drop-over') } })
  node.addEventListener('dragleave', () => node.classList.remove('cal-drop-over'))
  node.addEventListener('drop', (e) => {
    node.classList.remove('cal-drop-over')
    const ref = has(e) ? decodeDrag(e.dataTransfer?.getData(mime) ?? '') : null
    if (ref) { e.preventDefault(); onDrop(ref) }
  })
}

/** Makes a node accept a dropped person / event: dragover only when the type is present, `.cal-drop-over` while hovering. */
export const acceptPerson = dropTarget(PERSON_MIME)
export const acceptEvent = dropTarget(EVENT_MIME)
