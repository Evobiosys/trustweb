/**
 * Dev-only preview panel (wave7/preview-overlay). vite.config.mjs `define`s __TW_PREVIEW__ (the registry file <id>.json, see
 * previews-interface.txt) only for `vite serve` with TW_PREVIEW set; in every build it is null and nothing below runs.
 * Top-left, draggable by its header (twp-pos), collapsible to a pill with the id (twp-collapsed): the feature checkboxes of this
 * preview and the personal/stock switch (the PR itself starts from "Approve personal view" in dev_feature.ts). The FEATURE box (dev_feature.ts) sits below it via --twp-h.
 * A tap on a row points at the UI the feature adds (its `selector`). A box or pill writes the registry at once; the panel then starts the assembly
 * itself (POST /__tw/preview/apply) and the page reloads once the assembled sha moved (Jakob 2026-10-24: no manual reload). A sticky bar shows
 * "Assembling…" meanwhile; only a stuck apply (90 s without a registry change) waits for the owner's Retry. The page also watches the registry
 * (every 2 s): an assembly made elsewhere (CLI, the Approve press, another tab) reloads it too.
 */
import { conflictNodes, pollStatus, type ApprovalStatus } from './dev_feature'
import { createDevice2, DEVICE2_CSS } from './dev_device2'
import { createPointer } from './dev_pointer'
import { createSteps } from './dev_steps'
import { applyStamp, applyStuck, autoApply, reloadMark, scrollStore, shouldReload, ciLine, collapseStore, descendants, devLabel, devUrl, needsHint, prGate, prMerged, prRunning, testLine, allApproved, pillPress, selectAll, shownVerdict, rowPlan, relatedRows, stepText, readSeen, REPO_LABEL, sections, seenState, tapped, tapSeen, tree, visible, type PreviewFeature, type Tested, type TreeNode } from './dev_preview_rules'

interface Preview {
  id: string; short: string; created: string; base: string; baseSha: string; branch: string
  port: number; stockPort: number; mode: 'personal' | 'stock'; features: PreviewFeature[]
  assembled: { sha: string; at: string; error: string | null; restart?: boolean; set?: string[] } | null
  pending?: boolean
  pr: { number: number; url: string; branch?: string; at?: string; sha?: string; merged?: boolean } | null
  next?: { id: string; port: number }
  tested?: Tested | null
  session?: { id: string; path: string }
}
declare const __TW_PREVIEW__: Preview | null | undefined
declare const __TW_BUILD__: { mode: string } | null | undefined

const CSS = `
.twp{position:fixed;left:8px;top:8px;z-index:100000;width:300px;max-width:calc(100vw - 16px);max-height:calc(100vh - 110px);overflow:hidden auto;scrollbar-width:thin;scrollbar-color:#7a6a8c transparent;border-radius:10px;background:#241b2e;color:#fff;font:11px/1.35 system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.4)}
.twp header{display:flex;align-items:baseline;gap:6px;padding:6px 10px;cursor:grab;touch-action:none;user-select:none}
.twp header b{font:700 15px ui-monospace,monospace;color:#4fd7a0}.twp header span{flex:1;opacity:.8}
.twp .row{padding:0 10px 4px}.twp small{opacity:.7}.twp .warn{color:#ff715b;font-weight:600}
.twp .twc-file,.twp .twc-a,.twp .twc-b{padding:0 3px;border-radius:4px;font-weight:700;overflow-wrap:anywhere}.twp .twc-file{color:#7ee8de;background:rgba(94,234,212,.16)}.twp .twc-a{color:#ffc65c;background:rgba(251,191,36,.16)}.twp .twc-b{color:#e3a8ff;background:rgba(233,166,255,.16)}
.twp .feat{display:flex;flex-wrap:wrap;gap:2px 6px;align-items:baseline;padding:2px 0;cursor:pointer}.twp .feat>span:not(.pills){flex:1 1 0;min-width:0;overflow-wrap:anywhere}.twp .feat.twp-active{background:rgba(79,215,160,.22);border-radius:4px}.twp .feat.twp-related{background:rgba(255,198,92,.2);border-radius:4px;box-shadow:inset 3px 0 #ffc65c}.twp .feat.off{opacity:.55}.twp .feat.seen{font-style:italic;opacity:.85}.twp .lit i{width:7px;height:7px;border-radius:50%;background:#ff715b;flex:none}
.twp .kids{margin-left:5px;padding-left:9px;border-left:1px solid #7a6a8c}.twp .kids>div>.feat::before{content:'';width:6px;border-top:1px solid #7a6a8c;margin-left:-9px;align-self:center;flex:none}
.twp .mini{flex:none;padding:1px 6px;font-size:10px}.twp header b{cursor:copy}
.twp .chev{flex:none;width:12px;padding:0;background:none;color:#b7a8c9;font-size:10px;line-height:1;cursor:pointer}.twp .chev.leaf{visibility:hidden}.twp .hid{opacity:.6;font-style:italic}
.twp .spin{width:9px;height:9px;border:2px solid #4fd7a0;border-right-color:transparent;border-radius:50%;animation:twp-spin .8s linear infinite;align-self:center;flex:none}@keyframes twp-spin{to{transform:rotate(360deg)}}
.twp .ask{margin:4px 10px;padding:6px 8px;border-radius:8px;background:#3a2c48;display:grid;gap:5px}.twp .ask div{display:flex;gap:6px}
.twp-pre{position:fixed;left:50%;top:10vh;transform:translateX(-50%);z-index:100001;width:min(560px,92vw);padding:8px;border-radius:10px;background:#241b2e;color:#fff;font:11px system-ui;display:grid;gap:6px}.twp-pre pre{margin:0;max-height:50vh;overflow:auto;white-space:pre-wrap;user-select:all}
.twp-done .twp{pointer-events:none;opacity:.45}
.twp-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100001;padding:6px 12px;border-radius:8px;background:#241b2e;color:#fff;font:12px system-ui}
.twp button{font:600 11px system-ui;border:0;border-radius:6px;padding:5px 8px;background:#4fd7a0;color:#241b2e;cursor:pointer}
.twp button.alt{background:none;color:#4fd7a0;border:1px solid #4fd7a0}.twp .x{background:none;color:#fff;font-size:14px;padding:0 4px}
.twp .btns{display:grid;gap:5px;padding:4px 10px 8px}.twp a{color:#4fd7a0}
.twp button:disabled{opacity:.45;cursor:not-allowed}
.twp pre.log{margin:0;max-height:8.5em;overflow:auto;font:10px/1.3 ui-monospace,monospace;background:#16101d;padding:4px;border-radius:6px;white-space:pre-wrap}
.twp .pills{flex:1 0 100%;display:flex;flex-wrap:wrap;gap:3px;padding-left:31px;box-sizing:border-box}.twp .pill{padding:1px 6px;font-size:10px;background:none;color:#b7a8c9;border:1px solid #7a6a8c;text-decoration:underline}
.twp .pill.on.merge{background:#4fd7a0;color:#241b2e;border-color:#4fd7a0}.twp .pill.on.work{background:#e5484d;color:#fff;border-color:#e5484d}
.twp .bar{position:sticky;bottom:0;margin:4px 0 0;padding:6px 10px;background:#3a2c48;display:grid;gap:5px;border-top:1px solid #7a6a8c}.twp .bar div{display:flex;gap:6px;align-items:center}.twp .bar button{text-decoration:underline}
.twp .upd{margin-left:4px;padding:0 4px;border-radius:4px;background:#ffbf47;color:#241b2e;font-weight:700}
.twp .where{display:block;color:#9a9aa6;font-size:10px}
.twp .sec{font:700 10px system-ui;letter-spacing:.04em;opacity:.7;margin:4px 0 2px}
.see-action{display:none!important}
.twp.pill{width:auto}.twp .tag{padding:5px 10px;cursor:grab;touch-action:none;user-select:none;font:700 13px ui-monospace,monospace;color:#4fd7a0}
${DEVICE2_CSS}`

const POS = 'twp-pos'
const folded = (id: string): string[] => { try { return JSON.parse(sessionStorage.getItem('twp-tree-' + id) ?? '[]') as string[] } catch { return [] } }
const setFolded = (id: string, keys: string[]): void => { try { sessionStorage.setItem('twp-tree-' + id, JSON.stringify(keys)) } catch { /* not remembered */ } }
const seenKey = (id: string): string => 'twp-seen-' + id
const store = {
  get: (k: string): string | null => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string): void => { try { localStorage.setItem(k, v) } catch { /* private mode: not remembered */ } },
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props)
  e.append(...kids)
  return e
}

class ApiError extends Error {}

async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Preview> {
  const r = await fetch('/__tw/preview' + path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
  const j = (await r.json()) as Preview & { error?: string }
  if (!r.ok) throw new ApiError(j.error ?? 'HTTP ' + r.status)
  return j
}

const hhmm = (iso: string): string => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

export function initDevPreview(): void {
  if (window.top !== window) return // an iframe (the second device) is never the reviewer's page
  let p = typeof __TW_PREVIEW__ === 'undefined' ? null : __TW_PREVIEW__
  if (!p) return
  let seen = readSeen(store.get(seenKey(p.id)))
  // The serve-start copy of the registry can be stale: refs are compared only once the server has answered.
  let fresh = false
  let busy: string | null = null
  let since = 0
  let prStep = ''
  let lit: string | null = null
  // An apply running: the registry stamp last seen and when it last moved (stuck after 90 s without a change).
  let applying: { stamp: string; moved: number; stuck: boolean } | null = null
  // The assembled sha this page knows (set once the server answered): a different one in a later answer reloads the page.
  let known: string | null = null
  let error = ''
  let prText = ''
  let prUrl = ''
  let prNum: number | null = null
  let prEta = 0
  let prStarted = ''
  let opening: ReturnType<typeof setTimeout> | null = null
  let pointing = false
  let testing = false
  const root = h('div')
  const mode = typeof __TW_BUILD__ === 'undefined' || !__TW_BUILD__ ? p.mode : (__TW_BUILD__.mode as Preview['mode'])
  document.head.appendChild(h('style', { textContent: CSS }))
  document.body.appendChild(root)
  const pointer = createPointer(() => root.getBoundingClientRect(), () => { lit = null; render() }, (seen) => { pointing = seen; steps.seen(seen); if (lit) render() })
  const steps = createSteps(pointer, () => { lit = null; render() })

  const tab = collapseStore(sessionStorage)
  const collapsed = tab.get
  const setCollapsed = (on: boolean): void => { tab.set(on); render() }
  const loading = (): boolean => busy !== null || (prText !== '' && prStep !== 'ready' && prStep !== 'failed')
  const elapsed = (): number => Math.floor((Date.now() - since) / 1000)
  const begin = (): void => { since = Date.now() }
  setInterval(() => { const c = root.querySelector('.clk'); if (c) c.textContent = elapsed() + ' s'; const e = root.querySelector('.eta'); if (e && prEta) e.textContent = ciLine(prEta, prStarted, Date.now()); if (busy !== null && elapsed() > 90 && !root.querySelector('.slow')) render() }, 1000)
  const sync = (): void => {
    const { left, top } = root.getBoundingClientRect(), style = document.documentElement.style
    if (root.hidden) { for (const v of ['--twp-h', '--twp-l', '--twp-t']) style.removeProperty(v); return }
    style.setProperty('--twp-h', root.offsetHeight + 'px'); style.setProperty('--twp-l', left + 'px'); style.setProperty('--twp-t', top + 'px')
  }

  // Drag by `handle`; a pointer that moved less than 4 px is a click.
  function drag(handle: HTMLElement): { moved: boolean } {
    const state = { moved: false }
    handle.addEventListener('pointerdown', (down) => {
      if ((down.target as HTMLElement).closest('button')) return
      state.moved = false
      const dx = down.clientX - root.offsetLeft, dy = down.clientY - root.offsetTop
      handle.setPointerCapture(down.pointerId)
      const move = (e: PointerEvent): void => {
        if (Math.abs(e.clientX - down.clientX) + Math.abs(e.clientY - down.clientY) > 3) state.moved = true
        place(e.clientX - dx, e.clientY - dy); sync()
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', () => { handle.removeEventListener('pointermove', move); if (state.moved) store.set(POS, JSON.stringify({ x: root.offsetLeft, y: root.offsetTop })) }, { once: true })
    })
    return state
  }
  // Never out of the viewport: the panel stays reachable.
  function place(x: number, y: number): void {
    root.style.left = Math.max(0, Math.min(x, innerWidth - root.offsetWidth)) + 'px'
    root.style.top = Math.max(0, Math.min(y, innerHeight - root.offsetHeight)) + 'px'
  }

  async function act(key: string | null, run: () => Promise<Preview>): Promise<void> {
    busy = key ?? 'x'; error = ''; begin(); render()
    try { p = await run() } catch (e) { error = (e as Error).message }
    busy = null; render()
    if (p && autoApply(p, applying)) void apply()
  }

  const toast = (text: string): void => {
    const t = document.body.appendChild(h('div', { className: 'twp-toast', textContent: text }))
    setTimeout(() => { t.remove() }, 2500)
  }

  createDevice2(p.id, p.stockPort, mode, toast)
  // Title tap / Walk: the feature's steps as the yellow card over the phone, always (a step may need the reviewer's own tap, which an
  // automatic click-through gave up on); a feature without steps is only pointed at.
  const walk = (f: PreviewFeature): void => { if (lit === f.key) lit = null; tap(f, true) }

  function tap(f: PreviewFeature, walking = false): void {
    seen = tapSeen(seen, f.key, f.ref ?? '')
    store.set(seenKey(p!.id), JSON.stringify(seen))
    lit = tapped(lit, f.key)
    steps.close()
    // The ring shows when the selector matches; else the steps overlay walks to it, the last step being the feature itself.
    if (lit) {
      const plan = walking && f.steps?.length ? 'walk' : rowPlan(pointer.set(f.selector), f.steps)
      if (plan === 'walk') steps.open(f.steps!)
      else if (plan === 'none') { lit = null; toast('nothing to point at for this feature') }
      else if (plan === 'steps') steps.open([...f.steps!, f.selector ? `${f.title} @ ${f.selector}` : f.title])
    }
    render()
  }

  // A box or pill only writes the registry (the CLI cascades requires/dependants); the server answers with the new registry.
  const setVerdict = (feature: string, verdict: 'merge' | 'needs-work' | null): Promise<void> => act(null, () => call('POST', '/verdict', { feature, verdict }))
  const press = (key: string, v: 'merge' | 'needs-work'): Promise<void> => setVerdict(key, pillPress(p!.features, key, v))
  const pressAll = (): Promise<void> => act(null, () => call('POST', '', { set: selectAll(p!.features, !allApproved(p!.features)) }))

  // Assemble the approved set on the server (the vite config only restarts the server when its content changed), poll the registry
  // (pending / assembled.at) and reload when it is done; no registry change for 90 s = stuck, "Retry" asks again.
  async function apply(): Promise<void> {
    if (applying && !applying.stuck) return
    const start = Date.now()
    applying = { stamp: applyStamp(p!), moved: start, stuck: false }; error = ''; render()
    try { await call('POST', '/apply', {}) } catch (e) { error = (e as Error).message; applying = null; render(); return }
    for (;;) {
      await new Promise((r) => setTimeout(r, 500))
      const q = await call('GET', '').catch(() => null)   // null while the server restarts
      if (q) {
        p = q
        const stamp = applyStamp(q)
        if (stamp !== applying.stamp) applying = { ...applying, stamp, moved: Date.now() }
        if (!q.pending && q.assembled && Date.parse(q.assembled.at) > start) {
          applying = null
          // Never reload into a dead server: the waiting page polls until a server that started after the apply (none when no restart is coming) answers.
          if (!q.assembled.error) { go(q.assembled.restart === false ? 0 : start); return }
          known = q.assembled.sha; render(); return
        }
      }
      if (applyStuck(applying.moved, Date.now())) { applying.stuck = true; render(); return }
      render()
    }
  }

  const reloaded = reloadMark(sessionStorage, p.id)
  // The panel's scroll offset survives every reload; a scroll event right after a render is the browser clamping the fresh content, not the reviewer.
  const scrolled = scrollStore(sessionStorage, p.id)
  let renderedAt = 0
  root.addEventListener('scroll', () => { if (!root.classList.contains('pill') && Date.now() - renderedAt > 100) scrolled.set(root.scrollTop) })
  /** To the waiting page, which comes back here once a server (started after `since`; 0 = any) answers three times. */
  const go = (since: number): void => { reloaded.set({ sha: p!.assembled?.sha ?? '', at: Date.now() }); location.href = `/__tw/wait?to=${encodeURIComponent(location.pathname + location.search + location.hash)}&since=${since}` }

  /** Sticky at the bottom of the panel while an assembly runs; a stuck one offers Retry. Nothing to press otherwise: the apply starts by itself. */
  function assemblyBar(): HTMLElement | null {
    if (!applying) return null
    const retry = h('button', { textContent: 'Retry' })
    retry.addEventListener('click', () => { void apply() })
    if (applying.stuck) return h('div', { className: 'bar' }, 'Apply seems stuck — ', retry)
    return h('div', { className: 'bar' }, h('i', { className: 'spin' }), ' Assembling…')
  }

  // The registry watched every 2 s: an assembly made elsewhere reloads the page; a pending set left by the CLI starts the apply here.
  let last = ''
  async function watch(): Promise<void> {
    if (applying || busy !== null || document.hidden) return
    const q = await call('GET', '').catch(() => null)
    if (!q || applying || busy !== null) return
    if (shouldReload(known, q.assembled, reloaded.get(), Date.now())) { p = q; go(0); return }
    known ??= q.assembled?.sha ?? null
    const stamp = JSON.stringify(q)
    if (stamp !== last) { last = stamp; p = q; render() }
    if (autoApply(q, applying)) void apply()
  }

  let related = new Set<string>()
  function row(n: TreeNode, shown: PreviewFeature[]): HTMLElement {
    const f = n.feature, d = shown.find((x) => x.key === f.key)!
    const hint = needsHint(shown, f.key)
    const off = loading() || hint !== null
    const box = h('input', { type: 'checkbox', checked: d.checked, disabled: off })
    box.addEventListener('change', () => { void setVerdict(f.key, box.checked ? 'merge' : null) })
    const mark = seenState(seen, f.key, fresh ? f.ref ?? '' : seen[f.key]?.ref ?? '')
    if (mark.next !== seen) { seen = mark.next; store.set(seenKey(p!.id), JSON.stringify(seen)) }
    const closed = n.children.length > 0 && folded(p!.id).includes(f.key)
    const chev = h('button', { className: 'chev' + (n.children.length ? '' : ' leaf'), textContent: closed ? '▸' : '▾', title: closed ? 'Expand' : 'Collapse' })
    chev.addEventListener('click', (e) => { e.stopPropagation(); setFolded(p!.id, closed ? folded(p!.id).filter((k) => k !== f.key) : [...folded(p!.id), f.key]); render() })
    const walking = lit === f.key && steps.active()
    const go = h('button', { className: 'mini', textContent: walking ? 'Stop' : 'Walk' })
    go.addEventListener('click', (e) => { e.stopPropagation(); if (walking) { lit = null; render() } else walk(f) })
    const pill = (v: 'merge' | 'needs-work', text: string): HTMLButtonElement => {
      const b = h('button', { className: `pill ${v === 'merge' ? 'merge' : 'work'}` + (shownVerdict(f) === v ? ' on' : ''), textContent: text, disabled: loading() })
      b.addEventListener('click', (e) => { e.stopPropagation(); void press(f.key, v) })
      return b
    }
    const how = h('button', { className: 'mini alt', textContent: '?', title: 'Show the steps by hand' })
    how.addEventListener('click', (e) => { e.stopPropagation(); tap(f) })
    const label = h('div', { className: 'feat' + (off ? ' off' : '') + (mark.italic ? ' seen' : '') + (lit === f.key ? ' lit twp-active' : '') + (related.has(f.key) ? ' twp-related' : '') }, chev, box, h('span', {}, mark.prefix + f.title, ' ', h('small', {}, f.branch + (hint ? ' · ' + hint : '')), ...(f.updated ? [h('small', { className: 'upd', textContent: 'updated' })] : []), ...(closed ? [' ', h('small', { className: 'hid' }, `(${descendants(n)} hidden)`)] : []), ...(f.where ? [h('small', { className: 'where', textContent: f.where })] : [])), lit === f.key && pointing ? h('i') : '', h('span', { className: 'pills' }, pill('merge', 'approve'), pill('needs-work', 'needs work'), ...(f.steps?.length ? [go, how] : [])))
    label.addEventListener('click', (e) => { if (e.target === box || e.target === chev) return; if (lit === f.key) { lit = null; render() } else walk(f) })
    return h('div', {}, label, ...(n.children.length && !closed ? [h('div', { className: 'kids' }, ...n.children.map((c) => row(c, shown)))] : []))
  }

  function slow(): HTMLElement {
    const re = h('button', { textContent: 'Reload' })
    re.addEventListener('click', () => { location.reload() })
    return h('div', { className: 'row warn slow' }, 'taking long: reload by hand ', re)
  }

  // The status file's answer as panel state. On the ready step the tab opens dev after 3 s (once per PR: a reload only shows the links).
  function applyStatus(j: ApprovalStatus, live: boolean): void {
    prStep = j.step; prText = stepText(j.step, j.text, p!.short, j.pr); prUrl = j.url ?? ''; prNum = j.pr ?? null
    prEta = j.etaSeconds ?? 0; prStarted = j.started ?? ''
    if (j.step === 'ready') void call('GET', '').then((q) => { p = q; render() }).catch(() => { /* links come from the status */ })
    if (j.step === 'ready' && j.url) {
      const flag = 'twp-dev-opened-' + (j.pr ?? p!.short)
      let done = false
      try { done = !!sessionStorage.getItem(flag); sessionStorage.setItem(flag, '1') } catch { /* not remembered: opens once per load */ }
      if (live && !done && !opening) opening = setTimeout(() => { location.href = devUrl(j.url!, location) }, 3000)
    }
    render()
  }

  function watchPr(): void {
    pollStatus((j) => { applyStatus(j, true) })
  }

  /** "PR #8 · dev2" for the header line: the PR (registry, else the status) and, once the slot is ready, the dev link. */
  function links(): (Node | string)[] {
    const num = p!.pr?.number ?? prNum
    if (num === null) return []
    const pr = h('a', { href: p!.pr?.url ?? `https://github.com/Evobiosys/trustweb/pull/${num}`, target: '_blank', textContent: 'PR #' + num + (p!.pr && prMerged(p!) ? ' (merged)' : '') })
    return prStep === 'ready' && prUrl ? [pr, ' · ', h('a', { href: prUrl, target: '_blank', textContent: devLabel(prUrl) })] : [pr]
  }

  function staying(what = 'dev'): HTMLElement {
    const stay = h('a', { href: '#', textContent: 'stay' })
    stay.addEventListener('click', (e) => { e.preventDefault(); if (opening) clearTimeout(opening); opening = null; render() })
    return h('div', {}, `Opening ${what} in 3 s (`, stay, ')')
  }

  /** A merged PR: the way on to the preview that carries the unshipped boxes, else "shipped". */
  function mergedPart(): HTMLElement {
    if (p!.next) {
      const to = h('a', { href: `http://127.0.0.1:${p!.next.port}/`, textContent: `Continue in ${p!.next.id} (port ${p!.next.port})` })
      return h('div', { className: 'btns' }, to, ...(opening ? [staying(p!.next.id)] : []))
    }
    return h('div', { className: 'btns' }, h('small', { textContent: `PR #${p!.pr!.number} shipped` }))
  }

  /** Clipboard API, else a textarea + execCommand('copy'), else the text in a selectable <pre> (the poll re-renders the panel, so it sits beside it). */
  async function copy(text: string, done: string): Promise<void> {
    try { await navigator.clipboard.writeText(text); toast(done); return } catch { /* not allowed (gesture expired during the fetch): fall back */ }
    const ta = document.body.appendChild(h('textarea', { value: text }))
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    if (ok) { toast(done); return }
    const box = document.body.appendChild(h('div', { className: 'twp-pre' }, h('small', { textContent: 'Copy was refused: select all (tap the text) and copy by hand.' }), h('pre', { textContent: text }), h('button', { textContent: 'Close', onclick: () => { box.remove() } })))
  }

  /** Under "CI failed on PR #n": the trimmed failure log to the clipboard, and the session (id + path) it was worked on in. */
  function ciFailed(pr: number): HTMLElement {
    const diag = h('button', { textContent: 'Copy diagnostics' })
    diag.addEventListener('click', () => {
      void fetch('/__tw/ci/diagnostics?pr=' + pr).then(async (r) => {
        if (r.ok) return copy(await r.text(), 'diagnostics copied')
        const { error } = await r.json().catch(() => ({ error: '' })) as { error?: string }
        toast('diagnostics failed: ' + (error || 'HTTP ' + r.status))
      }).catch((e: unknown) => { toast('diagnostics failed: ' + String(e)) })
    })
    const open = h('button', { className: 'alt', textContent: 'Open the session' })
    open.addEventListener('click', () => {
      const s = p!.session
      if (s) { void copy(`${s.id}\n${s.path}`, 'session id and path copied'); return }
      void fetch('/__tw/ci/devlog').then((r) => r.text()).then((dir) => { window.open('file://' + dir); void copy(dir, 'DEVLOG folder copied') }, () => { toast('no DEVLOG folder') })
    })
    return h('div', { className: 'btns' }, diag, open)
  }

  // Runs the CLI's checks (no vite touched, the preview keeps showing) and polls until a run newer than this click is done.
  function runTests(): void {
    const click = Date.now()
    testing = true; begin(); render()
    void call('POST', '/test', {}).then(async () => {
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000))
        const q = await call('GET', '').catch(() => null)
        if (q?.tested && !q.tested.running && Date.parse(q.tested.at) >= click - 1000) { p = q; break }
      }
    }).catch((e: Error) => { error = e.message }).finally(() => { testing = false; render() })
  }

  /** The local checks of the assembled set: an optional pre-check: "Approve" runs them itself. */
  function gate(): HTMLElement {
    const g = prGate(p!), running = testing || g === 'running'
    const run = h('button', { className: 'alt', textContent: 'Run tests now (optional)', disabled: running || loading() })
    run.addEventListener('click', runTests)
    return h('div', { className: 'btns' }, h('div', {}, testLine(running ? 'running' : g, p!.tested), ...(running ? [' ', h('span', { className: 'clk', textContent: elapsed() + ' s' })] : [])), run, ...(g === 'failed' && p!.tested?.tail ? [h('pre', { className: 'log', textContent: p!.tested.tail })] : []))
  }

  /** The PR flow's line (after a reload that finds it running or failed) with the CI diagnostics; the press itself is "Approve and continue to dev.trustweb.one". */
  function prStatus(): HTMLElement | null {
    if (prMerged(p!)) return mergedPart()
    if (!prText) return null
    const eta = prEta && loading() ? h('small', { className: 'eta', textContent: ciLine(prEta, prStarted, Date.now()) }) : ''
    return h('div', { className: 'btns' }, h('div', {}, prText, ...(opening ? [staying()] : []), eta, ...(prStep === 'failed' && (prNum ?? p!.pr?.number) ? [ciFailed(prNum ?? p!.pr!.number)] : [])))
  }

  function copyId(id: string): void {
    void navigator.clipboard?.writeText(id).then(() => toast(`${id} copied`), () => toast('copy refused by the browser'))
  }
  // The panel re-renders between two quick clicks (the status poll), so the browser's dblclick never fires on the same node: two clicks within 400 ms on the id copy it.
  let idClickAt = 0
  function idClicked(id: string, moved: boolean): void {
    if (moved) return
    const now = Date.now()
    if (now - idClickAt < 400) { idClickAt = 0; copyId(id) } else idClickAt = now
  }

  /** All feature rows, section by section; the panel scrolls (max-height from the viewport) when there are more than fit. */
  const allRows = (secs: { sec: HTMLElement; rows: HTMLElement[] }[]): HTMLElement[] => secs.map((s) => h('div', { className: 'row' }, s.sec, ...s.rows))

  function render(): void {
    const q = p!
    related = new Set(lit ? relatedRows(q.features, lit) : [])
    root.hidden = tab.hidden()
    const pill = collapsed()
    root.className = 'twp' + (pill ? ' pill' : '')
    root.replaceChildren()
    if (pill) {
      const tag = root.appendChild(h('div', { className: 'tag', textContent: q.id, title: 'Expand · double-click copies the id' }))
      const state = drag(tag)
      tag.addEventListener('click', () => { if (!state.moved) setCollapsed(false) })
      tag.addEventListener('pointerdown', () => idClicked(q.id, state.moved))
    } else {
      const x = h('button', { className: 'x', textContent: '–', title: 'Collapse (Esc)' })
      const close = h('button', { className: 'x', textContent: '×', title: 'Hide for this tab' })
      close.addEventListener('click', () => { tab.hide(); render() })
      x.addEventListener('click', () => setCollapsed(true))
      const idEl = h('b', { textContent: q.id, title: 'Double-click copies the id' })
      const header = h('header', {}, idEl, ...(loading() ? [h('i', { className: 'spin' })] : []), h('span', {}, applying ? 'assembling...' : busy ? 'saving...' : loading() ? 'creating PR...' : links().length ? '' : mode + ' preview', ...(loading() ? [' ', h('span', { className: 'clk', textContent: elapsed() + ' s' })] : []), ...(loading() ? [] : links())), x, close)
      const hs = drag(root.appendChild(header))
      // pointerdown, not click: the header captures the pointer while dragging, so clicks land on the header, never on the id.
      idEl.addEventListener('pointerdown', () => idClicked(q.id, hs.moved))
      const shown = q.features
      const prStatusEl = prStatus()
      const bar = assemblyBar()
      const other = mode === 'personal' ? 'stock' : 'personal'
      const sw = h('button', { className: 'alt', textContent: `Open ${other} preview`, disabled: loading() })
      sw.addEventListener('click', () => {
        void act(null, () => call('POST', '/mode', { mode: other })).then(() => {
          if (!error) location.href = `http://127.0.0.1:${other === 'personal' ? q.port : q.stockPort}/${location.hash}`
        })
      })
      const all = h('button', { className: 'alt', textContent: allApproved(q.features) ? 'Select none' : 'Select all', disabled: loading() })
      all.addEventListener('click', () => { void pressAll() })
      root.append(
        h('div', { className: 'row' }, h('small', { textContent: `${q.branch} @ ${q.assembled?.sha.slice(0, 7) ?? '?'} · ${hhmm(q.created)} · base ${q.base}@${q.baseSha}` })),
        h('div', { className: 'btns' }, all),
        ...allRows(sections(tree(visible(shown))).map((s) => ({ sec: h('div', { className: 'sec', textContent: REPO_LABEL[s.repo] }), rows: s.nodes.map((n) => row(n, shown)) }))),
        ...(busy !== null && elapsed() > 90 ? [slow()] : []),
        ...(q.assembled?.error ? [h('div', { className: 'row warn' }, ...conflictNodes(q.assembled.error))] : []),
        ...(error ? [h('div', { className: 'row warn', textContent: error })] : []),
        gate(), ...(prStatusEl ? [prStatusEl] : []), h('div', { className: 'btns' }, sw), ...(bar ? [bar] : []),
      )
    }
    const pos = store.get(POS)
    if (pos) { const { x, y } = JSON.parse(pos) as { x: number; y: number }; place(x, y) }
    sync()
    renderedAt = Date.now()
    if (!pill) root.scrollTop = scrolled.get()
    if (!lit) steps.close()
    if (!steps.active()) pointer.set(lit ? q.features.find((f) => f.key === lit)?.selector : null)
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    if (lit) { lit = null; render() } else if (!collapsed()) setCollapsed(true)
  })
  render()
  let resizing: ReturnType<typeof setTimeout> | undefined
  window.addEventListener('resize', () => { clearTimeout(resizing); resizing = setTimeout(() => { if (p) render() }, 150) })
  // A reload while "Approve personal view" runs: show the spinner and text again.
  void fetch('/__tw/status').then((r) => r.json()).then((j: ApprovalStatus) => {
    if (prRunning(j.step)) { applyStatus(j, true); begin(); watchPr() } else if (j.step === 'ready' && j.url) applyStatus(j, false)
  }).catch(() => { /* no status: no flow to show */ })
  void call('GET', '').then((q) => {
    p = q
    fresh = true
    known = q.assembled?.sha ?? null
    render()
    if (autoApply(q, applying)) void apply()
    setInterval(() => { void watch() }, 2000)
  }).catch(() => { /* the file is gone: keep what the serve start saw */ })
}
