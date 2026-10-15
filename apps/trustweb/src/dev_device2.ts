/**
 * Dev-only second device (wave9/second-device): a second phone frame right of the real one, an iframe of the stock twin
 * (no seed, so its storage never mixes with the owner's record). Mounted by dev_preview.ts only; never in a build.
 */
export type Kind = 'new' | 'existing' | 'organizer'

export const KINDS: { kind: Kind; label: string; caption: string }[] = [
  { kind: 'new', label: 'Empty device (default)', caption: 'empty device' },
  { kind: 'existing', label: 'Existing user with dummy data', caption: 'existing user, dummy data' },
  { kind: 'organizer', label: 'Organizer page', caption: 'organizer page' },
]

const PATHS: Record<Kind, string> = { new: '/', existing: '/?persona=seeker&solo=1&ctx=generic', organizer: '/organizer.html' }
const MIN_WIDTH = 900

export const originOf = (stockPort: number): string => `http://127.0.0.1:${stockPort}`
export const deviceSrc = (kind: Kind, stockPort: number): string => originOf(stockPort) + PATHS[kind]

/** The pasted link on the second device's origin (path, search and hash kept), or null when it is no URL. */
export function rewriteLink(pasted: string, stockPort: number): string | null {
  try {
    const u = new URL(pasted.trim())
    return originOf(stockPort) + u.pathname + u.search + u.hash
  } catch { return null }
}

type Saved = { kind: Kind; src: string }
const parse = (raw: string | null): Saved | null => {
  try {
    const s = JSON.parse(raw ?? 'null') as Saved | null
    return s && KINDS.some((k) => k.kind === s.kind) && typeof s.src === 'string' ? s : null
  } catch { return null }
}

/** Mounts the pill into the page dock (personal preview only) and returns nothing: the pill is the whole interface. */
export function createDevice2(id: string, stockPort: number, mode: 'personal' | 'stock', toast: (text: string) => void): void {
  const key = 'twp-dev2-' + id
  const box = document.createElement('div')
  box.className = 'twp-d2'
  box.hidden = true
  document.body.appendChild(box)
  let kind: Kind = 'new'
  const label = Object.assign(document.createElement('span'), { textContent: 'Second device' })
  const chevron = Object.assign(document.createElement('button'), { textContent: '▾', title: 'Choose the kind of device', type: 'button' })
  const menu = document.createElement('div')
  menu.className = 'twp-d2-menu'
  menu.hidden = true
  let src = ''

  const place = (): void => {
    const r = document.querySelector('.phone')?.getBoundingClientRect()
    if (r) { box.style.left = r.right + 24 + 'px'; box.style.top = r.top + 'px' }
  }
  const save = (): void => { try { sessionStorage.setItem(key, JSON.stringify({ kind, src })) } catch { /* not remembered */ } }
  const close = (): void => { box.hidden = true; box.replaceChildren(); label.textContent = 'Second device'; chevron.hidden = false; try { sessionStorage.removeItem(key) } catch { /* nothing kept */ } }

  // A fresh iframe each time: a hash-only change would not reload the app, which reads its link once at boot.
  function load(next: string): void {
    src = next
    const frame = Object.assign(document.createElement('iframe'), { src, title: 'Second device', allow: 'microphone' })
    box.querySelector('iframe')?.remove()
    box.querySelector('.cap')!.before(frame)
    save()
  }

  function show(k: Kind, to: string): void {
    kind = k
    label.textContent = 'Second device: ' + KINDS.find((e) => e.kind === k)!.caption
    chevron.hidden = true
    menu.hidden = true
    const field = Object.assign(document.createElement('input'), { placeholder: 'Open a link in this device' })
    const go = Object.assign(document.createElement('button'), { textContent: 'Open' })
    const x = Object.assign(document.createElement('button'), { textContent: '×', title: 'Close the second device' })
    const open = (): void => {
      const next = rewriteLink(field.value, stockPort)
      if (next) load(next); else toast('not a link')
    }
    go.addEventListener('click', open)
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') open() })
    x.addEventListener('click', close)
    const bar = document.createElement('div')
    bar.className = 'bar'
    bar.append(field, go, x)
    const cap = Object.assign(document.createElement('div'), { className: 'cap', textContent: 'second device: ' + KINDS.find((e) => e.kind === k)!.caption })
    box.replaceChildren(bar, cap)
    box.hidden = false
    place()
    load(to)
  }

  window.addEventListener('resize', place)
  const saved = parse(sessionStorage.getItem(key))
  if (saved && innerWidth >= MIN_WIDTH) show(saved.kind, saved.src)

  const choose = (k: Kind): void => {
    menu.hidden = true
    if (innerWidth < MIN_WIDTH) toast('needs a wider window'); else show(k, deviceSrc(k, stockPort))
  }
  const main = Object.assign(document.createElement('button'), { type: 'button' })
  main.append(Object.assign(document.createElement('span'), { className: 'add-device-plus', textContent: '+' }), label)
  main.addEventListener('click', () => { if (box.hidden) choose('new'); else close() })
  chevron.addEventListener('click', () => { menu.hidden = !menu.hidden })
  menu.append(...KINDS.map((k) => { const b = Object.assign(document.createElement('button'), { textContent: k.label, type: 'button' }); b.addEventListener('click', () => { choose(k.kind) }); return b }))
  const pill = document.createElement('div')
  pill.className = 'twp-d2-pill add-device'
  pill.append(menu, main, chevron)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.hidden = true })
  document.addEventListener('pointerdown', (e) => { if (!pill.contains(e.target as Node)) menu.hidden = true })
  if (mode === 'personal') document.querySelector('.page-dock')?.prepend(pill)
}

export const DEVICE2_CSS = `
.twp-d2{position:fixed;z-index:99990;width:390px;font:11px system-ui,sans-serif;color:#fff}
.twp-d2 .bar{display:flex;gap:4px;padding:4px;border-radius:8px 8px 0 0;background:#241b2e}.twp-d2 .bar input{flex:1;min-width:0;font:11px system-ui}
.twp-d2 button{font:600 11px system-ui;border:0;border-radius:6px;padding:4px 8px;background:#4fd7a0;color:#241b2e;cursor:pointer}
.twp-d2 iframe{display:block;width:390px;height:780px;border:0;border-radius:46px;background:#F2EBDC;box-shadow:0 0 0 10px #101a19,0 0 0 12px #2f4543;margin:12px 0}
.twp-d2 .cap{padding:2px 8px;border-radius:8px;background:#241b2e;color:#4fd7a0;width:max-content}

.page-dock:has(.twp-d2-pill){z-index:99995}.twp-d2-pill{position:relative;padding:0}.twp-d2-pill>button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
.twp-d2-pill>button:first-of-type{display:flex;align-items:center;gap:10px;padding:9px 6px 9px 9px;border-radius:999px 0 0 999px}.twp-d2-pill>button:last-of-type{padding:9px 16px 9px 6px;border-radius:0 999px 999px 0}
.twp-d2-menu{position:absolute;right:0;min-width:100%;width:max-content;bottom:100%;display:flex;flex-direction:column;background:var(--card);border-radius:18px 18px 0 0;box-shadow:0 -8px 24px rgba(36,27,46,.25);overflow:hidden}
.twp-d2-menu[hidden]{display:none}.twp-d2-menu button{font:600 13px system-ui;color:inherit;background:none;border:0;padding:10px 16px;text-align:left;cursor:pointer;white-space:nowrap}.twp-d2-menu button:hover{background:rgba(36,27,46,.08)}`
