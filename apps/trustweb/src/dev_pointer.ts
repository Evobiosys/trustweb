/** Dev-only pointer: a pulsing red ring around the element a CSS selector matches plus a dashed line from an anchor box to it. Used by dev_feature.ts and dev_preview.ts. */
const CSS = `
.twf-ring{position:fixed;z-index:99998;pointer-events:none;border:3px solid #ff715b;border-radius:12px;animation:twf 1.2s ease-in-out infinite}
.twf-rx{position:absolute;top:-13px;right:-13px;width:20px;height:20px;padding:0;border:0;border-radius:50%;background:#ff715b;color:#fff;font:700 14px/20px system-ui;cursor:pointer;pointer-events:auto}
.twf-line{position:fixed;inset:0;z-index:99997;pointer-events:none;width:100%;height:100%}
@keyframes twf{50%{box-shadow:0 0 0 8px rgba(255,113,91,.35)}}`

export interface Box { left: number; top: number; right: number; bottom: number }

/** The part of `r` that shows inside every clip box (viewport, scroll containers); null when nothing shows. */
export function clipToVisible(r: Box, clips: Box[]): Box | null {
  const v = clips.reduce<Box>((a, c) => ({ left: Math.max(a.left, c.left), top: Math.max(a.top, c.top), right: Math.min(a.right, c.right), bottom: Math.min(a.bottom, c.bottom) }), r)
  return v.right > v.left && v.bottom > v.top ? v : null
}

/** Rect of the first match of `selector` that actually shows: inside the viewport and every scrolling/clipping ancestor, not visibility:hidden. */
function visibleRect(selector: string): Box | null {
  const el = document.querySelector(selector)
  if (!el || getComputedStyle(el).visibility === 'hidden') return null
  const clips: Box[] = [{ left: 0, top: 0, right: innerWidth, bottom: innerHeight }]
  for (let p = el.parentElement; p; p = p.parentElement) {
    const cs = getComputedStyle(p)
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') clips.push(p.getBoundingClientRect())
  }
  return clipToVisible(el.getBoundingClientRect(), clips)
}

export interface Pointer {
  /** Point at the first match of `selector` (null = off). Returns false when nothing visible matches. */
  set(selector: string | null | undefined): boolean
  /** Re-place ring and line, e.g. after the anchor moved. */
  update(): void
}

/** `anchor` is the box the line starts from; the ring's x button calls `onRemove`. Ring and line follow DOM changes, resize and scroll;
 *  `onSeen` fires when the target appears or disappears, so a pointer armed for a view not open yet can announce itself. */
export function createPointer(anchor: () => DOMRect, onRemove: () => void, onSeen?: (seen: boolean) => void): Pointer {
  const NS = 'http://www.w3.org/2000/svg'
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }))
  const ring = Object.assign(document.createElement('div'), { className: 'twf-ring' })
  const rx = Object.assign(document.createElement('button'), { className: 'twf-rx', textContent: '×', title: 'Remove pointer' })
  rx.addEventListener('click', onRemove)
  ring.appendChild(rx)
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('class', 'twf-line')
  const line = document.createElementNS(NS, 'line')
  line.setAttribute('stroke', '#ff715b'); line.setAttribute('stroke-width', '2'); line.setAttribute('stroke-dasharray', '6 4')
  svg.appendChild(line)
  document.body.append(svg, ring)
  let selector: string | null = null
  let seen = false

  const update = (): boolean => {
    const r = selector ? visibleRect(selector) : null
    const off = !r
    if (seen === off) { seen = !off; onSeen?.(seen) }
    ring.hidden = off; svg.style.display = off ? 'none' : ''
    if (off) return false
    Object.assign(ring.style, { left: r.left - 4 + 'px', top: r.top - 4 + 'px', width: r.right - r.left + 8 + 'px', height: r.bottom - r.top + 8 + 'px' })
    const b = anchor()
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2
    // From the anchor's edge nearest the target to the outline's centre.
    line.setAttribute('x1', String(Math.min(Math.max(cx, b.left), b.right))); line.setAttribute('y1', String(Math.min(Math.max(cy, b.top), b.bottom)))
    line.setAttribute('x2', String(cx)); line.setAttribute('y2', String(cy))
    return true
  }
  let queued = false
  const soon = (): void => { if (queued) return; queued = true; setTimeout(() => { queued = false; update() }, 150) }
  new MutationObserver(soon).observe(document.body, { subtree: true, childList: true })
  window.addEventListener('resize', soon)
  document.addEventListener('scroll', soon, true)
  update()
  return { set: (s) => { selector = s ?? null; return update() }, update: () => { update() } }
}
