/** Dev-only step overlay: a yellow card over the phone walks through the steps to a feature, one at a time, the pointer's red ring on each step's element.
 *  Wave 31: driving (Walk) the card also does each step itself, ring first, then the hand's tap (dev_walk.ts); ? leaves the taps to the reviewer. Used by dev_preview.ts. */
import type { Pointer } from './dev_pointer'
import { appScreen, appView, navNote, navPlan, quickTap, runNav, waitVisible, type NavTap } from './dev_navigate'
import { driveNext, stepMove } from './dev_drive'
import { createHand } from './dev_walk'
import { clampCard, parseStep, stepCardPlace, stepCardPosStore } from './dev_preview_rules'

const CSS = `
.twp-step{position:fixed;z-index:99999;padding:8px 10px;border-radius:10px;background:#ffd24a;color:#241b2e;font:600 13px/1.35 system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.4);display:grid;gap:6px}
.twp-step div{display:flex;gap:6px}.twp-step button{font:600 12px system-ui;border:0;border-radius:6px;padding:5px 10px;background:#241b2e;color:#fff;cursor:pointer}
.twp-step .txt{cursor:move;touch-action:none;user-select:none}.twp-step button:disabled{opacity:.4;cursor:default}.twp-step button.alt{background:none;color:#241b2e;border:1px solid #241b2e;margin-left:auto}`

export interface Steps {
  /** Show `steps` one at a time (the last one is the feature itself); replaces an open overlay. A `context` (the row's view) is navigated to
   *  first, at once; a navigation tap missing on this build makes the card's first line say where to go. `drive` (Walk): the card taps every
   *  step but the last itself, Next does the current step now, Back goes one back and pauses. */
  open(steps: string[], context?: string, drive?: boolean): Promise<void>
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
  let note = ''
  let opened = 0
  const saved = stepCardPosStore(localStorage)
  const hand = createHand()
  let ctx: string | undefined
  let driving = false     // a Walk (not ?): the card does the taps
  let auto = false        // the drive goes on by itself (Back and a stuck step pause it)
  let busy = false        // the drive loop runs
  let tapping = false     // our own click: not the reviewer's tap
  let skip: (() => void) | null = null   // Next during the pause between two steps

  const button = (text: string, onclick: () => void, className = '', disabled = false): HTMLButtonElement =>
    Object.assign(document.createElement('button'), { textContent: text, onclick, className, disabled })

  function place(): void {
    if (!card) return
    const phone = document.querySelector('.phone')?.getBoundingClientRect() ?? null
    const target = list[at].selector ? document.querySelector(list[at].selector!)?.getBoundingClientRect() : undefined
    const p = stepCardPlace(phone, target, card.offsetHeight, innerWidth, innerHeight)
    Object.assign(card.style, { left: p.left + 'px', width: p.width + 'px', top: p.top !== undefined ? p.top + 'px' : '', bottom: p.bottom !== undefined ? p.bottom + 'px' : '' })
    const mine = saved.get()
    if (mine) {
      const c = clampCard(mine.left, mine.top, card.offsetWidth, card.offsetHeight, innerWidth, innerHeight)
      Object.assign(card.style, { left: c.left + 'px', top: c.top + 'px', bottom: '' })
    }
  }

  function draw(): void {
    const last = at === list.length - 1
    card?.remove()
    const text = last && here ? `👣 Here it is: ${list[at].text}` : `👣 Step ${at + 1} of ${list.length}: ${list[at].text}`
    card = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'twp-step' }))
    const row = document.createElement('div')
    row.append(button('Back', back, '', at === 0), ...(last ? [] : [button('Next', next)]), button('Done', onDone, 'alt'))
    const handle = Object.assign(document.createElement('span'), { className: 'txt', textContent: text, title: 'Drag to move · double-click puts it back at the bottom' })
    handle.addEventListener('pointerdown', (down) => {
      const box = card!.getBoundingClientRect()
      const dx = down.clientX - box.left, dy = down.clientY - box.top
      handle.setPointerCapture(down.pointerId)
      const move = (e: PointerEvent): void => {
        const c = clampCard(e.clientX - dx, e.clientY - dy, box.width, box.height, innerWidth, innerHeight)
        Object.assign(card!.style, { left: c.left + 'px', top: c.top + 'px', bottom: '' })
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', () => {
        handle.removeEventListener('pointermove', move)
        saved.set({ left: card!.offsetLeft, top: card!.offsetTop })
      }, { once: true })
    })
    handle.addEventListener('dblclick', () => { saved.clear(); place() })
    card.append(...(note ? [Object.assign(document.createElement('span'), { textContent: note })] : []), handle, row)
    place()
  }

  function go(i: number): void {
    at = i
    here = pointer.set(list[at].selector)
    draw()
  }

  function back(): void {
    if (driving) { const s = driveNext({ at, auto }, 'back', list.length); auto = s.auto; skip = null; note = ''; go(s.at) } else go(at - 1)
  }
  function next(): void {
    if (!driving) { go(at + 1); return }
    auto = driveNext({ at, auto }, 'next', list.length).auto
    if (skip) skip(); else void drive(opened)
  }
  const pause = (ms: number): Promise<void> => new Promise((done) => {
    const t = setTimeout(() => { skip = null; done() }, ms)
    skip = () => { clearTimeout(t); skip = null; done() }
  })

  /** One tap of the hand on `selector`, the red ring on it first. */
  async function handTap(selector: string, text: string, me: number): Promise<boolean> {
    const el = await waitVisible(selector, 1500)
    if (!el || me !== opened) return false
    pointer.set(selector)
    tapping = true
    try { await hand.tap(el, text) } finally { tapping = false }
    return me === opened
  }
  const navTap = (me: number) => (t: NavTap): Promise<boolean> => handTap(t.selector, '', me)

  /** Walk: do the steps from `at` on, each one ringed and then tapped; the last one is only ringed ("Here it is"). */
  async function drive(me: number): Promise<void> {
    if (busy) return
    busy = true
    try {
      while (me === opened && on && auto && at < list.length - 1) {
        go(at)
        const step = list[at]
        let navTried = false
        for (;;) {
          const el = step.selector ? await waitVisible(step.selector, navTried ? 4000 : 2500) : null
          if (me !== opened) return
          const m = stepMove(step, !!el, navTried, navPlan(ctx, appScreen(), appView()), ctx)
          if (m.kind === 'tap') { note = ''; break }
          if (m.kind === 'nav') { navTried = true; note = ''; draw(); await runNav({ taps: m.taps, path: '' }, navTap(me)); if (me !== opened) return; continue }
          auto = driveNext({ at, auto }, 'stuck', list.length).auto
          if (m.kind === 'missing') { note = m.note; here = pointer.set(m.ring); draw() }
          return   // a step without a target waits for Next; a missing one for the reviewer
        }
        go(at)
        await pause(300)
        if (me !== opened || !auto) return
        const i = at
        if (!(await handTap(step.selector!, step.text, me)) || !auto || at !== i) return   // Back while the hand moved: stay there
        go(driveNext({ at, auto }, 'done', list.length).at)
        await pause(900)
      }
    } finally { busy = false; if (me === opened && (!on || at === list.length - 1)) hand.hide() }
  }

  // A tap on the current step's element moves to the next step (capture: before the app's own handler changes the view).
  const follow = (e: MouseEvent): void => {
    const sel = list[at].selector
    if (!tapping && sel && at < list.length - 1 && (e.target as Element).closest(sel)) { note = ''; go(at + 1) }
  }
  const replace = (): void => { place() }

  function close(): void {
    on = false; opened++
    skip?.(); hand.hide()
    card?.remove(); card = null
    document.removeEventListener('click', follow, true)
    window.removeEventListener('resize', replace)
    document.removeEventListener('scroll', replace, true)
  }

  return {
    async open(steps, context, walk = false) {
      close()
      const me = ++opened
      list = steps.map(parseStep)
      on = true
      note = ''
      ctx = context
      driving = auto = walk
      if (context) {
        const plan = navPlan(context, appScreen(), appView())
        if (!(await runNav(plan, driving ? navTap(me) : quickTap))) note = navNote(plan)
        if (me !== opened || !on) return
      }
      document.addEventListener('click', follow, true)
      window.addEventListener('resize', replace)
      document.addEventListener('scroll', replace, true)
      go(0)
      if (driving) void drive(me)
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
