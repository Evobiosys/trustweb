/**
 * Dev-only feature overlay for previews. vite.config.mjs `define`s __TW_FEATURE__ only for `vite serve` with TW_FEATURE set
 * (JSON {title, hint, selector?}; scripts/tw_dev.sh reads feature.json at the worktree root); in every build it is null.
 * Draws a draggable "FEATURE · <title>" box top-left; when `selector` matches, a pulsing outline and an arrow line point at it.
 */
declare const __TW_FEATURE__: { title: string; hint: string; selector?: string } | null | undefined
declare const __TW_BUILD__: { branch: string; sha: string; time: string; mode: string; stockUrl: string } | null | undefined

const CSS = `
.twf{position:fixed;left:8px;top:8px;z-index:99999;max-width:240px;padding:6px 10px;border-radius:10px;background:#241b2e;color:#fff;font:600 11px/1.35 system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.4);touch-action:none;cursor:grab;opacity:.94}
.twf i{display:block;font-style:normal;font-weight:500;opacity:.8}.twf button{margin-top:4px;font:600 11px system-ui;border:0;border-radius:6px;padding:3px 8px;background:#4fd7a0;color:#241b2e;cursor:pointer}
.twf b{display:block;font-size:10px;letter-spacing:.06em;color:#4fd7a0}.twf span{font-weight:500}
.twf .twf-x{position:absolute;top:2px;right:4px;margin:0;padding:0 5px;background:none;color:#fff;font-size:14px}
.twf-dot{position:fixed;left:8px;top:8px;z-index:99999;width:18px;height:18px;padding:0;border:0;border-radius:50%;background:#241b2e;color:#4fd7a0;font:700 11px/18px system-ui;cursor:pointer;opacity:.7}
.twf-ring{position:fixed;z-index:99998;pointer-events:none;border:3px solid #ff715b;border-radius:12px;animation:twf 1.2s ease-in-out infinite}
.twf-rx{position:absolute;top:-13px;right:-13px;width:20px;height:20px;padding:0;border:0;border-radius:50%;background:#ff715b;color:#fff;font:700 14px/20px system-ui;cursor:pointer;pointer-events:auto}
.twf-line{position:fixed;inset:0;z-index:99997;pointer-events:none;width:100%;height:100%}
@keyframes twf{50%{box-shadow:0 0 0 8px rgba(255,113,91,.35)}}`

export function initDevFeature(): void {
  const f = typeof __TW_FEATURE__ === 'undefined' ? null : __TW_FEATURE__
  if (!f) return
  const NS = 'http://www.w3.org/2000/svg'
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }))
  const box = Object.assign(document.createElement('div'), { className: 'twf' })
  const bld = typeof __TW_BUILD__ === 'undefined' ? null : __TW_BUILD__
  box.innerHTML = '<b></b><i></i><span></span>'
  box.children[0].textContent = 'FEATURE · ' + f.title
  box.children[1].textContent = bld ? `${bld.branch} @ ${bld.sha} · ${bld.time} · ${bld.mode}` : ''
  box.children[2].textContent = f.hint
  if (bld?.stockUrl && bld.mode === 'personal') {
    const open = Object.assign(document.createElement('button'), { textContent: 'Open dev preview (no personal data)' })
    open.addEventListener('pointerdown', (e) => e.stopPropagation())
    open.addEventListener('click', () => window.open(bld.stockUrl, '_blank'))
    box.appendChild(open)
  }
  const ring = Object.assign(document.createElement('div'), { className: 'twf-ring' })
  const rx = Object.assign(document.createElement('button'), { className: 'twf-rx', textContent: '×', title: 'Remove pointer' })
  ring.appendChild(rx)
  let pointerOff = false
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('class', 'twf-line')
  const line = document.createElementNS(NS, 'line')
  line.setAttribute('stroke', '#ff715b'); line.setAttribute('stroke-width', '2'); line.setAttribute('stroke-dasharray', '6 4')
  svg.appendChild(line)
  const dot = Object.assign(document.createElement('button'), { className: 'twf-dot', textContent: 'ⓘ', title: 'Show feature overlay' })
  const x = Object.assign(document.createElement('button'), { className: 'twf-x', textContent: '×', title: 'Hide (Esc)' })
  x.addEventListener('pointerdown', (e) => e.stopPropagation())
  box.tabIndex = 0
  box.appendChild(x)
  const show = (on: boolean): void => {
    box.hidden = !on; dot.hidden = on
    if (on) pointerOff = false
    try { sessionStorage.setItem('twf-hidden', on ? '' : '1') } catch { /* private mode: not remembered */ }
    point()
  }
  rx.addEventListener('click', () => { pointerOff = true; point() })
  x.addEventListener('click', () => show(false))
  dot.addEventListener('click', () => show(true))
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') show(false) })
  document.body.append(svg, ring, box, dot)

  const point = (): void => {
    const target = f.selector ? document.querySelector(f.selector) : null
    const r = target?.getBoundingClientRect()
    const gone = !r || (r.width === 0 && r.height === 0)
    const off = gone || box.hidden || pointerOff
    ring.hidden = off; svg.style.display = off ? 'none' : ''
    if (off) return
    Object.assign(ring.style, { left: r.left - 4 + 'px', top: r.top - 4 + 'px', width: r.width + 8 + 'px', height: r.height + 8 + 'px' })
    const b = box.getBoundingClientRect()
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    // From the overlay's edge nearest the target to the outline's centre.
    line.setAttribute('x1', String(Math.min(Math.max(cx, b.left), b.right))); line.setAttribute('y1', String(Math.min(Math.max(cy, b.top), b.bottom)))
    line.setAttribute('x2', String(cx)); line.setAttribute('y2', String(cy))
  }
  let queued = false
  const soon = (): void => { if (queued) return; queued = true; setTimeout(() => { queued = false; point() }, 150) }
  new MutationObserver(soon).observe(document.body, { subtree: true, childList: true })
  window.addEventListener('resize', soon)
  document.addEventListener('scroll', soon, true)

  box.addEventListener('pointerdown', (down) => {
    const dx = down.clientX - box.offsetLeft, dy = down.clientY - box.offsetTop
    box.setPointerCapture(down.pointerId)
    const move = (e: PointerEvent): void => { box.style.left = e.clientX - dx + 'px'; box.style.top = e.clientY - dy + 'px'; point() }
    box.addEventListener('pointermove', move)
    box.addEventListener('pointerup', () => box.removeEventListener('pointermove', move), { once: true })
  })
  let hidden = false
  try { hidden = !!sessionStorage.getItem('twf-hidden') } catch { /* ignore */ }
  show(!hidden)
}
