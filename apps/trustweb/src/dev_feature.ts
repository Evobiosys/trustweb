/**
 * Dev-only feature overlay for previews. vite.config.mjs `define`s __TW_FEATURE__ only for `vite serve` with TW_FEATURE set
 * (JSON {title, hint, selector?}; scripts/tw_dev.sh reads feature.json at the worktree root); in every build it is null.
 * Draws a draggable "FEATURE · <title>" box top-left; when `selector` matches, a pulsing outline and an arrow line point at it.
 */
import { createPointer } from './dev_pointer'
import { approveGate, mergeHead, conflictParts, personalApprove, APPROVE_HINT, MERGE_DONE } from './dev_preview_rules'

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
.twf-ok.prog{border-color:#5b6b70}.twf-ok.prog header{background:#5b6b70}.twf-ok.ok{border-color:#1f7a4d}.twf-ok.ok header{background:#1f7a4d}.twf-ok .warn{color:#a3271f;font-weight:600}
.twc-file,.twc-a,.twc-b{padding:0 3px;border-radius:4px;font-weight:700;overflow-wrap:anywhere}.twc-file{color:#0e6b73;background:#d9f3f2}.twc-a{color:#8a4a00;background:#ffe8c7}.twc-b{color:#6a2c9e;background:#efe0fb}
.twf-new{display:inline-block;margin-right:6px;padding:0 5px;border-radius:5px;background:#ffbf47;color:#241b2e}`

const POS_KEY = 'twf-ok-pos'

/** A conflict text as nodes: the file and the two features (or branch / main) in their own colours (.twc-file, .twc-a, .twc-b). */
export function conflictNodes(text: string): (Node | string)[] {
  return conflictParts(text).map((p) => typeof p === 'string' ? p : Object.assign(document.createElement('span'), { className: `twc-${p.kind}`, textContent: p.text }))
}
/** The Approve box's status as ONE line (its body is a grid: loose names would each take a row), with the optional "open" link. */
export function statusLine(text: string, url?: string): HTMLElement {
  const line = document.createElement('div')
  line.append(...conflictNodes(text))
  if (url) line.append(' ', Object.assign(document.createElement('a'), { href: url, target: '_blank', textContent: 'open' }))
  return line
}

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
  // `since`: a status file older than the press (a run that ended before) is not this run's answer.
  const poll = (since = 0): void => {
    bar.classList.add('prog'); head.textContent = 'IN PROGRESS'
    const stale = (j: ApprovalStatus): boolean => Date.parse(j.updated ?? '') < since
    pollStatus((j) => {
      if (stale(j)) return
      body.textContent = j.text ?? 'starting'
      if (j.step === 'failed') body.className = 'body warn'
      if (j.step === 'ready' && j.url) {
        body.textContent = `${j.text}. Opening dev in 3 s`
        setTimeout(() => { location.href = j.url! }, 3000)
      }
    }, '/__tw/status', (j) => !stale(j) && personalDone(j))
  }
  head.textContent = 'Personal preview'
  const hx = Object.assign(document.createElement('button'), { className: 'hx', textContent: '×', title: 'Hide for this tab' })
  hx.addEventListener('pointerdown', (e) => e.stopPropagation())
  hx.addEventListener('click', () => { bar.hidden = true; try { sessionStorage.setItem('twf-ok-hidden', '1') } catch { /* not remembered */ } })
  bar.prepend(hx)
  try { bar.hidden = !!sessionStorage.getItem('twf-ok-hidden') } catch { /* shown */ }
  const preview = typeof __TW_PREVIEW__ !== 'undefined' && !!__TW_PREVIEW__
  /** "Declare done": Touch ID, rollback tag, tests, PR, checks, squash merge, release (POST /__tw/approve-merge); its status line replaces the buttons until it ends. */
  const pollMerge = (since: number): void => {
    bar.classList.add('prog'); head.textContent = 'IN PROGRESS'; body.className = 'body'
    const stale = (j: ApprovalStatus): boolean => j.step === 'none' || Date.parse(j.updated ?? '') < since
    pollStatus((j) => {
      if (stale(j)) return
      const h = mergeHead(j.step); head.textContent = h.text; bar.classList.toggle('ok', h.ok); bar.classList.toggle('prog', !h.ok)
      body.replaceChildren(statusLine(j.text ?? 'starting', j.url))
      if (j.step === 'checks-failed' || j.step === 'failed') body.className = 'body warn'
      if (MERGE_DONE.includes(j.step) && j.step !== 'released') body.append(btn('Back', 'alt small', buttons))
    }, '/__tw/approve-merge', (j) => !stale(j) && MERGE_DONE.includes(j.step))
  }
  function buttons(): void {
    bar.classList.remove('prog', 'ok'); head.textContent = 'Personal preview'; body.className = 'body'; body.replaceChildren()
    const personal = btn('Declare done and continue to dev.trustweb.one', preview ? 'alt small' : 'go', () => {
      const since = Date.now() - 2000
      void fetch(personalApprove(preview, []).url, { method: 'POST' }).then((r) => r.ok && poll(since))
    })
    if (preview) {
      const hint = Object.assign(document.createElement('small'), { className: 'hint', textContent: APPROVE_HINT })
      const read = (): Promise<Parameters<typeof approveGate>[0]> => fetch('/__tw/preview').then((r) => r.json())
      // Open from the start; the press reads the registry fresh (and closes with the reason), so it works without a reload after boxes or verdicts changed.
      const go = btn('Declare done', 'go big', () => {
        const since = Date.now() - 2000
        void read().then((q) => {
          const g = approveGate(q)
          if (!g.ok) { go.disabled = true; hint.replaceChildren(...conflictNodes(g.hint)); return }
          return fetch('/__tw/approve-merge', { method: 'POST' }).then((r) => { if (r.status === 202 || r.status === 409) pollMerge(since) })
        }).catch(() => { hint.textContent = 'Preview server not answering' })
      })
      const refresh = (): void => {
        if (!go.isConnected) return
        void read().then((q) => {
          const g = approveGate(q); go.disabled = !g.ok; hint.replaceChildren(...conflictNodes(g.ok ? APPROVE_HINT : g.hint))
          personal.disabled = !personalApprove(true, q.features).ok
        }).catch(() => { /* server restarting: the next tick asks again */ })
      }
      body.append(go, hint); refresh(); const t = setInterval(() => { if (!go.isConnected) clearInterval(t); else refresh() }, 3000)
    }
    body.append(personal)
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
    head.addEventListener('pointerup', () => { head.removeEventListener('pointermove', move); try { localStorage.setItem(POS_KEY, JSON.stringify({ left: bar.style.left, top: bar.style.top })) } catch { /* not remembered */ } }, { once: true })
  })
  // The dragged place is remembered per window (origin), pulled back inside a smaller viewport.
  try {
    const at = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') as { left: string; top: string } | null
    if (at) Object.assign(bar.style, { left: Math.max(0, Math.min(parseFloat(at.left), innerWidth - 120)) + 'px', top: Math.max(0, Math.min(parseFloat(at.top), innerHeight - 60)) + 'px', right: 'auto', bottom: 'auto' })
  } catch { /* nothing stored */ }
  return bar
}
