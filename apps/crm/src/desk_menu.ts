/** Svelte actions for the Desk's two menus: Escape, arrow keys and an outside click (the click path is read with composedPath, since a shadow root retargets event.target). */
const ITEM = '[role^="menuitem"]'

export function menuKeys(wrap: HTMLElement, close: () => void): { destroy(): void } {
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      // An open menu takes the Escape; the host's Escape (close the Desk) waits for the next one.
      if (wrap.querySelector('[role=menu]')) e.stopPropagation()
      close(); wrap.querySelector<HTMLElement>('[aria-haspopup]')?.focus(); return
    }
    const items = [...wrap.querySelectorAll<HTMLElement>(ITEM)]
    const at = items.indexOf(e.composedPath()[0] as HTMLElement)
    const next = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null
    if (next === null || items.length === 0) return
    e.preventDefault()
    items[(next + items.length) % items.length].focus()
  }
  const onClick = (e: MouseEvent): void => { if (!e.composedPath().includes(wrap)) close() }
  wrap.addEventListener('keydown', onKey)
  window.addEventListener('click', onClick)
  return { destroy(): void { wrap.removeEventListener('keydown', onKey); window.removeEventListener('click', onClick) } }
}

/** On the menu element itself: the first item takes focus when the menu opens. */
export function focusFirst(menu: HTMLElement): void {
  menu.querySelector<HTMLElement>(ITEM)?.focus()
}
