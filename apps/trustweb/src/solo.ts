/**
 * The side-by-side page (app.idea2.site/trustweb/demo/ and its two context
 * twins): real TrustWeb phones on one laptop, talking over the live relay.
 *
 * Owner, 2026-10-05: start with ONE device. Bottom right, "Add a device"
 * (press it again for more, up to four) above "See it in action", which opens
 * the scripted walkthrough (walkthrough.ts) together with the steps to try on
 * the live phones.
 *
 * Two browser tabs would share one storage identity, so each phone is an
 * iframe running the real app under its own persona (?persona=holder,
 * seeker, third, fourth), which store.ts keeps in separate records with
 * separate relay identities. Maya's phone (the holder) posts its real connect
 * link up to this page; every added phone is opened on that link, exactly as
 * a camera would open a scanned code, so pairing, asks and consent all go
 * over the live relay.
 */
import { DemoContext, PERSONA_NAMES, Persona } from './seed'
import { storageKey } from './store'
import { mountWalkthrough } from './walkthrough'
import { demoInstallBar } from './demo_install_button'
import { RemoveVerdict, nextDevice, parseDevices, removeVerdict, serializeDevices, withoutDevice } from './demo_devices'
import { S } from './strings'

/**
 * One script for four HTML entries (solo.html at the app root, plus demo/,
 * emergent-demo/ and ea-demo/, see vite.config.mjs): the context comes from
 * this page's own path and is forwarded as `ctx` to every phone.
 */
function detectContext(): DemoContext {
  const path = location.pathname
  if (path.includes('/emergent-demo')) return DemoContext.Emergent
  if (path.includes('/ea-demo')) return DemoContext.Ea
  return DemoContext.Generic
}
const ctx = detectContext()

const BASE = import.meta.env.BASE_URL
const root = document.getElementById('solo') as HTMLElement
/** Maya first; each "Add a device" opens the next one, up to four phones (roadmap: five). */
const ORDER: readonly Persona[] = [Persona.Holder, Persona.Seeker, Persona.Third, Persona.Fourth]

const style = document.createElement('style')
style.textContent = `
:root{--bg:#F4EFF7;--ink:#241B2E;--soft:#6b5d7a;--violet:#9A37F0;--card:#fff}
@media (prefers-color-scheme: dark){:root{--bg:#120C1A;--ink:#EDE6F2;--soft:#BBAACD;--card:#2B2139}}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--ink);font-family:"Seravek","Avenir Next","Segoe UI",system-ui,sans-serif;padding:24px 16px 120px}
.head{max-width:900px;margin:0 auto 18px;text-align:center}
.head h1{font-family:Optima,Candara,"Gill Sans",sans-serif;font-weight:600;font-size:clamp(22px,4vw,30px)}
.head p{color:var(--soft);font-size:14px;margin-top:6px;line-height:1.55}
.action-slot{max-width:1100px;margin:0 auto 24px}
.action-slot[hidden]{display:none}
.live-steps{max-width:1100px;margin:0 auto 22px}
.live-steps h2{font-size:15px;margin:0 0 8px}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
.steps div{background:var(--card);border-radius:14px;padding:12px 14px;font-size:13.5px;line-height:1.5}
.steps b{color:var(--violet)}
.phones{display:flex;gap:28px;justify-content:center;flex-wrap:wrap}
.col{display:flex;flex-direction:column;align-items:center;gap:10px}
.col h2{font-size:14px;font-weight:600}
.col h2 span{color:var(--soft);font-weight:400}
iframe{width:390px;max-width:calc(100vw - 32px);height:780px;border:0;border-radius:40px;background:#F2EBDC;
  box-shadow:0 24px 80px rgba(36,27,46,.35),0 0 0 10px #17111e,0 0 0 12px #3a2f47}
.wait{width:390px;max-width:calc(100vw - 32px);height:780px;border-radius:40px;display:grid;place-items:center;color:var(--soft);background:var(--card);font-size:14px;text-align:center;padding:30px}
.restart{position:fixed;left:20px;bottom:20px;z-index:10;display:flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:10px 16px 10px 12px;
  font:inherit;font-weight:700;font-size:13.5px;cursor:pointer;background:var(--card);color:var(--ink);box-shadow:0 8px 24px rgba(36,27,46,.25)}
.restart svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.restart:focus-visible{outline:3px solid #12A8E3;outline-offset:3px}
@media (max-width:600px){.restart{position:static;margin:14px auto 0}}
.dock{position:fixed;right:20px;bottom:20px;display:flex;flex-direction:column;align-items:flex-end;gap:10px;z-index:10}
.dock button{font:inherit;font-weight:700;font-size:14.5px;border:0;border-radius:999px;padding:12px 20px;cursor:pointer;display:flex;align-items:center;gap:8px}
.dock .add{background:var(--card);color:var(--ink);box-shadow:0 8px 24px rgba(36,27,46,.25)}
.dock .add[disabled]{opacity:.55;cursor:default}
.dock .see{background:linear-gradient(135deg,#FF715B,#9A37F0);color:#fff;box-shadow:0 8px 24px rgba(154,55,240,.35)}
.dock .plus{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#FF715B,#9A37F0);color:#fff;font-size:17px;font-weight:400}
.dock button:focus-visible{outline:3px solid #12A8E3;outline-offset:3px}
/* the switch sits in the top bar next to Install, which stays in view while scrolling */
.demo-topbar{position:sticky;top:8px;z-index:20;gap:8px}
.switch{font:inherit;font-weight:700;font-size:14px;height:38px;border:0;border-radius:999px;padding:0 16px;cursor:pointer;
  background:var(--ink);color:var(--bg);box-shadow:0 8px 24px rgba(36,27,46,.25)}
.switch[hidden]{display:none}
.switch:focus-visible{outline:3px solid #12A8E3;outline-offset:3px}
.col{scroll-margin-top:56px}
.remove-device{font:inherit;font-size:13px;font-weight:600;background:none;border:0;border-radius:999px;padding:6px 12px;color:var(--soft);cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.remove-device:focus-visible{outline:3px solid #12A8E3;outline-offset:2px}
/* the device switch: one step, no finger scrolling; the other phone slides in (wave 2, P24) */
@keyframes tw-whoosh{from{transform:translateY(55vh);opacity:.35}to{transform:none;opacity:1}}
.col.whoosh{animation:tw-whoosh .32s cubic-bezier(.2,.8,.2,1)}
@media (prefers-reduced-motion: reduce){.col.whoosh{animation:none}}
/* phones: the dock sits in the page flow at the bottom, never over a phone */
@media (max-width:600px){
  body{padding-bottom:24px}
  .dock{position:static;align-items:stretch;margin:18px auto 0;max-width:420px}
  .dock button{justify-content:center;padding:12px 14px;font-size:14px}
}
`
document.head.appendChild(style)

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  e.innerHTML = html
  return e
}

const phones = h('div', 'phones', '')
const head = h('div', 'head', '<h1>TrustWeb demo</h1><p>TrustWeb lets you ask the people you know for help; only answers they approve ever leave their phone. Below is a phone running the real app over the live relay: type a name to start. Add more devices next to it, or watch the scripted version with <b>See it in action</b>.</p>')

// "See it in action": the walkthrough and, under it, what to try on the live phones.
const actionSlot = h('section', 'action-slot', '')
actionSlot.hidden = true
const walkSlot = h('div', '', '')
const liveSteps = h('div', 'live-steps', `<h2>Try it on the live phones below</h2><div class="steps">${[
  '<b>1.</b> Type a name on the first phone and start it, then <b>Add a device</b> (bottom right; it is called Jonas unless you rename it). On the second phone, tap <b>Call into your web</b> and ask "Does anyone have loudspeakers I could borrow?"',
  '<b>2.</b> The first phone shows the ask at once, with the line that matched. Its owner chooses: share, or not.',
  '<b>3.</b> After the 30-second window the second phone shows what was shared, or "No match". A decline looks exactly like no match.',
  '<b>4.</b> Now ask "Does anyone have a place for visiting friends?" The first phone noted one, shared with nobody: it stays silent.',
].map((s) => `<div>${s}</div>`).join('')}</div>`)
actionSlot.append(walkSlot, liveSteps)

let connectLink: string | null = null
/** The personas open on this page, in the order their phones sit (the first is the holder, who is never removed). */
let open: Persona[] = []
const pending: HTMLElement[] = []

/**
 * Coming back to the demo shows it as it was left (wave 2, P12): each phone's
 * record is kept in this browser anyway (store.ts, per persona), and the page
 * remembers which devices were open (a list of personas, since a middle phone can
 * be removed), so a second visit reopens them all.
 * "Start over" forgets both. A convenience only: without storage, one device.
 */
const DEVICES_KEY = `trustweb.demo.devices.${ctx}`

function rememberedDevices(): Persona[] {
  try { return parseDevices(localStorage.getItem(DEVICES_KEY), ORDER) } catch { return parseDevices(null, ORDER) }
}

function rememberDevices(devices: readonly Persona[]): void {
  try { localStorage.setItem(DEVICES_KEY, serializeDevices(devices, ORDER)) } catch { /* this visit only */ }
}

function phoneColumn(p: Persona): { col: HTMLElement; slot: HTMLElement } {
  // No name above a phone: each person names their own phone on its start screen.
  const col = h('div', 'col', '')
  col.dataset.persona = p
  const slot = h('div', 'wait', p === Persona.Holder ? '' : 'Start the first phone with a name; this one then connects to it over the relay...')
  col.appendChild(slot)
  // The first device is the current one and has no remove (demo_devices.ts); every added one can go.
  if (removeVerdict(ORDER, p, ORDER) === RemoveVerdict.Removable) {
    const remove = h('button', 'remove-device', S.demoRemoveDevice)
    remove.dataset.removeDevice = p
    remove.onclick = () => removeDevice(p)
    col.appendChild(remove)
  }
  return { col, slot }
}

function frame(p: Persona, src: string): HTMLIFrameElement {
  const f = document.createElement('iframe')
  f.title = `Device ${ORDER.indexOf(p) + 1}`
  f.src = src
  f.allow = 'microphone'
  return f
}

/** Opens a persona's phone (the next free one, or the one the remembered list names) on Maya's connect link (or waits for it). */
function addDevice(wanted?: Persona): void {
  const p = wanted ?? nextDevice(open, ORDER)
  if (!p || open.includes(p)) return
  open.push(p)
  const { col, slot } = phoneColumn(p)
  phones.appendChild(col)
  if (p === Persona.Holder) {
    slot.replaceWith(frame(p, `${BASE}?persona=holder&solo=1&ctx=${ctx}`))
  } else if (connectLink) {
    slot.replaceWith(frame(p, linkFor(p, connectLink)))
  } else {
    pending.push(slot)
    slot.dataset.persona = p
  }
  updateDock()
  rememberDevices(open)
}

/**
 * "Remove this device": its phone closes and its persona is free again for the next "Add a device". Its stored record STAYS
 * (a persona's record is its identity and what it holds), so adding it again brings the same phone back, still connected, and the
 * first phone's web never shows a second "Jonas" next to a dead one; "Start over" wipes every record. The first device never
 * goes (demo_devices.ts removeVerdict). No confirm here: it is a demo phone; the real app asks before it ends a demo account.
 */
function removeDevice(p: Persona): void {
  if (removeVerdict(open, p, ORDER) !== RemoveVerdict.Removable) return
  const col = phones.querySelector<HTMLElement>(`.col[data-persona="${p}"]`)
  const slot = col?.querySelector<HTMLElement>('.wait')
  const k = slot ? pending.indexOf(slot) : -1
  if (k >= 0) pending.splice(k, 1)
  col?.remove()
  open = withoutDevice(open, p)
  current = Math.min(current, open.length - 1)
  rememberDevices(open)
  updateDock()
  updateSwitch()
}

/** The phone in front: the one added last, or the one switched to. */
let current = 0

/** "Add a device" (a tap): the new phone, scrolled into view. */
function addDeviceTap(): void {
  addDevice()
  current = open.length - 1
  phones.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  updateSwitch()
}

/**
 * "Switch to device N" (wave 2, P24): one tap jumps to the next phone, which
 * slides in with one "whoosh" (not a finger-scroll); on a phone-width screen
 * the phones sit one under the other, so this is how to go from one to the other.
 */
function switchDevice(): void {
  const cols = [...phones.children] as HTMLElement[]
  if (cols.length < 2) return
  current = (current + 1) % cols.length
  const col = cols[current]
  for (const c of cols) c.classList.remove('whoosh')
  // Land first (measured without the slide's transform), then slide in from below.
  col.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' })
  void col.offsetWidth // restart the animation on a second switch to the same phone
  col.classList.add('whoosh')
}

function updateSwitch(): void {
  switchBtn.hidden = open.length < 2
  // Numbered like the phone's own title ("Device 3" is the third persona, even when the second was removed).
  const next = open.length < 2 ? 1 : ORDER.indexOf(open[(current + 1) % open.length]) + 1
  switchBtn.textContent = S.demoSwitch(next)
  switchBtn.setAttribute('aria-label', S.demoSwitch(next))
}

function linkFor(p: Persona, url: string): string {
  const link = new URL(url)
  link.searchParams.set('persona', p)
  link.searchParams.set('solo', '1')
  link.searchParams.set('ctx', ctx)
  link.searchParams.set('device_name', PERSONA_NAMES[p])
  return link.pathname + link.search + link.hash
}

const dock = h('div', 'dock', '')
const addBtn = document.createElement('button')
addBtn.className = 'add'
addBtn.onclick = addDeviceTap
const seeBtn = document.createElement('button')
seeBtn.className = 'see'
seeBtn.setAttribute('aria-expanded', 'false')
let stopWalk: (() => void) | null = null
seeBtn.onclick = () => {
  const open = actionSlot.hidden
  actionSlot.hidden = !open
  seeBtn.setAttribute('aria-expanded', String(open))
  seeBtn.textContent = open ? 'Hide the walkthrough' : 'See it in action'
  if (open && !stopWalk) stopWalk = mountWalkthrough(walkSlot)
  if (!open) stopWalk?.()
  if (open) actionSlot.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
seeBtn.textContent = 'See it in action'
const switchBtn = document.createElement('button')
switchBtn.className = 'switch'
switchBtn.dataset.switchDevice = '1'
switchBtn.onclick = () => { switchDevice(); updateSwitch() }
dock.append(addBtn, seeBtn)

function updateDock(): void {
  // "Side by side" only once there is a second device (owner 2026-10-05).
  const title = open.length > 1 ? 'TrustWeb, side by side' : 'TrustWeb demo'
  const h1 = head.querySelector('h1')
  if (h1) h1.textContent = title
  document.title = title
  const full = open.length >= ORDER.length
  addBtn.disabled = full
  addBtn.innerHTML = full
    ? `${ORDER.length} devices (the most for now)`
    : '<span class="plus" aria-hidden="true">+</span>Add a device'
  addBtn.setAttribute('aria-label', full ? `${ORDER.length} devices, the most for now` : 'Add a device')
}

// "Start the demo over", bottom left, as a restart symbol (owner 2026-10-05).
const foot = (() => {
  const reset = document.createElement('button')
  reset.className = 'restart'
  reset.title = 'Start the demo over'
  reset.setAttribute('aria-label', 'Start the demo over')
  reset.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg><span>Start over</span>'
  reset.onclick = () => {
    for (const p of ORDER) {
      try { localStorage.removeItem(storageKey(p, ctx)) } catch { /* nothing stored */ }
    }
    try { localStorage.removeItem(DEVICES_KEY) } catch { /* nothing stored */ }
    location.reload()
  }
  return reset
})()

// The one [Install] button, top right (wave 1733, A2): demo to live, then install.
const topbar = demoInstallBar(ctx, BASE)
topbar.prepend(switchBtn)
root.append(topbar, head, actionSlot, phones, foot, dock)
for (const p of rememberedDevices()) addDevice(p)
updateSwitch()

window.addEventListener('message', (e: MessageEvent) => {
  const holder = phones.querySelector<HTMLIFrameElement>('iframe[title="Device 1"]')
  if (e.origin !== location.origin || !holder || e.source !== holder.contentWindow) return
  const data = e.data as { type?: unknown; url?: unknown }
  if (data?.type !== 'trustweb-connect-link' || typeof data.url !== 'string' || connectLink) return
  if (new URL(data.url).origin !== location.origin) return
  connectLink = data.url
  for (const slot of pending.splice(0)) {
    const p = slot.dataset.persona as Persona
    slot.replaceWith(frame(p, linkFor(p, data.url)))
  }
})
