/**
 * "See it in action": a scripted, static walkthrough of four phones side by
 * side, played like a video (owner, 2026-10-05): play / pause, a timeline with
 * a milestone line per step, pick any step, and a banner "This happened now"
 * with a title and a short description. Each step shows what changed on which
 * phone, including the phones where nothing happens (that is the point).
 *
 * Static on purpose: it never touches the relay or storage, so it always plays
 * the same way, offline too. The live phones below it are the real app.
 */

enum Device {
  Jonas = 'jonas',
  Maya = 'maya',
  Sam = 'sam',
  Lena = 'lena',
}

interface DeviceInfo { name: string; role: string }

const DEVICES: Record<Device, DeviceInfo> = {
  [Device.Jonas]: { name: 'Jonas', role: 'asks his web' },
  [Device.Maya]: { name: 'Maya', role: 'friend of Jonas' },
  [Device.Sam]: { name: 'Sam', role: 'acquaintance of Jonas' },
  [Device.Lena]: { name: 'Lena', role: 'friend of Maya only' },
}

const ORDER: readonly Device[] = [Device.Jonas, Device.Maya, Device.Sam, Device.Lena]

interface Step {
  title: string
  text: string
  /** Mini-screen HTML per phone for this step (static, escaped by construction). */
  screens: Record<Device, string>
  /** Phones whose screen changed in this step. */
  changed: Device[]
}

const web = (names: string[]): string =>
  `<div class="wt-h">Your TrustWeb</div><div class="wt-rings">${names.map((n) => `<span>${n}</span>`).join('')}</div>`
const card = (cls: string, body: string): string => `<div class="wt-card ${cls}">${body}</div>`
const quiet = (body: string): string => `<div class="wt-quiet">${body}</div>`

// Before they meet, Jonas and Maya are not in each other's web yet.
const JONAS_BEFORE = web(['Sam'])
const MAYA_BEFORE = web(['Lena'])
const JONAS_WEB = web(['Maya', 'Sam'])
const MAYA_WEB = web(['Jonas', 'Lena'])
const SAM_WEB = web(['Jonas'])
const LENA_WEB = web(['Maya'])
const MOTORBIKE = 'Motorbike (125cc), can lend it for a weekend'

const STEPS: Step[] = [
  {
    title: 'Four people, four phones',
    text: 'Jonas knows Sam. Maya knows Lena. Jonas and Maya have not met yet. Everything each of them notes stays on their own phone.',
    screens: { jonas: JONAS_BEFORE, maya: MAYA_BEFORE, sam: SAM_WEB, lena: LENA_WEB },
    changed: [],
  },
  {
    title: 'Jonas meets Maya and records it',
    text: 'Both agreed to the recording. It stays on Jonas\'s phone; the transcript is made on the phone or later on his computer.',
    screens: {
      jonas: `<div class="wt-h">Meeting</div>${card('ok', 'Maya agreed to recording the meeting.')}${card('', '<i>Speaker 2</i> I can lend you my motorbike some weekend.')}`,
      maya: card('', 'In a conversation with Jonas'), sam: SAM_WEB, lena: LENA_WEB,
    },
    changed: [Device.Jonas],
  },
  {
    title: 'They connect with one scan',
    text: 'Jonas shows his code, Maya scans it with her camera. Now they are in each other\'s web, and nobody else sees that they are.',
    screens: {
      jonas: `<div class="wt-h">Meet Maya</div><div class="wt-qr" aria-hidden="true"></div>`,
      maya: `${card('ok', 'Connected with Jonas, as a friend.')}${MAYA_WEB}`, sam: SAM_WEB, lena: LENA_WEB,
    },
    changed: [Device.Jonas, Device.Maya],
  },
  {
    title: 'Maya notes what she could lend',
    text: 'One line in her inventory, and who may ask about it: friends of friends. Nothing is published anywhere.',
    screens: {
      jonas: JONAS_WEB,
      maya: `<div class="wt-h">My inventory</div>${card('', `${MOTORBIKE}<br><small>Friends of friends · on</small>`)}`,
      sam: SAM_WEB, lena: LENA_WEB,
    },
    changed: [Device.Maya],
  },
  {
    title: 'Jonas calls into his web',
    text: '"Does anyone have a motorbike I could borrow?" The question goes to the people Jonas is connected with, and only to them.',
    screens: {
      jonas: `<div class="wt-h">Call into your web</div>${card('q', '"Does anyone have a motorbike I could borrow?"')}<small>Asked 2 people in your web.</small>`,
      maya: quiet('The ask arrives and is checked on this phone.'),
      sam: quiet('The ask arrives and is checked on this phone.'),
      lena: quiet('Nothing reaches Lena. She is not connected to Jonas.'),
    },
    changed: [Device.Jonas, Device.Maya, Device.Sam],
  },
  {
    title: 'Each phone checks privately',
    text: 'Maya\'s motorbike line matches, so she is asked. Sam has nothing that matches: his phone stays silent and Sam is never bothered.',
    screens: {
      jonas: `<div class="wt-h">Call into your web</div><small>Answers in about 24 s</small>`,
      maya: `<div class="wt-cosmic"><b>Jonas asks</b><br>"Does anyone have a motorbike...?"<br><small>On this phone, this matches:</small>${card('', MOTORBIKE)}<span class="wt-btn">Share these</span><span class="wt-btn ghost">Don't share</span></div>`,
      sam: quiet('Nothing matched. Silent.'),
      lena: LENA_WEB,
    },
    changed: [Device.Maya, Device.Sam],
  },
  {
    title: 'Maya chooses to share',
    text: 'Only a person can say yes. Her answer waits for the 30-second window to close, like every other answer, so timing gives nothing away.',
    screens: {
      jonas: `<div class="wt-h">Call into your web</div><small>Answers in about 9 s</small>`,
      maya: card('ok', 'Shared. It leaves when the 30-second window closes.'),
      sam: SAM_WEB, lena: LENA_WEB,
    },
    changed: [Device.Maya],
  },
  {
    title: 'Jonas gets his answer',
    text: 'He sees what Maya chose to share. He does not learn that Sam was asked, or why Sam stayed silent.',
    screens: {
      jonas: `<div class="wt-h">Call into your web</div>${card('ok', `<b>Maya chose to share</b><br>${MOTORBIKE}`)}`,
      maya: MAYA_WEB, sam: SAM_WEB, lena: LENA_WEB,
    },
    changed: [Device.Jonas],
  },
  {
    title: 'A "no" looks exactly like no match',
    text: 'Jonas asks for a spare room in Vienna. Maya noted one but shared it with nobody, so her phone stays silent. Jonas sees "No match", and cannot tell nobody had one from somebody chose not to share.',
    screens: {
      jonas: `<div class="wt-h">Call into your web</div>${card('q', '"Who has a spare room in Vienna?"')}${card('', '<b>No match</b><br><small>You do not learn why.</small>')}`,
      maya: quiet('Matched a note shared with nobody. Silent.'),
      sam: quiet('Nothing matched. Silent.'),
      lena: quiet('Nothing reaches Lena.'),
    },
    changed: [Device.Jonas, Device.Maya, Device.Sam],
  },
]

const STEP_MS = 5200

const CSS = `
.wt{max-width:980px;margin:0 auto 26px;background:var(--card);border-radius:20px;padding:18px 18px 16px;box-shadow:0 10px 40px rgba(36,27,46,.12)}
.wt-banner{display:flex;flex-direction:column;gap:4px;margin-bottom:14px;min-height:76px}
.wt-banner .wt-eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--violet);font-weight:700}
.wt-banner h3{font-family:Optima,Candara,"Gill Sans",sans-serif;font-size:20px;font-weight:600;margin:0}
.wt-banner p{font-size:14px;color:var(--soft);line-height:1.5;margin:0}
.wt-devices{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
@media (max-width:720px){.wt-devices{grid-template-columns:repeat(2,minmax(0,1fr))}}
.wt-dev{display:flex;flex-direction:column;gap:6px;align-items:stretch}
.wt-dev h4{margin:0;font-size:13px;text-align:center}
.wt-dev h4 span{color:var(--soft);font-weight:400}
.wt-screen{position:relative;height:230px;border-radius:22px;background:#F2EBDC;color:#241B2E;padding:16px 12px;overflow:hidden;
  box-shadow:0 0 0 6px #17111e,0 0 0 7px #3a2f47;font-size:12.5px;line-height:1.45;transition:box-shadow .3s}
.wt-screen.changed{box-shadow:0 0 0 6px #17111e,0 0 0 7px #3a2f47,0 0 0 11px rgba(154,55,240,.45)}
.wt-screen.idle{opacity:.55}
.wt-h{font-family:Optima,Candara,"Gill Sans",sans-serif;font-weight:600;font-size:15px;margin-bottom:8px}
.wt-rings{display:flex;flex-wrap:wrap;gap:6px}
.wt-rings span{background:#fff;border-radius:999px;padding:3px 9px;font-weight:600}
.wt-card{background:#fff;border-radius:10px;padding:8px 10px;margin:6px 0}
.wt-card.ok{background:#EAF7F1;border-left:3px solid #4FD7A0}
.wt-card.q{font-weight:600}
.wt-quiet{height:100%;display:grid;place-items:center;text-align:center;color:#5C4F6B;font-style:italic;padding:0 8px}
.wt-cosmic{position:absolute;inset:0;padding:14px 12px;background:linear-gradient(160deg,#2A0E4E,#3B1163 45%,#0E3A55);color:#EDE6F2}
.wt-cosmic .wt-card{color:#241B2E}
.wt-btn{display:inline-block;margin:6px 6px 0 0;border-radius:999px;padding:5px 10px;background:#4FD7A0;color:#0d3527;font-weight:700;font-size:11.5px}
.wt-btn.ghost{background:transparent;color:#BFE6F7;padding-left:0}
.wt-qr{width:110px;height:110px;margin:6px auto;border-radius:8px;
  background:repeating-conic-gradient(#241B2E 0 25%,#fff 0 50%) 0 0/22px 22px;box-shadow:inset 0 0 0 8px #fff}
.wt-controls{display:flex;align-items:center;gap:10px;margin-top:16px}
.wt-controls button{border:0;border-radius:999px;cursor:pointer;font:inherit;font-weight:700}
.wt-play{width:44px;height:44px;background:var(--violet);color:#fff;font-size:16px}
.wt-step{width:34px;height:34px;background:var(--bg);color:var(--ink)}
.wt-controls button:focus-visible,.wt-tick:focus-visible{outline:3px solid #12A8E3;outline-offset:2px}
.wt-track{position:relative;flex:1;height:34px}
.wt-rail{position:absolute;left:0;right:0;top:15px;height:4px;border-radius:2px;background:var(--bg)}
.wt-fill{position:absolute;left:0;top:15px;height:4px;border-radius:2px;background:var(--violet);width:0}
.wt-tick{position:absolute;top:4px;width:22px;height:26px;margin-left:-11px;border:0;background:transparent;cursor:pointer;padding:0}
.wt-tick::before{content:"";position:absolute;left:10px;top:0;width:2px;height:26px;border-radius:1px;background:var(--soft);opacity:.55}
.wt-tick.done::before,.wt-tick.on::before{background:var(--violet);opacity:1}
.wt-tick.on::after{content:"";position:absolute;left:5px;top:8px;width:12px;height:12px;border-radius:50%;background:var(--violet);box-shadow:0 0 0 3px var(--card)}
.wt-count{font-size:12.5px;color:var(--soft);min-width:42px;text-align:right;font-variant-numeric:tabular-nums}
@media (prefers-reduced-motion: reduce){.wt-screen{transition:none}}
@media (prefers-color-scheme: dark){
  .wt-screen{background:#1F1729;color:#F4EDF9;box-shadow:0 0 0 6px #0B0710,0 0 0 7px #3A2D4C}
  .wt-screen.changed{box-shadow:0 0 0 6px #0B0710,0 0 0 7px #3A2D4C,0 0 0 11px rgba(190,130,255,.8)}
  .wt-rings span,.wt-card,.wt-cosmic .wt-card{background:#2B2139;color:#F4EDF9}
  .wt-card.ok{background:#173A2C}
  .wt-quiet{color:#BBAACD}
  .wt-qr{box-shadow:inset 0 0 0 8px #fff}
}
`

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html) e.innerHTML = html
  return e
}

/** Builds the player into `host`. Returns a stop function (pauses playback). */
export function mountWalkthrough(host: HTMLElement): () => void {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const box = el('section', 'wt')
  box.setAttribute('aria-label', 'See it in action: four phones, step by step')
  const banner = el('div', 'wt-banner')
  banner.setAttribute('aria-live', 'polite')
  const devices = el('div', 'wt-devices')
  const screens = new Map<Device, HTMLElement>()
  for (const d of ORDER) {
    const col = el('div', 'wt-dev', `<h4>${DEVICES[d].name} <span>${DEVICES[d].role}</span></h4>`)
    const scr = el('div', 'wt-screen')
    screens.set(d, scr)
    col.appendChild(scr)
    devices.appendChild(col)
  }

  const play = el('button', 'wt-play')
  const prev = el('button', 'wt-step', '‹')
  const next = el('button', 'wt-step', '›')
  prev.setAttribute('aria-label', 'Previous step')
  next.setAttribute('aria-label', 'Next step')
  const track = el('div', 'wt-track')
  const rail = el('div', 'wt-rail')
  const fill = el('div', 'wt-fill')
  track.append(rail, fill)
  const ticks = STEPS.map((s, i) => {
    const t = el('button', 'wt-tick')
    t.style.left = `${(i / (STEPS.length - 1)) * 100}%`
    t.setAttribute('aria-label', `Step ${i + 1}: ${s.title}`)
    t.title = s.title
    t.onclick = (): void => { pause(); show(i) }
    track.appendChild(t)
    return t
  })
  const count = el('span', 'wt-count')
  const controls = el('div', 'wt-controls')
  controls.append(prev, play, next, track, count)
  box.append(banner, devices, controls)
  host.replaceChildren(box)

  let index = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let playing = false

  function show(i: number): void {
    index = Math.max(0, Math.min(STEPS.length - 1, i))
    const s = STEPS[index]
    banner.innerHTML = `<span class="wt-eyebrow">This happened now</span><h3>${s.title}</h3><p>${s.text}</p>`
    for (const d of ORDER) {
      const scr = screens.get(d)
      if (!scr) continue
      scr.innerHTML = s.screens[d]
      scr.classList.toggle('changed', s.changed.includes(d))
      scr.classList.toggle('idle', index > 0 && !s.changed.includes(d))
    }
    ticks.forEach((t, k) => { t.classList.toggle('on', k === index); t.classList.toggle('done', k < index) })
    fill.style.width = `${(index / (STEPS.length - 1)) * 100}%`
    count.textContent = `${index + 1} / ${STEPS.length}`
    prev.disabled = index === 0
    next.disabled = index === STEPS.length - 1
  }

  function schedule(): void {
    clearTimeout(timer)
    if (!playing) return
    timer = setTimeout(() => {
      if (index >= STEPS.length - 1) { pause(); return }
      show(index + 1)
      schedule()
    }, STEP_MS)
  }

  function setPlaying(on: boolean): void {
    playing = on
    play.textContent = on ? '❚❚' : '▶'
    play.setAttribute('aria-label', on ? 'Pause' : 'Play')
    schedule()
  }

  function pause(): void { setPlaying(false) }

  play.onclick = (): void => {
    if (!playing && index >= STEPS.length - 1) show(0)
    setPlaying(!playing)
  }
  prev.onclick = (): void => { pause(); show(index - 1) }
  next.onclick = (): void => { pause(); show(index + 1) }
  box.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { pause(); show(index + 1) }
    if (e.key === 'ArrowLeft') { pause(); show(index - 1) }
  })

  show(0)
  setPlaying(false)
  return pause
}
