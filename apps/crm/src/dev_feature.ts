/**
 * Dev-only feature overlay (copied from apps/trustweb/src/dev_feature.ts). vite.config.ts `define`s __TW_FEATURE__ and __TW_BUILD__ only for `vite serve`; in every build they are null.
 * Draws a draggable "FEATURE · <title>" box top-left; when `selector` matches, a pulsing outline and an arrow line point at it.
 */
declare const __TW_FEATURE__: { title: string; hint: string; selector?: string } | null | undefined
declare const __TW_BUILD__: { branch: string; sha: string; time: string; mode: string; stockUrl: string; build: number } | null | undefined

const CSS = `
.twf{position:fixed;left:8px;top:8px;z-index:99999;max-width:240px;padding:6px 10px;border-radius:10px;background:#241b2e;color:#fff;font:600 11px/1.35 system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.4);touch-action:none;cursor:grab;opacity:.94}
.twf i{display:block;font-style:normal;font-weight:500;opacity:.8}.twf button{margin-top:4px;font:600 11px system-ui;border:0;border-radius:6px;padding:3px 8px;background:#4fd7a0;color:#241b2e;cursor:pointer}
.twf b{display:block;font-size:10px;letter-spacing:.06em;color:#4fd7a0}.twf span{font-weight:500}
.twf b em{font-style:normal;margin-right:6px;padding:1px 6px;border-radius:6px;background:#ff3d9a;color:#fff}
.twa{position:fixed;right:8px;bottom:8px;z-index:99999;display:flex;gap:6px;align-items:center;padding:6px 8px;border-radius:10px;background:#3b2a05;color:#ffe3a3;font:600 11px system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.4)}
.twa button{margin:0;background:#ffb300;color:#241b2e}
.twf-ring{position:fixed;z-index:99998;pointer-events:none;border:3px solid #ff715b;border-radius:12px;animation:twf 1.2s ease-in-out infinite}
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
  if (bld) box.children[0].prepend(Object.assign(document.createElement('em'), { textContent: `NEW ${bld.build}` }))
  box.children[1].textContent = bld ? `${bld.branch} @ ${bld.sha} · ${bld.time} · ${bld.mode}` : ''
  box.children[2].textContent = f.hint
  const approve = bld?.mode === 'personal' ? Object.assign(document.createElement('div'), { className: 'twa' }) : null
  if (approve) {
    const ok = Object.assign(document.createElement('button'), { textContent: 'Approve personal preview' })
    ok.addEventListener('click', () => {
      void fetch('/__tw/approve', { method: 'POST' }).then(async (r) => {
        ok.textContent = r.ok ? `approved ${((await r.json()) as { time: string }).time}` : 'approve failed'
        ok.disabled = r.ok
      }).catch(() => { ok.textContent = 'approve failed' })
    })
    approve.appendChild(ok)
    if (bld?.stockUrl) {
      const stock = Object.assign(document.createElement('button'), { textContent: 'Open stock preview' })
      stock.addEventListener('click', () => window.open(bld.stockUrl, '_blank'))
      approve.appendChild(stock)
    }
  }
  const ring = Object.assign(document.createElement('div'), { className: 'twf-ring' })
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('class', 'twf-line')
  const line = document.createElementNS(NS, 'line')
  line.setAttribute('stroke', '#ff715b'); line.setAttribute('stroke-width', '2'); line.setAttribute('stroke-dasharray', '6 4')
  svg.appendChild(line)
  document.body.append(svg, ring, box, ...(approve ? [approve] : []))

  const point = (): void => {
    const target = f.selector ? document.querySelector(f.selector) : null
    const r = target?.getBoundingClientRect()
    const gone = !r || (r.width === 0 && r.height === 0)
    ring.hidden = gone; svg.style.display = gone ? 'none' : ''
    if (gone) return
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
  point()
}
