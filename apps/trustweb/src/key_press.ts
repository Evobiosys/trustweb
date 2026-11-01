// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 review: keyboard parity for clickable divs/svgs (Enter and Space press, like a button) and Escape / outside-tap close for menus. */

/** keydown handler: Enter or Space on the element itself runs `press`. */
export const activateKey = (press: () => void) => (e: Event): void => {
  const k = e as KeyboardEvent
  if ((k.key === 'Enter' || k.key === ' ') && k.target === k.currentTarget) { k.preventDefault(); press() }
}

/** Calls `dismiss` on Escape or on a tap outside `inside`; returns the function that stops listening. */
export function dismissOnOutside(inside: (t: EventTarget | null) => boolean, dismiss: () => void): () => void {
  const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') dismiss() }
  const tap = (e: Event): void => { if (!inside(e.target)) dismiss() }
  document.addEventListener('keydown', key)
  document.addEventListener('pointerdown', tap)
  return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', tap) }
}
