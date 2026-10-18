/** Dev-only auto-walk: performs a feature's steps in the page (ripple, then a real click or the typed value). A step without a selector shows a yellow card and waits for its Next. Used by dev_preview.ts. */
import { parseStep, typedValue } from './dev_preview_rules'

const CSS = `
.twp-rip{position:fixed;z-index:99999;pointer-events:none;width:12px;height:12px;margin:-6px 0 0 -6px;border:3px solid var(--twp-rip,#7ED9CF);border-radius:50%;opacity:.9;animation:twp-rip 700ms ease-out forwards}
@keyframes twp-rip{to{transform:scale(7);opacity:0}}
.twp-step.walk{left:50%;transform:translateX(-50%);bottom:16px;max-width:90vw}`

export interface Walker {
  /** Do `steps` one after the other; resolves when done, stopped, or an element did not show up within 4 s. */
  run(steps: string[]): Promise<void>
  stop(): void
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** The first match of `selector` in the document, else in any shadow root below it. */
function find(selector: string, root: ParentNode = document): Element | null {
  const hit = root.querySelector(selector)
  if (hit) return hit
  for (const e of root.querySelectorAll('*')) {
    const found = e.shadowRoot ? find(selector, e.shadowRoot) : null
    if (found) return found
  }
  return null
}

/** Stone in a pond: three rings expanding from the element's centre. */
function ripple(el: Element): void {
  const r = el.getBoundingClientRect()
  document.documentElement.style.setProperty('--twp-rip', getComputedStyle(document.documentElement).getPropertyValue('--electric-deep').trim() || '#7ED9CF')
  for (let i = 0; i < 3; i++) {
    const ring = Object.assign(document.createElement('div'), { className: 'twp-rip' })
    Object.assign(ring.style, { left: r.left + r.width / 2 + 'px', top: r.top + r.height / 2 + 'px', animationDelay: i * 120 + 'ms' })
    document.body.appendChild(ring)
    setTimeout(() => { ring.remove() }, 700 + i * 120 + 50)
  }
}

export function createWalker(toast: (text: string) => void): Walker {
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }))
  let token = 0
  let cancel: (() => void) | null = null

  const card = (text: string): Promise<void> => new Promise((done) => {
    const el = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'twp-step walk' }))
    const end = (): void => { el.remove(); cancel = null; done() }
    el.append(text, Object.assign(document.createElement('button'), { textContent: 'Next', onclick: end }))
    cancel = end
  })

  async function waitFor(selector: string, me: number): Promise<Element | null> {
    for (const end = Date.now() + 4000; ; await sleep(100)) {
      const el = find(selector)
      if (el || Date.now() > end || me !== token) return el
    }
  }

  return {
    async run(steps) {
      const me = ++token
      for (const s of steps) {
        const { text, selector } = parseStep(s)
        if (!selector) { await card('👣 ' + text); if (me !== token) return; continue }
        const el = await waitFor(selector, me)
        if (me !== token) return
        if (!el) { toast('not found: ' + selector); return }
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        await sleep(350)
        ripple(el)
        await sleep(350)
        const value = typedValue(text)
        if (value !== null && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
          el.focus(); el.value = value
          el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }))
        } else (el as HTMLElement).click()
        await sleep(400)
        if (me !== token) return
      }
    },
    stop() { token++; cancel?.() },
  }
}
