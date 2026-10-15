/**
 * Dev-only extra devices (wave9/second-device): up to six phone frames right of the real one, each an iframe of the stock twin
 * (no seed; ?dev=N gives every frame its own record, main.ts). Mounted by dev_preview.ts only; never in a build.
 */
export type Kind = 'new' | 'existing' | 'organizer'

export const KINDS: { kind: Kind; label: string; caption: string }[] = [
  { kind: 'new', label: 'Empty device (default)', caption: 'empty device' },
  { kind: 'existing', label: 'Existing user with dummy data', caption: 'existing user, dummy data' },
  { kind: 'organizer', label: 'Organizer page', caption: 'organizer page' },
]

const PATHS: Record<Kind, string> = { new: '/', existing: '/?persona=seeker&solo=1&ctx=generic', organizer: '/organizer.html' }
const MIN_WIDTH = 900
export const MAX_DEVICES = 6

export const originOf = (stockPort: number): string => `http://127.0.0.1:${stockPort}`

/** `url` on the twin's origin (path, search and hash kept) with ?dev=n, the frame's own storage. */
const onTwin = (url: URL, stockPort: number, n: number): string => {
  const out = new URL(originOf(stockPort) + url.pathname + url.search + url.hash)
  out.searchParams.set('dev', String(n))
  return out.href
}
export const deviceSrc = (kind: Kind, stockPort: number, n: number): string => onTwin(new URL(PATHS[kind], originOf(stockPort)), stockPort, n)

/** The pasted link on the twin's origin, or null when it is no URL. */
export function rewriteLink(pasted: string, stockPort: number, n: number): string | null {
  try { return onTwin(new URL(pasted.trim()), stockPort, n) } catch { return null }
}

/** The lowest free device number 1..6, or null with six open. */
export function nextDev(open: number[]): number | null {
  return Array.from({ length: MAX_DEVICES }, (_, i) => i + 1).find((n) => !open.includes(n)) ?? null
}

interface Saved { n: number; kind: Kind; link: string }
const parse = (raw: string | null): Saved[] => {
  try {
    const l = JSON.parse(raw ?? '[]') as Saved[]
    return Array.isArray(l) ? l.filter((s) => s.n >= 1 && s.n <= MAX_DEVICES && KINDS.some((k) => k.kind === s.kind) && typeof s.link === 'string') : []
  } catch { return [] }
}

/** Mounts the pill into the page dock (personal preview only); each tap on it adds a device frame. */
export function createDevice2(id: string, stockPort: number, mode: 'personal' | 'stock', toast: (text: string) => void): void {
  const key = 'twp-dev2-' + id
  const row = document.createElement('div')
  row.className = 'twp-d2-row'
  row.hidden = true
  document.body.appendChild(row)
  const devices: Saved[] = []
  const label = Object.assign(document.createElement('span'), { textContent: 'Add a device' })
  const chevron = Object.assign(document.createElement('button'), { textContent: '▾', title: 'Choose the kind of device', type: 'button' })
  const menu = document.createElement('div')
  menu.className = 'twp-d2-menu'
  menu.hidden = true
  const main = Object.assign(document.createElement('button'), { type: 'button' })

  const place = (): void => {
    const r = document.querySelector('.phone')?.getBoundingClientRect()
    if (r) { row.style.left = r.right + 24 + 'px'; row.style.top = r.top + 'px'; row.style.maxWidth = `calc(100vw - ${r.right + 32}px)` }
  }
  const save = (): void => { try { sessionStorage.setItem(key, JSON.stringify(devices)) } catch { /* not remembered */ } }
  const sync = (): void => {
    const full = devices.length >= MAX_DEVICES
    main.disabled = full
    main.title = full ? `${MAX_DEVICES} devices open` : `Add a device (up to ${MAX_DEVICES})`
    chevron.hidden = full
    row.hidden = devices.length === 0
    save()
  }

  function frame(d: Saved): void {
    const field = Object.assign(document.createElement('input'), { placeholder: 'Open a link in this device' })
    const go = Object.assign(document.createElement('button'), { textContent: 'Open' })
    const x = Object.assign(document.createElement('button'), { textContent: '×', title: 'Close this device' })
    const bar = document.createElement('div')
    bar.className = 'bar'
    bar.append(field, go, x)
    const cap = Object.assign(document.createElement('div'), { className: 'cap', textContent: `device ${d.n}: ${KINDS.find((e) => e.kind === d.kind)!.caption}` })
    const box = document.createElement('div')
    box.className = 'twp-d2'
    // A fresh iframe each time: a hash-only change would not reload the app, which reads its link once at boot.
    const load = (link: string): void => {
      d.link = link
      box.querySelector('iframe')?.remove()
      cap.before(Object.assign(document.createElement('iframe'), { src: link, title: 'Device ' + d.n, allow: 'microphone' }))
      save()
    }
    const open = (): void => {
      const next = rewriteLink(field.value, stockPort, d.n)
      if (next) load(next); else toast('not a link')
    }
    go.addEventListener('click', open)
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') open() })
    x.addEventListener('click', () => { devices.splice(devices.indexOf(d), 1); box.remove(); sync() })
    box.append(bar, cap)
    row.append(box)
    load(d.link)
  }

  function add(kind: Kind): void {
    menu.hidden = true
    const n = nextDev(devices.map((d) => d.n))
    if (n === null) return
    if (innerWidth < MIN_WIDTH) { toast('needs a wider window'); return }
    const d = { n, kind, link: deviceSrc(kind, stockPort, n) }
    devices.push(d)
    frame(d)
    sync()
  }

  window.addEventListener('resize', place)
  place()
  if (innerWidth >= MIN_WIDTH) for (const d of parse(sessionStorage.getItem(key))) { devices.push(d); frame(d) }
  sync()

  main.append(Object.assign(document.createElement('span'), { className: 'add-device-plus', textContent: '+' }), label)
  main.addEventListener('click', () => { add('new') })
  chevron.addEventListener('click', () => { menu.hidden = !menu.hidden })
  menu.append(...KINDS.map((k) => { const b = Object.assign(document.createElement('button'), { textContent: k.label, type: 'button' }); b.addEventListener('click', () => { add(k.kind) }); return b }))
  const pill = document.createElement('div')
  pill.className = 'twp-d2-pill add-device'
  pill.append(menu, main, chevron)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.hidden = true })
  document.addEventListener('pointerdown', (e) => { if (!pill.contains(e.target as Node)) menu.hidden = true })
  if (mode === 'personal') document.querySelector('.page-dock')?.prepend(pill)
}

export const DEVICE2_CSS = `
.twp-d2-row{position:fixed;z-index:99990;display:flex;gap:24px;overflow-x:auto;padding:0 12px 4px 0}.twp-d2-row[hidden]{display:none}
.twp-d2{flex:none;width:390px;font:11px system-ui,sans-serif;color:#fff}
.twp-d2 .bar{display:flex;gap:4px;padding:4px;border-radius:8px 8px 0 0;background:#241b2e}.twp-d2 .bar input{flex:1;min-width:0;font:11px system-ui}
.twp-d2 button{font:600 11px system-ui;border:0;border-radius:6px;padding:4px 8px;background:#4fd7a0;color:#241b2e;cursor:pointer}
.twp-d2 iframe{display:block;width:390px;height:780px;border:0;border-radius:46px;background:#F2EBDC;box-shadow:0 0 0 10px #101a19,0 0 0 12px #2f4543;margin:12px 0}
.twp-d2 .cap{padding:2px 8px;border-radius:8px;background:#241b2e;color:#4fd7a0;width:max-content}
.page-dock:has(.twp-d2-pill){z-index:99995}.page-dock:has(.twp-d2-pill) a.add-device{display:none}.twp-d2-pill{position:relative;padding:0}.twp-d2-pill>button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
.twp-d2-pill>button:first-of-type{display:flex;align-items:center;gap:10px;padding:9px 6px 9px 9px;border-radius:999px 0 0 999px}.twp-d2-pill>button:last-of-type{padding:9px 16px 9px 6px;border-radius:0 999px 999px 0}
.twp-d2-menu{position:absolute;right:0;min-width:100%;width:max-content;bottom:100%;display:flex;flex-direction:column;background:var(--card);border-radius:18px 18px 0 0;box-shadow:0 -8px 24px rgba(36,27,46,.25);overflow:hidden}
.twp-d2-menu[hidden]{display:none}.twp-d2-menu button{font:600 13px system-ui;color:inherit;background:none;border:0;padding:10px 16px;text-align:left;cursor:pointer;white-space:nowrap}.twp-d2-menu button:hover{background:rgba(36,27,46,.08)}`
