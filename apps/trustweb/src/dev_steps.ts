/** Dev-only step overlay: a yellow card over the phone walks through the steps to a feature, one at a time, the pointer's red ring on each step's element. Used by dev_preview.ts. */
import type { Pointer } from './dev_pointer'
import { parseStep } from './dev_preview_rules'

const CSS = `
.twp-step{position:fixed;z-index:99999;padding:8px 10px;border-radius:10px;background:#ffd24a;color:#241b2e;font:600 13px/1.35 system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.4);display:grid;gap:6px}
.twp-step div{display:flex;gap:6px}.twp-step button{font:600 12px system-ui;border:0;border-radius:6px;padding:5px 10px;background:#241b2e;color:#fff;cursor:pointer}
.twp-step button:disabled{opacity:.4;cursor:default}.twp-step button.alt{background:none;color:#241b2e;border:1px solid #241b2e;margin-left:auto}`

export interface Steps {
  /** Show `steps` one at a time (the last one is the feature itself); replaces an open overlay. */
  open(steps: string[]): void
  close(): void
  active(): boolean
  /** The pointer's target of the current step appeared or went away. */
  seen(on: boolean): void
}

/** `onDone` is called when the card's Done button is pressed; the caller then ends the walk with close(). */
export function createSteps(pointer: Pointer, onDone: () => void): Steps {
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }))
  let list: ReturnType<typeof parseStep>[] = []
  let at = 0
  let here = false
  let card: HTMLElement | null = null
  let on = false

  const button = (text: string, onclick: () => void, className = '', disabled = false): HTMLButtonElement =>
    Object.assign(document.createElement('button'), { textContent: text, onclick, className, disabled })

  // Over the phone's bottom edge; at its top when the target sits under the card.
  function place(): void {
    if (!card) return
    const r = (document.querySelector('.phone') ?? document.body).getBoundingClientRect()
    const target = list[at].selector ? document.querySelector(list[at].selector!)?.getBoundingClientRect() : undefined
    const low = Math.min(r.bottom, innerHeight)
    const top = target !== undefined && target.bottom > low - card.offsetHeight - 16
    Object.assign(card.style, { left: r.left + 8 + 'px', width: r.width - 16 + 'px', top: top ? Math.max(r.top, 0) + 8 + 'px' : '', bottom: top ? '' : innerHeight - low + 8 + 'px' })
  }

  function draw(): void {
    const last = at === list.length - 1
    card?.remove()
    const text = last && here ? `👣 Here it is: ${list[at].text}` : `👣 Step ${at + 1} of ${list.length}: ${list[at].text}`
    card = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'twp-step' }))
    const row = document.createElement('div')
    row.append(button('Back', () => { go(at - 1) }, '', at === 0), ...(last ? [] : [button('Next', () => { go(at + 1) })]), button('Done', onDone, 'alt'))
    card.append(text, row)
    place()
  }

  function go(i: number): void {
    at = i
    here = pointer.set(list[at].selector)
    draw()
  }

  // A tap on the current step's element moves to the next step (capture: before the app's own handler changes the view).
  const follow = (e: MouseEvent): void => {
    const sel = list[at].selector
    if (sel && at < list.length - 1 && (e.target as Element).closest(sel)) go(at + 1)
  }
  const replace = (): void => { place() }

  function close(): void {
    on = false
    card?.remove(); card = null
    document.removeEventListener('click', follow, true)
    window.removeEventListener('resize', replace)
  }

  return {
    open(steps) {
      close()
      list = steps.map(parseStep)
      on = true
      document.addEventListener('click', follow, true)
      window.addEventListener('resize', replace)
      go(0)
    },
    close,
    active: () => on,
    seen(on) {
      if (!card || here === on) return
      here = on
      draw()
    },
  }
}
