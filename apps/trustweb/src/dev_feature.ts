/**
 * Dev-only feature overlay for previews. vite.config.mjs `define`s __TW_FEATURE__ only for `vite serve` with TW_FEATURE set
 * (JSON {title, hint, selector?}; scripts/tw_dev.sh reads feature.json at the worktree root); in every build it is null.
 * Draws a draggable "FEATURE · <title>" box top-left; when `selector` matches, a pulsing outline and an arrow line point at it.
 */
import { createPointer } from './dev_pointer'
import { approveGate, MERGE_DONE } from './dev_preview_rules'

declare const __TW_FEATURE__: { title: string; hint: string; selector?: string } | null | undefined
declare const __TW_PREVIEW__: object | null | undefined
declare const __TW_BUILD__: { branch: string; sha: string; time: string; mode: string; stockUrl: string; n?: number; approved?: string | null } | null | undefined

const CSS = `
.twf{position:fixed;left:var(--twp-l,8px);top:calc(var(--twp-t,8px) + var(--twp-h,0px));z-index:99999;max-width:240px;padding:6px 10px;border-radius:10px;background:#241b2e;color:#fff;font:600 11px/1.35 system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.4);touch-action:none;cursor:grab;opacity:.94}
.twf i{display:block;font-style:normal;font-weight:500;opacity:.8}.twf button{margin-top:4px;font:600 11px system-ui;border:0;border-radius:6px;padding:3px 8px;background:#4fd7a0;color:#241b2e;cursor:pointer}
.twf b{display:block;font-size:10px;letter-spacing:.06em;color:#4fd7a0}.twf span{font-weight:500}
.twf .twf-x{position:absolute;top:2px;right:4px;margin:0;padding:0 5px;background:none;color:#fff;font-size:14px}
.twf-dot{position:fixed;left:8px;top:8px;z-index:99999;width:18px;height:18px;padding:0;border:0;border-radius:50%;background:#241b2e;color:#4fd7a0;font:700 11px/18px system-ui;cursor:pointer;opacity:.7}
.twf-ok{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:320px;max-width:calc(100vw - 32px);font:13px/1.4 system-ui,sans-serif;color:#1d2a2e;background:#fff;border:1.5px solid #b8650a;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.25);touch-action:none}
@media (max-width:600px){.twf-ok{bottom:96px}}
.twf-ok .hx{position:absolute;top:4px;right:6px;width:auto;margin:0;padding:0 5px;background:none;color:#fff;font-size:16px;line-height:1}
.twf-ok header{padding:8px 10px;background:#b8650a;color:#fff;border-radius:12px 12px 0 0;cursor:move;user-select:none;font-weight:700}
.twf-ok .body{padding:8px 10px;display:grid;gap:6px}.twf-ok button{font:inherit;border-radius:9px;border:0;padding:9px 10px;cursor:pointer;width:100%}
.twf-ok .go{background:#b8650a;color:#fff;font-weight:700}.twf-ok .big{padding:13px 10px;font-size:15px;background:#1f7a4d}.twf-ok button{text-decoration:underline}.twf-ok .small{padding:5px 10px;font-size:12px}.twf-ok button:disabled{opacity:.45;cursor:not-allowed;text-decoration:none}.twf-ok .hint{font-size:11px;color:#5b6b70}.twf-ok .alt{background:none;color:#b8650a;border:1px solid #b8650a}
.twf-ok.prog{border-color:#5b6b70}.twf-ok.prog header{background:#5b6b70}.twf-ok .warn{color:#a3271f;font-weight:600}
.twf-new{display:inline-block;margin-right:6px;padding:0 5px;border-radius:5px;background:#ffbf47;color:#241b2e}`

export function initDevFeature(): void {
  if (window.top !== window) return // inside the second-device iframe: not the reviewer's page
  const f = typeof __TW_FEATURE__ === 'undefined' ? null : __TW_FEATURE__
  const bld = typeof __TW_BUILD__ === 'undefined' ? null : __TW_BUILD__
  const feature = !!f && (f as unknown) !== 'null' && !!f.title
  if (!feature && bld?.mode !== 'personal') return
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }))
  // The Approve box belongs to every personal window, registry previews (TW_FEATURE=null) included; the FEATURE box needs a title.
  if (bld?.mode === 'personal') document.body.append(approveBar(bld, typeof __TW_PREVIEW__ === 'undefined' || !__TW_PREVIEW__))
  if (!f || (f as unknown) === 'null' || !f.title) return
  const box = Object.assign(document.createElement('div'), { className: 'twf' })
  box.innerHTML = '<b></b><i></i><span></span>'
  box.children[0].textContent = 'FEATURE · ' + f.title
  if (bld?.n && bld.n >= 2) box.children[0].prepend(Object.assign(document.createElement('span'), { className: 'twf-new', textContent: 'NEW ' + bld.n }))
  box.children[1].textContent = bld ? `${bld.branch} @ ${bld.sha} · ${bld.time} · ${bld.mode}` : ''
  box.children[2].textContent = f.hint
  let pointerOff = false
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
  x.addEventListener('click', () => show(false))
  dot.addEventListener('click', () => show(true))
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') show(false) })
  document.body.append(box, dot)
  const pointer = createPointer(() => box.getBoundingClientRect(), () => { pointerOff = true; point() })

  const point = (): void => { pointer.set(box.hidden || pointerOff ? null : f.selector) }

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

export interface ApprovalStatus { step: string; text?: string; url?: string; pr?: number | null; started?: string; etaSeconds?: number; updated?: string; sha?: string }

const personalDone = (j: ApprovalStatus): boolean => j.step === 'failed' || (j.step === 'ready' && !!j.url)

/** Polls a status url (default GET /__tw/status) every 5 s and hands each answer to `on`, until `done` says the flow has ended. */
export function pollStatus(on: (j: ApprovalStatus) => void, url = '/__tw/status', done = personalDone): void {
  const tick = (): void => {
    void fetch(url).then((r) => r.json()).then((j: ApprovalStatus) => {
      on(j)
      if (!done(j)) setTimeout(tick, 5000)
    }).catch(() => setTimeout(tick, 5000))
  }
  tick()
}

/** Bottom right, amber, shaped like the dev slot's approve box (controller/overlay.js): the owner's yes for this build, the stock twin one tap away.
 *  A press starts the check flow on the dev server (POST /__tw/approve); the box then turns grey "IN PROGRESS" and polls /__tw/status every 5 s. */
function approveBar(bld: { stockUrl: string; sha?: string; approved?: string | null }, stockLink: boolean): HTMLElement {
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
    pollStatus((j) => {
      body.textContent = j.text ?? 'starting'
      if (j.step === 'failed') body.className = 'body warn'
      if (j.step === 'ready' && j.url) {
        body.textContent = `${j.text}. Opening dev in 3 s`
        setTimeout(() => { location.href = j.url! }, 3000)
      }
    })
  }
  head.textContent = 'Personal preview'
  const hx = Object.assign(document.createElement('button'), { className: 'hx', textContent: '×', title: 'Hide for this tab' })
  hx.addEventListener('pointerdown', (e) => e.stopPropagation())
  hx.addEventListener('click', () => { bar.hidden = true; try { sessionStorage.setItem('twf-ok-hidden', '1') } catch { /* not remembered */ } })
  bar.prepend(hx)
  try { bar.hidden = !!sessionStorage.getItem('twf-ok-hidden') } catch { /* shown */ }
  const preview = typeof __TW_PREVIEW__ !== 'undefined' && !!__TW_PREVIEW__
  /** "Approve": Touch ID, PR, checks, squash merge, release (POST /__tw/approve-merge); its status line replaces the buttons until it ends. */
  const pollMerge = (since: number): void => {
    bar.classList.add('prog'); head.textContent = 'IN PROGRESS'; body.className = 'body'
    const stale = (j: ApprovalStatus): boolean => j.step === 'none' || Date.parse(j.updated ?? '') < since
    pollStatus((j) => {
      if (stale(j)) return
      body.replaceChildren(j.text ?? 'starting')
      if (j.url) body.append(' ', Object.assign(document.createElement('a'), { href: j.url, target: '_blank', textContent: 'open' }))
      if (j.step === 'checks-failed' || j.step === 'failed') body.className = 'body warn'
      if (MERGE_DONE.includes(j.step) && j.step !== 'released') body.append(btn('Back', 'alt small', buttons))
    }, '/__tw/approve-merge', (j) => !stale(j) && MERGE_DONE.includes(j.step))
  }
  function buttons(): void {
    bar.classList.remove('prog'); head.textContent = 'Personal preview'; body.className = 'body'; body.replaceChildren()
    if (preview) {
      const hint = Object.assign(document.createElement('small'), { className: 'hint', textContent: 'Checking…' })
      const go = btn('Approve', 'go big', () => {
        const since = Date.now() - 2000
        void fetch('/__tw/approve-merge', { method: 'POST' }).then((r) => { if (r.status === 202 || r.status === 409) pollMerge(since) })
      })
      go.disabled = true
      const refresh = (): void => {
        if (!go.isConnected) return
        void fetch('/__tw/preview').then((r) => r.json()).then((q: Parameters<typeof approveGate>[0]) => {
          const g = approveGate(q); go.disabled = !g.ok; hint.textContent = g.ok ? 'Touch ID, then merges to main and deploys' : g.hint
        }).catch(() => { /* server restarting: the next tick asks again */ })
      }
      body.append(go, hint); refresh(); const t = setInterval(() => { if (!go.isConnected) clearInterval(t); else refresh() }, 3000)
    }
    body.append(btn('Approve personal view', preview ? 'alt small' : 'go', () => {
      void fetch('/__tw/approve', { method: 'POST' }).then((r) => r.ok && poll())
    }))
    if (stockLink && bld.stockUrl) body.append(btn('Open stock preview', 'alt', () => { window.open(bld.stockUrl, '_blank') }))
  }
  if (bld.approved) poll()
  else {
    buttons()
    // A reload while a run is going (or ended for this very commit) shows its line again.
    if (preview) void fetch('/__tw/approve-merge').then((r) => r.json()).then((j: ApprovalStatus) => { if (j.step !== 'none' && (!bld.sha || !j.sha || j.sha.startsWith(bld.sha))) pollMerge(0) }).catch(() => { /* no status: buttons stay */ })
  }
  head.addEventListener('pointerdown', (down) => {
    const dx = down.clientX - bar.offsetLeft, dy = down.clientY - bar.offsetTop
    head.setPointerCapture(down.pointerId)
    // Dragged, but never out of the viewport: the box stays fully visible.
    const clamp = (v: number, size: number, room: number): number => Math.max(0, Math.min(v, room - size))
    const move = (e: PointerEvent): void => { Object.assign(bar.style, { left: clamp(e.clientX - dx, bar.offsetWidth, innerWidth) + 'px', top: clamp(e.clientY - dy, bar.offsetHeight, innerHeight) + 'px', right: 'auto', bottom: 'auto' }) }
    head.addEventListener('pointermove', move)
    head.addEventListener('pointerup', () => head.removeEventListener('pointermove', move), { once: true })
  })
  return bar
}
