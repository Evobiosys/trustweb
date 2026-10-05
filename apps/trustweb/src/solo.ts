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
const ROLE: Record<Persona, string> = {
  [Persona.Holder]: 'has a seeded web and inventory',
  [Persona.Seeker]: 'asks his web',
  [Persona.Third]: 'joins Maya\'s web',
  [Persona.Fourth]: 'joins Maya\'s web',
}

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
.foot{text-align:center;margin-top:22px;font-size:13px;color:var(--soft)}
.foot button,.foot a{font:inherit;color:var(--violet);background:none;border:0;cursor:pointer;text-decoration:underline}
.dock{position:fixed;right:20px;bottom:20px;display:flex;flex-direction:column;align-items:flex-end;gap:10px;z-index:10}
.dock button{font:inherit;font-weight:700;font-size:14.5px;border:0;border-radius:999px;padding:12px 20px;cursor:pointer;display:flex;align-items:center;gap:8px}
.dock .add{background:var(--card);color:var(--ink);box-shadow:0 8px 24px rgba(36,27,46,.25)}
.dock .add[disabled]{opacity:.55;cursor:default}
.dock .see{background:linear-gradient(135deg,#FF715B,#9A37F0);color:#fff;box-shadow:0 8px 24px rgba(154,55,240,.35)}
.dock .plus{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#FF715B,#9A37F0);color:#fff;font-size:17px;font-weight:400}
.dock button:focus-visible{outline:3px solid #12A8E3;outline-offset:3px}
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
const head = h('div', 'head', '<h1>TrustWeb, side by side</h1><p>TrustWeb lets you ask the people you know for help; only answers they approve ever leave their phone. Below is Maya\'s phone, running the real app over the live relay. Add Jonas\'s phone next to it, or watch the scripted version with <b>See it in action</b>.</p>')

// "See it in action": the walkthrough and, under it, what to try on the live phones.
const actionSlot = h('section', 'action-slot', '')
actionSlot.hidden = true
const walkSlot = h('div', '', '')
const liveSteps = h('div', 'live-steps', `<h2>Try it on the live phones below</h2><div class="steps">${[
  '<b>1.</b> First add Jonas\'s device (bottom right). Then on Jonas\'s phone, tap <b>Call into your web</b> and ask "Does anyone have a motorbike I could borrow?"',
  '<b>2.</b> Maya\'s phone shows the ask at once, with the line that matched. She chooses: share, or not.',
  '<b>3.</b> After the 30-second window Jonas sees what she shared, or "No match". A decline looks exactly like no match.',
  '<b>4.</b> Now ask "Who has a spare room in Vienna?" Maya noted one, shared with nobody: her phone stays silent.',
].map((s) => `<div>${s}</div>`).join('')}</div>`)
actionSlot.append(walkSlot, liveSteps)

let connectLink: string | null = null
let shown = 0
const pending: HTMLElement[] = []

function phoneColumn(p: Persona): { col: HTMLElement; slot: HTMLElement } {
  const col = h('div', 'col', `<h2>${PERSONA_NAMES[p]}'s device <span>${ROLE[p]}</span></h2>`)
  const slot = h('div', 'wait', `Connecting ${PERSONA_NAMES[p]} to Maya over the relay...`)
  col.appendChild(slot)
  return { col, slot }
}

function frame(p: Persona, src: string): HTMLIFrameElement {
  const f = document.createElement('iframe')
  f.title = `${PERSONA_NAMES[p]}'s phone`
  f.src = src
  f.allow = 'microphone'
  return f
}

/** Opens the next persona's phone on Maya's connect link (or waits for it). */
function addDevice(): void {
  if (shown >= ORDER.length) return
  const p = ORDER[shown++]
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
  // Not for the first phone: scrolling on load would hide the page title.
  if (shown > 1) col.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
}

function linkFor(p: Persona, url: string): string {
  const link = new URL(url)
  link.searchParams.set('persona', p)
  link.searchParams.set('solo', '1')
  link.searchParams.set('ctx', ctx)
  return link.pathname + link.search
}

const dock = h('div', 'dock', '')
const addBtn = document.createElement('button')
addBtn.className = 'add'
addBtn.onclick = addDevice
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
dock.append(addBtn, seeBtn)

function updateDock(): void {
  const full = shown >= ORDER.length
  addBtn.disabled = full
  addBtn.innerHTML = full
    ? `${ORDER.length} devices (the most for now)`
    : `<span class="plus" aria-hidden="true">+</span>Add a device: ${PERSONA_NAMES[ORDER[shown]]}'s phone`
  addBtn.setAttribute('aria-label', full ? `${ORDER.length} devices, the most for now` : `Add a device: ${PERSONA_NAMES[ORDER[shown]]}'s phone`)
}

const foot = (() => {
  const f = h('p', 'foot', '')
  const reset = document.createElement('button')
  reset.textContent = 'Start the demo over'
  reset.onclick = () => {
    for (const p of ORDER) {
      try { localStorage.removeItem(storageKey(p, ctx)) } catch { /* nothing stored */ }
    }
    location.reload()
  }
  const own = document.createElement('a')
  own.href = BASE
  own.textContent = 'Use TrustWeb on your own phone'
  f.append(reset, document.createTextNode(' · '), own)
  return f
})()

root.append(head, actionSlot, phones, foot, dock)
addDevice()

window.addEventListener('message', (e: MessageEvent) => {
  const holder = phones.querySelector<HTMLIFrameElement>('iframe[title="Maya\'s phone"]')
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
