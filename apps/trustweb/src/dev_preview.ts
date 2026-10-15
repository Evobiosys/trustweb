/**
 * Dev-only preview panel (wave7/preview-overlay). vite.config.mjs `define`s __TW_PREVIEW__ (the registry file <id>.json, see
 * previews-interface.txt) only for `vite serve` with TW_PREVIEW set; in every build it is null and nothing below runs.
 * Top-left, draggable by its header (twp-pos), collapsible to a pill with the id (twp-collapsed): the feature checkboxes of this
 * preview, the personal/stock switch and "Create PR". The FEATURE box (dev_feature.ts) sits below it via --twp-h.
 * A tap on a row points at the UI the feature adds (its `selector`); a tap on a checkbox asks first, then re-assembles and reloads.
 */
import { pollStatus, type ApprovalStatus } from './dev_feature'
import { createPointer } from './dev_pointer'
import { createSteps } from './dev_steps'
import { cascaded, ciLine, collapseStore, confirmText, descendants, devLabel, devUrl, needsHint, prButton, prNeedsUpdate, prRunning, rowPlan, setMap, stepText, tapped, toggled, tree, visible, type PreviewFeature, type TreeNode } from './dev_preview_rules'

interface Preview {
  id: string; short: string; created: string; base: string; baseSha: string; branch: string
  port: number; stockPort: number; mode: 'personal' | 'stock'; features: PreviewFeature[]
  assembled: { sha: string; at: string; error: string | null; restart?: boolean } | null
  pr: { number: number; url: string; branch?: string; at?: string; sha?: string } | null
}
declare const __TW_PREVIEW__: Preview | null | undefined
declare const __TW_BUILD__: { mode: string } | null | undefined

const CSS = `
.twp{position:fixed;left:8px;top:8px;z-index:100000;width:300px;max-width:calc(100vw - 16px);max-height:calc(100vh - 110px);overflow:auto;border-radius:10px;background:#241b2e;color:#fff;font:11px/1.35 system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.4)}
.twp header{display:flex;align-items:baseline;gap:6px;padding:6px 10px;cursor:grab;touch-action:none;user-select:none}
.twp header b{font:700 15px ui-monospace,monospace;color:#4fd7a0}.twp header span{flex:1;opacity:.8}
.twp .row{padding:0 10px 4px}.twp small{opacity:.7}.twp .warn{color:#ff715b;font-weight:600}
.twp .feat{display:flex;gap:6px;align-items:baseline;padding:2px 0;cursor:pointer}.twp .feat.off{opacity:.55}.twp .lit i{width:7px;height:7px;border-radius:50%;background:#ff715b;flex:none}
.twp .kids{margin-left:5px;padding-left:9px;border-left:1px solid #7a6a8c}.twp .kids>div>.feat::before{content:'';width:6px;border-top:1px solid #7a6a8c;margin-left:-9px;align-self:center;flex:none}
.twp .chev{flex:none;width:12px;padding:0;background:none;color:#b7a8c9;font-size:10px;line-height:1;cursor:pointer}.twp .chev.leaf{visibility:hidden}.twp .hid{opacity:.6;font-style:italic}
.twp .spin{width:9px;height:9px;border:2px solid #4fd7a0;border-right-color:transparent;border-radius:50%;animation:twp-spin .8s linear infinite;align-self:center;flex:none}@keyframes twp-spin{to{transform:rotate(360deg)}}
.twp .ask{margin:4px 10px;padding:6px 8px;border-radius:8px;background:#3a2c48;display:grid;gap:5px}.twp .ask div{display:flex;gap:6px}
.twp-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100001;padding:6px 12px;border-radius:8px;background:#241b2e;color:#fff;font:12px system-ui}
.twp button{font:600 11px system-ui;border:0;border-radius:6px;padding:5px 8px;background:#4fd7a0;color:#241b2e;cursor:pointer}
.twp button.alt{background:none;color:#4fd7a0;border:1px solid #4fd7a0}.twp .x{background:none;color:#fff;font-size:14px;padding:0 4px}
.twp .btns{display:grid;gap:5px;padding:4px 10px 8px}.twp a{color:#4fd7a0}
.twp .where{display:block;color:#9a9aa6;font-size:10px}
.see-action{display:none!important}
.twp.pill{width:auto}.twp .tag{padding:5px 10px;cursor:grab;touch-action:none;user-select:none;font:700 13px ui-monospace,monospace;color:#4fd7a0}`

const POS = 'twp-pos'
const THEN_PR = 'twp-then-pr'
const folded = (id: string): string[] => { try { return JSON.parse(sessionStorage.getItem('twp-tree-' + id) ?? '[]') as string[] } catch { return [] } }
const setFolded = (id: string, keys: string[]): void => { try { sessionStorage.setItem('twp-tree-' + id, JSON.stringify(keys)) } catch { /* not remembered */ } }
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
  let p = typeof __TW_PREVIEW__ === 'undefined' ? null : __TW_PREVIEW__
  if (!p) return
  let busy: string | null = null
  let waiting = false
  let since = 0
  let prStep = ''
  let lit: string | null = null
  // The boxes as the user set them while the confirm is open: `last` is the box ticked most recently, `grey` what its cascade flipped.
  let ask: { draft: PreviewFeature[]; last: string; grey: string[] } | null = null
  let error = ''
  let prText = ''
  let prUrl = ''
  let prNum: number | null = null
  let prEta = 0
  let prStarted = ''
  let opening: ReturnType<typeof setTimeout> | null = null
  let pointing = false
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
  }

  const toast = (text: string): void => {
    const t = document.body.appendChild(h('div', { className: 'twp-toast', textContent: text }))
    setTimeout(() => { t.remove() }, 2500)
  }

  function tap(f: PreviewFeature): void {
    lit = tapped(lit, f.key)
    steps.close()
    // The ring shows when the selector matches; else the steps overlay walks to it, the last step being the feature itself.
    if (lit) {
      const plan = rowPlan(pointer.set(f.selector), f.steps)
      if (plan === 'none') { lit = null; toast('nothing to point at for this feature') }
      else if (plan === 'steps') steps.open([...f.steps!, f.selector ? `${f.title} @ ${f.selector}` : f.title])
    }
    render()
  }

  // The toggle restarts vite (the worktree's vite.config.mjs changes), so the POST may die mid-flight: poll until the server answers
  // with an assembled.at newer than the POST start (the CLI writes assembled{} last), then reload; an assembled.error is shown instead.
  async function reassemble(draft: PreviewFeature[], key: string): Promise<void> {
    const start = Math.floor(Date.now() / 1000) * 1000
    ask = null; busy = key; error = ''; begin(); render()
    try { await call('POST', '', { set: setMap(draft) }) } catch (e) {
      if (e instanceof ApiError) { error = e.message; busy = null; render(); return }
      waiting = true; render()
    }
    for (;;) {
      const q = await call('GET', '').catch(() => null)
      if (q?.assembled && Date.parse(q.assembled.at) > start) {
        // Never reload into a dead server: the waiting page polls until a server that started after the POST (none when no restart is coming) answers.
        if (!q.assembled.error) { location.href = `/__tw/wait?to=${encodeURIComponent(location.pathname + location.search + location.hash)}&since=${q.assembled.restart === false ? 0 : start}`; return }
        p = q; busy = null; waiting = false; render(); return
      }
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  function row(n: TreeNode, shown: PreviewFeature[], grey: string[]): HTMLElement {
    const f = n.feature, d = shown.find((x) => x.key === f.key)!
    const hint = needsHint(shown, f.key)
    const off = loading() || hint !== null || grey.includes(f.key)
    const box = h('input', { type: 'checkbox', checked: d.checked, disabled: off })
    box.addEventListener('change', () => {
      const from = ask?.draft ?? p!.features
      ask = { draft: toggled(from, f.key, box.checked), last: f.key, grey: cascaded(from, f.key, box.checked) }
      render()
    })
    const closed = n.children.length > 0 && folded(p!.id).includes(f.key)
    const chev = h('button', { className: 'chev' + (n.children.length ? '' : ' leaf'), textContent: closed ? '▸' : '▾', title: closed ? 'Expand' : 'Collapse' })
    chev.addEventListener('click', (e) => { e.stopPropagation(); setFolded(p!.id, closed ? folded(p!.id).filter((k) => k !== f.key) : [...folded(p!.id), f.key]); render() })
    const label = h('div', { className: 'feat' + (off ? ' off' : '') + (lit === f.key ? ' lit' : '') }, chev, box, h('span', {}, f.title, ' ', h('small', {}, f.branch + (hint ? ' · ' + hint : '')), ...(closed ? [' ', h('small', { className: 'hid' }, `(${descendants(n)} hidden)`)] : []), ...(f.where ? [h('small', { className: 'where', textContent: f.where })] : [])), lit === f.key && pointing ? h('i') : '')
    label.addEventListener('click', (e) => { if (e.target !== box && e.target !== chev) tap(f) })
    return h('div', {}, label, ...(n.children.length && !closed ? [h('div', { className: 'kids' }, ...n.children.map((c) => row(c, shown, grey)))] : []))
  }

  function askBox(a: NonNullable<typeof ask>): HTMLElement {
    const go = h('button', { textContent: 'Reload' })
    go.addEventListener('click', () => { void reassemble(a.draft, a.last) })
    const no = h('button', { className: 'alt', textContent: 'Cancel' })
    no.addEventListener('click', () => { ask = null; render() })
    const then = p!.pr ? h('button', { textContent: `Reload, then update PR #${p!.pr.number}` }) : null
    then?.addEventListener('click', () => { try { sessionStorage.setItem(THEN_PR, p!.id) } catch { /* not remembered: update by hand */ } void reassemble(a.draft, a.last) })
    return h('div', { className: 'ask' }, confirmText(p!.features.find((f) => f.key === a.last)!.title, a.draft.find((f) => f.key === a.last)!.checked, a.draft.filter((f, i) => f.checked !== p!.features[i].checked).length, p!.pr?.number), h('div', {}, go, ...(then ? [then] : []), no))
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
    const pr = h('a', { href: p!.pr?.url ?? `https://github.com/Evobiosys/trustweb/pull/${num}`, target: '_blank', textContent: 'PR #' + num })
    return prStep === 'ready' && prUrl ? [pr, ' · ', h('a', { href: prUrl, target: '_blank', textContent: devLabel(prUrl) })] : [pr]
  }

  function staying(): HTMLElement {
    const stay = h('a', { href: '#', textContent: 'stay' })
    stay.addEventListener('click', (e) => { e.preventDefault(); if (opening) clearTimeout(opening); opening = null; render() })
    return h('div', {}, 'Opening dev in 3 s (', stay, ')')
  }

  function pushPr(): void {
    void call('POST', '/pr', {}).then(() => {
      prText = stepText('none', undefined, p!.short); prStep = ''; begin(); render()
      watchPr()
    }).catch((e: Error) => { error = e.message; render() })
  }

  function prPart(n: number): HTMLElement {
    const label = prButton(p!.pr, n, p!.assembled?.sha)
    const stay = opening ? [staying()] : []
    if (p!.pr && !label && !prText) return h('div', { className: 'btns' }, h('small', { textContent: `PR #${p!.pr.number} holds this set` }), ...stay)
    const go = h('button', { textContent: label || `Update PR #${p!.pr!.number} with ${n} checked`, disabled: loading() || n === 0 })
    go.addEventListener('click', pushPr)
    const eta = prEta && loading() ? h('small', { className: 'eta', textContent: ciLine(prEta, prStarted, Date.now()) }) : ''
    const status = prText ? h('div', {}, prText, ...stay, eta) : ''
    return h('div', { className: 'btns' }, ...(p!.pr && !label ? [] : [go]), status)
  }

  function render(): void {
    const q = p!
    root.hidden = tab.hidden()
    const pill = collapsed()
    root.className = 'twp' + (pill ? ' pill' : '')
    root.replaceChildren()
    if (pill) {
      const tag = root.appendChild(h('div', { className: 'tag', textContent: q.id, title: 'Expand' }))
      const state = drag(tag)
      tag.addEventListener('click', () => { if (!state.moved) setCollapsed(false) })
    } else {
      const x = h('button', { className: 'x', textContent: '–', title: 'Collapse (Esc)' })
      const close = h('button', { className: 'x', textContent: '×', title: 'Hide for this tab' })
      close.addEventListener('click', () => { tab.hide(); render() })
      x.addEventListener('click', () => setCollapsed(true))
      drag(root.appendChild(h('header', {}, h('b', { textContent: q.id }), ...(loading() ? [h('i', { className: 'spin' })] : []), h('span', {}, waiting ? 'server restarting...' : busy ? 'assembling...' : loading() ? 'creating PR...' : links().length ? '' : mode + ' preview', ...(loading() ? [' ', h('span', { className: 'clk', textContent: elapsed() + ' s' })] : []), ...(loading() ? [] : links())), x, close)))
      const shown = ask?.draft ?? q.features
      const grey = ask?.grey ?? []
      const n = visible(q.features).filter((f) => f.checked).length
      const other = mode === 'personal' ? 'stock' : 'personal'
      const sw = h('button', { className: 'alt', textContent: `Open ${other} preview`, disabled: loading() })
      sw.addEventListener('click', () => {
        void act(null, () => call('POST', '/mode', { mode: other })).then(() => {
          if (!error) location.href = `http://127.0.0.1:${other === 'personal' ? q.port : q.stockPort}/${location.hash}`
        })
      })
      root.append(
        h('div', { className: 'row' }, h('small', { textContent: `${q.branch} @ ${q.assembled?.sha.slice(0, 7) ?? '?'} · ${hhmm(q.created)} · base ${q.base}@${q.baseSha}` })),
        h('div', { className: 'row' }, ...tree(visible(shown)).map((n) => row(n, shown, grey))),
        ...(ask ? [askBox(ask)] : []),
        ...(busy !== null && elapsed() > 90 ? [slow()] : []),
        ...(q.assembled?.error ? [h('div', { className: 'row warn', textContent: q.assembled.error })] : []),
        ...(error ? [h('div', { className: 'row warn', textContent: error })] : []),
        prPart(n), h('div', { className: 'btns' }, sw),
      )
    }
    const pos = store.get(POS)
    if (pos) { const { x, y } = JSON.parse(pos) as { x: number; y: number }; place(x, y) }
    sync()
    if (!lit) steps.close()
    if (!steps.active()) pointer.set(lit ? q.features.find((f) => f.key === lit)?.selector : null)
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    if (lit) { lit = null; render() } else if (!collapsed()) setCollapsed(true)
  })
  render()
  // A reload while "Create PR" runs: show the spinner and text again.
  void fetch('/__tw/status').then((r) => r.json()).then((j: ApprovalStatus) => {
    if (prRunning(j.step)) { applyStatus(j, true); begin(); watchPr() } else if (j.step === 'ready' && j.url) applyStatus(j, false)
  }).catch(() => { /* no status: no flow to show */ })
  void call('GET', '').then((q) => {
    p = q
    let then = false
    try { then = sessionStorage.getItem(THEN_PR) === q.id; if (then) sessionStorage.removeItem(THEN_PR) } catch { /* not remembered */ }
    if (then && !q.assembled?.error && prNeedsUpdate(q.pr, q.assembled?.sha)) pushPr()
    render()
  }).catch(() => { /* the file is gone: keep what the serve start saw */ })
}
