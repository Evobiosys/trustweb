/**
 * The solo-funder view: two phones side by side on one laptop.
 *
 * Two browser tabs share one storage identity, so a single presenter cannot
 * play holder and seeker in two tabs. Here each iframe runs the real app
 * under its own persona (?persona=holder / ?persona=seeker), which store.ts
 * keeps in separate records with separate relay identities. The holder's
 * phone posts its real connect link up to this page; the seeker's phone is
 * then opened on that link, exactly as a phone camera would open a scanned
 * code, so the pairing, the ask and the consent all go over the live relay.
 */
import { storageKey } from './store'

const BASE = import.meta.env.BASE_URL
const root = document.getElementById('solo') as HTMLElement

const style = document.createElement('style')
style.textContent = `
:root{--bg:#F4EFF7;--ink:#241B2E;--soft:#6b5d7a;--violet:#9A37F0;--card:#fff}
@media (prefers-color-scheme: dark){:root{--bg:#1A1322;--ink:#EDE6F2;--soft:#a795bb;--card:#241B2E}}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--ink);font-family:"Seravek","Avenir Next","Segoe UI",system-ui,sans-serif;padding:24px 16px 40px}
.head{max-width:900px;margin:0 auto 18px;text-align:center}
.head h1{font-family:Optima,Candara,"Gill Sans",sans-serif;font-weight:600;font-size:clamp(22px,4vw,30px)}
.head p{color:var(--soft);font-size:14px;margin-top:6px;line-height:1.55}
.steps{max-width:900px;margin:0 auto 20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
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
`
document.head.appendChild(style)

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  e.innerHTML = html
  return e
}

const holder = document.createElement('iframe')
holder.title = "Maya's phone"
holder.src = `${BASE}?persona=holder&solo=1`
holder.allow = 'microphone'

const seekerSlot = h('div', 'wait', 'Connecting Jonas to Maya over the relay...')

root.append(
  h('div', 'head', '<h1>TrustWeb, two phones on one screen</h1><p>Both phones run the real app and talk over the live relay. Maya has listed a motorbike; Jonas is connected to her as a friend.</p>'),
  h('div', 'steps', [
    '<b>1.</b> On Jonas\'s phone, open <b>Query</b> and ask "Does anyone have a motorbike I could borrow?"',
    '<b>2.</b> Maya\'s phone shows the ask at once, with the line that matched. She chooses: share, or not.',
    '<b>3.</b> After the 30-second window Jonas sees what she shared, or "No match". A decline looks exactly like no match.',
    '<b>4.</b> Now ask "Who has a spare room in Vienna?" Maya noted one, shared with nobody: her phone stays silent.',
  ].map((s) => `<div>${s}</div>`).join('')),
  (() => {
    const phones = h('div', 'phones', '')
    const left = h('div', 'col', '<h2>Maya <span>holds a motorbike</span></h2>')
    left.appendChild(holder)
    const right = h('div', 'col', '<h2>Jonas <span>asks his web</span></h2>')
    right.appendChild(seekerSlot)
    phones.append(left, right)
    return phones
  })(),
  (() => {
    const foot = h('p', 'foot', '')
    const reset = document.createElement('button')
    reset.textContent = 'Start the demo over'
    reset.onclick = () => {
      for (const p of ['holder', 'seeker']) {
        try { localStorage.removeItem(storageKey(p)) } catch { /* nothing stored */ }
      }
      location.reload()
    }
    const own = document.createElement('a')
    own.href = BASE
    own.textContent = 'Use TrustWeb on your own phone'
    foot.append(reset, document.createTextNode(' · '), own)
    return foot
  })(),
)

let seekerStarted = false
window.addEventListener('message', (e: MessageEvent) => {
  if (e.origin !== location.origin || e.source !== holder.contentWindow) return
  const data = e.data as { type?: unknown; url?: unknown }
  if (data?.type !== 'trustweb-connect-link' || typeof data.url !== 'string' || seekerStarted) return
  const link = new URL(data.url)
  if (link.origin !== location.origin) return
  seekerStarted = true
  link.searchParams.set('persona', 'seeker')
  link.searchParams.set('solo', '1')
  const seeker = document.createElement('iframe')
  seeker.title = "Jonas's phone"
  seeker.src = link.pathname + link.search
  seeker.allow = 'microphone'
  seekerSlot.replaceWith(seeker)
})
