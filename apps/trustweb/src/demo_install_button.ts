/**
 * The demo pages' ONE button, top right (wave 1733, amendment A2): [Install],
 * looking like the website's (its CSS block copied verbatim from the website's
 * chrome.css, scripts/tw-front-door). It runs demo-to-live, read as "Make it
 * your personal account" (wave 2, P12): everything the person added comes
 * along; the imaginary friends stay or go (start clean / keep them); it leaves the carry-over for
 * the live app (demo_to_live.ts) and opens the live app with ?install=1. When
 * the demo's first phone was never started there is nothing to carry: straight on.
 */
import { el } from '../../demo/src/ui/dom'
import { buildCarryOver, DemoCleanChoice, writeCarry } from './demo_to_live'
import type { DemoContext } from './seed'
import { Persona } from './seed'
import { loadState } from './store'
import { S } from './strings'

/** The website's button CSS (scripts/tw-front-door/chrome.css, .tw-btn and .tw-btn-install), verbatim, plus this page's placement. */
const CSS = `
.tw-btn{box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center;
  height:38px; padding:0 18px; border-radius:999px; border:1.5px solid #33456b;
  font:600 14px/1 "IBM Plex Sans",-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  text-decoration:none; white-space:nowrap; cursor:pointer;
  transition:background-color .15s, color .15s, border-color .15s}
.tw-btn-install{background:#33456b; color:#f4f6fa}
.tw-btn-install:hover{background:#27365a; border-color:#27365a}
.tw-btn:focus-visible{outline:2px solid #33456b; outline-offset:3px}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]) .tw-btn{border-color:#8fa7d8}
  :root:not([data-theme="light"]) .tw-btn-install{background:#8fa7d8; color:#111726}
  :root:not([data-theme="light"]) .tw-btn-install:hover{background:#a6b9e3; border-color:#a6b9e3}
  :root:not([data-theme="light"]) .tw-btn:focus-visible{outline-color:#8fa7d8}
}
.demo-topbar{max-width:1100px; margin:0 auto 6px; display:flex; justify-content:flex-end}
.d2l-veil{position:fixed; inset:0; z-index:50; background:rgba(18,12,26,.55); display:grid; place-items:center; padding:16px}
.d2l{background:var(--card); color:var(--ink); border-radius:20px; padding:22px 22px 18px; max-width:420px; width:100%;
  box-shadow:0 24px 80px rgba(36,27,46,.45); font-size:14.5px; line-height:1.55}
.d2l h2{font-size:19px; margin:0 0 8px}
.d2l p{color:var(--soft); margin:0 0 14px}
.d2l p.q{color:var(--ink); font-weight:600}
.d2l p.fd{font-size:13px}
.d2l p.fd a{color:var(--ink); font-weight:600}
.d2l .row{display:flex; flex-direction:column; gap:8px}
.d2l button{font:inherit; font-weight:700; border-radius:999px; padding:11px 16px; cursor:pointer; border:1.5px solid #33456b}
.d2l .clean{background:#33456b; color:#f4f6fa}
.d2l .keep{background:transparent; color:var(--ink)}
.d2l .cancel{background:transparent; border-color:transparent; color:var(--soft); font-weight:600}
.d2l button:focus-visible{outline:3px solid #12A8E3; outline-offset:2px}
`

/**
 * The hosted service, where each person's own front door will come from
 * (wave 3: TrustInTheWeb.com = the freemium hosting site). A static link,
 * labelled "coming soon": the site is being made in the same wave.
 */
const HOSTED_SERVICE_URL = 'https://trustintheweb.com/'

/** Where the live app sits next to the demo pages (the app root under the same base). */
function liveUrl(base: string): string {
  return `${base}?install=1`
}

function closeDialog(veil: HTMLElement, opener: HTMLElement): void {
  veil.remove()
  opener.focus()
}

/** "Make it your personal account": keep or drop the imaginary friends, then on to the live app. */
function askClean(ctx: DemoContext, base: string, opener: HTMLElement): void {
  const demo = loadState(Persona.Holder, ctx)
  if (!demo) { location.assign(liveUrl(base)); return }
  const go = (choice: DemoCleanChoice): void => {
    writeCarry(buildCarryOver(demo, ctx, choice, Date.now()))
    location.assign(liveUrl(base))
  }
  const veil = el('div', { class: 'd2l-veil' })
  const clean = el('button', { class: 'clean', 'data-d2l': DemoCleanChoice.StartClean, onclick: () => go(DemoCleanChoice.StartClean) }, [S.d2lClean])
  const dialog = el('div', { class: 'd2l', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'd2l-title' }, [
    el('h2', { id: 'd2l-title' }, [S.d2lTitle]),
    el('p', {}, [S.d2lLead(demo.me.displayName)]),
    el('p', { class: 'fd', 'data-d2l-front-door': '1' }, [
      S.d2lFrontDoor, ' ',
      el('a', { href: HOSTED_SERVICE_URL, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer' }, [S.d2lFrontDoorLink]),
    ]),
    el('p', { class: 'q' }, [S.d2lQuestion]),
    el('div', { class: 'row' }, [
      clean,
      el('button', { class: 'keep', 'data-d2l': DemoCleanChoice.KeepThem, onclick: () => go(DemoCleanChoice.KeepThem) }, [S.d2lKeep]),
      el('button', { class: 'cancel', onclick: () => closeDialog(veil, opener) }, [S.d2lCancel]),
    ]),
  ])
  veil.addEventListener('click', (e) => { if (e.target === veil) closeDialog(veil, opener) })
  veil.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') closeDialog(veil, opener) })
  veil.append(dialog)
  document.body.append(veil)
  clean.focus()
}

/** The top bar with the one [Install] button, for the demo page to put first. */
export function demoInstallBar(ctx: DemoContext, base: string): HTMLElement {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.append(style)
  const btn = el('button', { class: 'tw-btn tw-btn-install', 'data-demo-install': '1', title: S.d2lButtonTitle }, [S.d2lButton])
  btn.addEventListener('click', () => askClean(ctx, base, btn))
  return el('div', { class: 'demo-topbar' }, [btn])
}
