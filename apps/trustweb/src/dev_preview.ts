/**
 * Dev-only preview panel (wave7/preview-overlay). vite.config.mjs `define`s __TW_PREVIEW__ (the registry file <id>.json, see
 * previews-interface.txt) only for `vite serve` with TW_PREVIEW set; in every build it is null and nothing below runs.
 * Top-left, draggable by its header (twp-pos), collapsible to a pill with the id (twp-collapsed): the feature checkboxes of this
 * preview, the personal/stock switch and "Create PR". The FEATURE box (dev_feature.ts) sits below it via --twp-h.
 * A tap on a row points at the UI the feature adds (its `selector`); a tap on a checkbox asks first, then re-assembles and reloads.
 */
import { pollStatus } from './dev_feature'
import { createPointer } from './dev_pointer'
import { cascaded, confirmText, descendants, needsHint, tapped, toggled, tree, type PreviewFeature, type TreeNode } from './dev_preview_rules'

interface Preview {
  id: string; short: string; created: string; base: string; baseSha: string; branch: string
  port: number; stockPort: number; mode: 'personal' | 'stock'; features: PreviewFeature[]
  assembled: { sha: string; at: string; error: string | null; restart?: boolean } | null
  pr: { number: number; url: string } | null
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
.twp.pill{width:auto}.twp .tag{padding:5px 10px;cursor:grab;touch-action:none;user-select:none;font:700 13px ui-monospace,monospace;color:#4fd7a0}`

const POS = 'twp-pos', COLLAPSED = 'twp-collapsed'
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
  let ask: { key: string; checked: boolean } | null = null
  let error = ''
  let prText = ''
  let prUrl = ''
  const root = h('div')
  const mode = typeof __TW_BUILD__ === 'undefined' || !__TW_BUILD__ ? p.mode : (__TW_BUILD__.mode as Preview['mode'])
  document.head.appendChild(h('style', { textContent: CSS }))
  document.body.appendChild(root)
  const pointer = createPointer(() => root.getBoundingClientRect(), () => { lit = null; render() })

  const collapsed = (): boolean => store.get(COLLAPSED) === '1'
  const setCollapsed = (on: boolean): void => { store.set(COLLAPSED, on ? '1' : ''); render() }
  const loading = (): boolean => busy !== null || (prText !== '' && prStep !== 'ready' && prStep !== 'failed')
  const elapsed = (): number => Math.floor((Date.now() - since) / 1000)
  const begin = (): void => { since = Date.now() }
  setInterval(() => { const c = root.querySelector('.clk'); if (c) c.textContent = elapsed() + ' s'; if (busy !== null && elapsed() > 90 && !root.querySelector('.slow')) render() }, 1000)
  const sync = (): void => { document.documentElement.style.setProperty('--twp-h', root.offsetHeight + 'px') }

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
        place(e.clientX - dx, e.clientY - dy)
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
    if (lit && !pointer.set(f.selector)) { lit = null; toast('nothing to point at for this feature') }
    render()
  }

  // The toggle restarts vite (the worktree's vite.config.mjs changes), so the POST may die mid-flight: poll until the server answers
  // with an assembled.at newer than the POST start (the CLI writes assembled{} last), then reload; an assembled.error is shown instead.
  async function reassemble(a: { key: string; checked: boolean }): Promise<void> {
    const start = Math.floor(Date.now() / 1000) * 1000
    ask = null; busy = a.key; error = ''; begin(); render()
    try { await call('POST', '', { feature: a.key, checked: a.checked }) } catch (e) {
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
    box.addEventListener('change', () => { ask = { key: f.key, checked: box.checked }; render() })
    const closed = n.children.length > 0 && folded(p!.id).includes(f.key)
    const chev = h('button', { className: 'chev' + (n.children.length ? '' : ' leaf'), textContent: closed ? '▸' : '▾', title: closed ? 'Expand' : 'Collapse' })
    chev.addEventListener('click', (e) => { e.stopPropagation(); setFolded(p!.id, closed ? folded(p!.id).filter((k) => k !== f.key) : [...folded(p!.id), f.key]); render() })
    const label = h('div', { className: 'feat' + (off ? ' off' : '') + (lit === f.key ? ' lit' : '') }, chev, box, h('span', {}, f.title, ' ', h('small', {}, f.branch + (hint ? ' · ' + hint : '')), ...(closed ? [' ', h('small', { className: 'hid' }, `(${descendants(n)} hidden)`)] : [])), lit === f.key ? h('i') : '')
    label.addEventListener('click', (e) => { if (e.target !== box && e.target !== chev) tap(f) })
    return h('div', {}, label, ...(n.children.length && !closed ? [h('div', { className: 'kids' }, ...n.children.map((c) => row(c, shown, grey)))] : []))
  }

  function askBox(a: { key: string; checked: boolean }): HTMLElement {
    const go = h('button', { textContent: 'Reload' })
    go.addEventListener('click', () => { void reassemble(a) })
    const no = h('button', { className: 'alt', textContent: 'Cancel' })
    no.addEventListener('click', () => { ask = null; render() })
    return h('div', { className: 'ask' }, confirmText(p!.features.find((f) => f.key === a.key)!.title, a.checked), h('div', {}, go, no))
  }

  function slow(): HTMLElement {
    const re = h('button', { textContent: 'Reload' })
    re.addEventListener('click', () => { location.reload() })
    return h('div', { className: 'row warn slow' }, 'taking long: reload by hand ', re)
  }

  function prPart(n: number): HTMLElement {
    if (p!.pr) return h('div', { className: 'btns' }, h('a', { href: p!.pr.url, target: '_blank', textContent: 'PR #' + p!.pr.number }))
    const go = h('button', { textContent: `Create PR with ${n} checked`, disabled: loading() || n === 0 })
    go.addEventListener('click', () => {
      void call('POST', '/pr', {}).then(() => {
        prText = 'starting'; prStep = ''; begin(); render()
        pollStatus((j) => {
          prStep = j.step; prText = j.text ?? j.step; prUrl = j.url ?? ''
          if (j.step === 'ready') void call('GET', '').then((q) => { p = q; render() })
          render()
        })
      }).catch((e: Error) => { error = e.message; render() })
    })
    const status = prText ? h('div', {}, prText, ' ', prUrl ? h('a', { href: prUrl, target: '_blank', textContent: 'open' }) : '') : ''
    return h('div', { className: 'btns' }, go, status)
  }

  function render(): void {
    const q = p!
    const pill = collapsed()
    root.className = 'twp' + (pill ? ' pill' : '')
    root.replaceChildren()
    if (pill) {
      const tag = root.appendChild(h('div', { className: 'tag', textContent: q.id, title: 'Expand' }))
      const state = drag(tag)
      tag.addEventListener('click', () => { if (!state.moved) setCollapsed(false) })
    } else {
      const x = h('button', { className: 'x', textContent: '–', title: 'Collapse (Esc)' })
      x.addEventListener('click', () => setCollapsed(true))
      drag(root.appendChild(h('header', {}, h('b', { textContent: q.id }), ...(loading() ? [h('i', { className: 'spin' })] : []), h('span', {}, waiting ? 'server restarting...' : busy ? 'assembling...' : loading() ? 'creating PR...' : mode + ' preview', ...(loading() ? [' ', h('span', { className: 'clk', textContent: elapsed() + ' s' })] : [])), x)))
      const shown = ask ? toggled(q.features, ask.key, ask.checked) : q.features
      const grey = ask ? cascaded(q.features, ask.key, ask.checked) : []
      const n = q.features.filter((f) => f.checked).length
      const other = mode === 'personal' ? 'stock' : 'personal'
      const sw = h('button', { className: 'alt', textContent: `Open ${other} preview`, disabled: loading() })
      sw.addEventListener('click', () => {
        void act(null, () => call('POST', '/mode', { mode: other })).then(() => {
          if (!error) location.href = `http://127.0.0.1:${other === 'personal' ? q.port : q.stockPort}/${location.hash}`
        })
      })
      root.append(
        h('div', { className: 'row' }, h('small', { textContent: `${q.branch} @ ${q.assembled?.sha.slice(0, 7) ?? '?'} · ${hhmm(q.created)} · base ${q.base}@${q.baseSha}` })),
        h('div', { className: 'row' }, ...tree(shown).map((n) => row(n, shown, grey))),
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
    pointer.set(lit ? q.features.find((f) => f.key === lit)?.selector : null)
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    if (lit) { lit = null; render() } else if (!collapsed()) setCollapsed(true)
  })
  render()
  void call('GET', '').then((q) => { p = q; render() }).catch(() => { /* the file is gone: keep what the serve start saw */ })
}
