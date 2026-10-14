/**
 * Dev-only feature overlay for previews. vite.config.mjs `define`s __TW_FEATURE__ only for `vite serve` with TW_FEATURE set
 * (JSON {title, hint, selector?}; scripts/tw_dev.sh reads feature.json at the worktree root); in every build it is null.
 * Draws a draggable "FEATURE · <title>" box top-left; when `selector` matches, a pulsing outline and an arrow line point at it.
 */
declare const __TW_FEATURE__: { title: string; hint: string; selector?: string } | null | undefined
declare const __TW_BUILD__: { branch: string; sha: string; time: string; mode: string; stockUrl: string; n?: number; approved?: string | null } | null | undefined

const CSS = `
.twf{position:fixed;left:8px;top:8px;z-index:99999;max-width:240px;padding:6px 10px;border-radius:10px;background:#241b2e;color:#fff;font:600 11px/1.35 system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.4);touch-action:none;cursor:grab;opacity:.94}
.twf i{display:block;font-style:normal;font-weight:500;opacity:.8}.twf button{margin-top:4px;font:600 11px system-ui;border:0;border-radius:6px;padding:3px 8px;background:#4fd7a0;color:#241b2e;cursor:pointer}
.twf b{display:block;font-size:10px;letter-spacing:.06em;color:#4fd7a0}.twf span{font-weight:500}
.twf .twf-x{position:absolute;top:2px;right:4px;margin:0;padding:0 5px;background:none;color:#fff;font-size:14px}
.twf-dot{position:fixed;left:8px;top:8px;z-index:99999;width:18px;height:18px;padding:0;border:0;border-radius:50%;background:#241b2e;color:#4fd7a0;font:700 11px/18px system-ui;cursor:pointer;opacity:.7}
.twf-ring{position:fixed;z-index:99998;pointer-events:none;border:3px solid #ff715b;border-radius:12px;animation:twf 1.2s ease-in-out infinite}
.twf-rx{position:absolute;top:-13px;right:-13px;width:20px;height:20px;padding:0;border:0;border-radius:50%;background:#ff715b;color:#fff;font:700 14px/20px system-ui;cursor:pointer;pointer-events:auto}
.twf-ok{position:fixed;right:12px;bottom:96px;z-index:99999;width:min(320px,calc(100vw - 24px));font:13px/1.4 system-ui,sans-serif;color:#1d2a2e;background:#fff;border:1.5px solid #b8650a;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.25);touch-action:none}
.twf-ok header{padding:8px 10px;background:#b8650a;color:#fff;border-radius:12px 12px 0 0;cursor:move;user-select:none;font-weight:700}
.twf-ok .body{padding:8px 10px;display:grid;gap:6px}.twf-ok button{font:inherit;border-radius:9px;border:0;padding:9px 10px;cursor:pointer;width:100%}
.twf-ok .go{background:#b8650a;color:#fff;font-weight:700}.twf-ok .alt{background:none;color:#b8650a;border:1px solid #b8650a}
.twf-ok.prog{border-color:#5b6b70}.twf-ok.prog header{background:#5b6b70}.twf-ok .warn{color:#a3271f;font-weight:600}
.twf-new{display:inline-block;margin-right:6px;padding:0 5px;border-radius:5px;background:#ffbf47;color:#241b2e}
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
  if (bld?.n) box.children[0].prepend(Object.assign(document.createElement('span'), { className: 'twf-new', textContent: 'NEW ' + bld.n }))
  box.children[1].textContent = bld ? `${bld.branch} @ ${bld.sha} · ${bld.time} · ${bld.mode}` : ''
  box.children[2].textContent = f.hint
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
  if (bld?.mode === 'personal') document.body.append(approveBar(bld))
  let hidden = false
  try { hidden = !!sessionStorage.getItem('twf-hidden') } catch { /* ignore */ }
  show(!hidden)
}

/** Bottom right, amber, shaped like the dev slot's approve box (controller/overlay.js): the owner's yes for this build, the stock twin one tap away.
 *  A press starts the check flow on the dev server (POST /__tw/approve); the box then turns grey "IN PROGRESS" and polls /__tw/status every 5 s. */
function approveBar(bld: { stockUrl: string; approved?: string | null }): HTMLElement {
  const bar = Object.assign(document.createElement('div'), { className: 'twf-ok' })
  bar.innerHTML = '<header></header><div class="body"></div>'
  const [head, body] = [bar.children[0] as HTMLElement, bar.children[1] as HTMLElement]
  const btn = (text: string, cls: string, on: () => void): HTMLButtonElement => {
    const b = Object.assign(document.createElement('button'), { textContent: text, className: cls })
    b.addEventListener('click', on)
    return b
  }
  const poll = (): void => {
    bar.classList.add('prog'); head.textContent = 'IN PROGRESS'
    const tick = (): void => {
      void fetch('/__tw/status').then((r) => r.json()).then((j: { step: string; text?: string; url?: string }) => {
        body.textContent = j.text ?? 'starting'
        if (j.step === 'failed') { body.className = 'body warn'; return }
        if (j.step === 'ready' && j.url) {
          body.textContent = `${j.text}. Opening dev in 3 s`
          setTimeout(() => { location.href = j.url! }, 3000)
          return
        }
        setTimeout(tick, 5000)
      }).catch(() => setTimeout(tick, 5000))
    }
    tick()
  }
  head.textContent = 'Personal preview'
  if (bld.approved) poll()
  else {
    body.append(btn('Approve personal preview', 'go', () => {
      void fetch('/__tw/approve', { method: 'POST' }).then((r) => r.ok && poll())
    }))
    if (bld.stockUrl) body.append(btn('Open stock preview', 'alt', () => { window.open(bld.stockUrl, '_blank') }))
  }
  head.addEventListener('pointerdown', (down) => {
    const dx = down.clientX - bar.offsetLeft, dy = down.clientY - bar.offsetTop
    head.setPointerCapture(down.pointerId)
    const move = (e: PointerEvent): void => { Object.assign(bar.style, { left: e.clientX - dx + 'px', top: e.clientY - dy + 'px', right: 'auto', bottom: 'auto' }) }
    head.addEventListener('pointermove', move)
    head.addEventListener('pointerup', () => head.removeEventListener('pointermove', move), { once: true })
  })
  return bar
}
