/**
 * "See it in action", v2: a scripted walkthrough of TrustWeb on several
 * phones side by side, played like a video (owner, 2026-10-05).
 *
 * - Three modes, from the Manifund application's examples: 2 people (ask a
 *   friend), 3 people (a job lead months after meeting, Example A), 4 people
 *   (a funder two hops away, Example B).
 * - Play / pause, a milestone line per step on the timeline (click to jump),
 *   previous / next, and a speed the viewer picks ("next step every N s").
 * - A "This happened now" banner, a small who-knows-whom strip that lights up
 *   the path of the current step, and one titled phone per person ("Maya's
 *   device") showing what changed there, including where nothing happens.
 *
 * Static on purpose: no relay, no app data, the same every time. Honest about
 * scope: two-hop asks are TrustWeb's design (the Manifund examples); the live
 * phones on the page answer one hop today, and the 3- and 4-person modes say so.
 */

enum Tie {
  Close = 'close',
  Friend = 'friend',
  Acquaintance = 'acquaintance',
}

interface Who { id: string; name: string; role: string }
interface Link { a: string; b: string; tie: Tie }
interface Step {
  title: string
  text: string
  screens: Record<string, string>
  changed: string[]
  /** People the current step travels through, in order (lights up the strip). */
  path?: string[]
}
interface Mode {
  id: string
  label: string
  title: string
  intro: string
  note?: string
  people: Who[]
  links: Link[]
  steps: Step[]
}

// ----------------------------------------------------------------- screens
const web = (names: string[]): string =>
  `<div class="wt-h">Your TrustWeb</div><div class="wt-rings">${names.length ? names.map((n) => `<span>${n}</span>`).join('') : '<em>Nobody yet</em>'}</div>`
const card = (cls: string, body: string): string => `<div class="wt-card ${cls}">${body}</div>`
const quiet = (body: string): string => `<div class="wt-quiet">${body}</div>`
const ask = (q: string, n: number): string => `<div class="wt-h">Call into your web</div>${card('q', `"${q}"`)}<small>Asked ${n === 1 ? '1 person' : `${n} people`} in your web.</small>`
const waiting = (s: number): string => `<div class="wt-h">Call into your web</div><small>Answers in about ${s} s</small>`
const consent = (who: string, q: string, match: string): string =>
  `<div class="wt-cosmic"><b>${who} asks</b><br>"${q}"<br><small>On this phone, this matches:</small>${card('', match)}<span class="wt-btn">Share these</span><span class="wt-btn ghost">Don't share</span></div>`
const noApp = (body: string): string => `<div class="wt-noapp"><b>No TrustWeb app</b><br>${body}</div>`

const MOTORBIKE = 'Motorbike (125cc), can lend it for a weekend'
const POSITION = 'We have a new position to fill'
const FUND = 'Aisha just opened an animal welfare fund'

const MODES: Mode[] = [
  {
    id: '2',
    label: '2 people',
    title: 'Ask a friend',
    intro: 'Jonas meets Maya, they connect with one scan, and later Jonas asks his web for a motorbike.',
    people: [
      { id: 'jonas', name: 'Jonas', role: 'asks his web' },
      { id: 'maya', name: 'Maya', role: 'can lend a motorbike' },
    ],
    links: [{ a: 'jonas', b: 'maya', tie: Tie.Friend }],
    steps: [
      {
        title: 'Two people, two phones', changed: [],
        text: 'Jonas and Maya have not met yet. Whatever each of them notes stays on their own phone.',
        screens: { jonas: web([]), maya: web([]) },
      },
      {
        title: 'They meet, and Jonas records it', changed: ['jonas'], path: ['jonas', 'maya'],
        text: 'Both agreed to the recording. It stays on Jonas\'s phone, for his notes afterwards.',
        screens: {
          jonas: `<div class="wt-h">Meeting</div>${card('ok', 'Maya agreed to recording the meeting.')}${card('', '<i>Speaker 2</i> I can lend you my motorbike some weekend.')}`,
          maya: quiet('In a conversation with Jonas.'),
        },
      },
      {
        title: 'One scan, and they are connected', changed: ['jonas', 'maya'], path: ['jonas', 'maya'],
        text: 'Jonas shows his code, Maya scans it with her camera. Now they are in each other\'s web.',
        screens: {
          jonas: `<div class="wt-h">Meet Maya</div><div class="wt-qr" aria-hidden="true"></div>`,
          maya: `${card('ok', 'Connected with Jonas, as a friend.')}${web(['Jonas'])}`,
        },
      },
      {
        title: 'Maya notes what she could lend', changed: ['maya'],
        text: 'One line in her inventory, and who may ask about it. Nothing is published anywhere.',
        screens: { jonas: web(['Maya']), maya: `<div class="wt-h">My inventory</div>${card('', `${MOTORBIKE}<br><small>Friends of friends · on</small>`)}` },
      },
      {
        title: 'Jonas calls into his web', changed: ['jonas', 'maya'], path: ['jonas', 'maya'],
        text: 'He asks in his own words. The question goes only to people he is connected with.',
        screens: { jonas: ask('Does anyone have a motorbike I could borrow?', 1), maya: quiet('The ask arrives and is checked on this phone.') },
      },
      {
        title: 'Maya\'s phone finds a match and asks her', changed: ['maya'],
        text: 'Only a person can say yes. Maya sees exactly which line matched before deciding.',
        screens: { jonas: waiting(24), maya: consent('Jonas', 'Does anyone have a motorbike...?', MOTORBIKE) },
      },
      {
        title: 'Maya shares', changed: ['maya'], path: ['maya', 'jonas'],
        text: 'Her answer waits for the 30-second window to close, like every answer, so timing gives nothing away.',
        screens: { jonas: waiting(9), maya: card('ok', 'Shared. It leaves when the 30-second window closes.') },
      },
      {
        title: 'Jonas gets his answer', changed: ['jonas'],
        text: 'He sees what Maya chose to share, and nothing else from her phone.',
        screens: { jonas: `<div class="wt-h">Call into your web</div>${card('ok', `<b>Maya chose to share</b><br>${MOTORBIKE}`)}`, maya: web(['Jonas']) },
      },
      {
        title: 'A "no" looks exactly like no match', changed: ['jonas', 'maya'], path: ['jonas', 'maya'],
        text: 'Jonas asks for a spare room. Maya has one noted but shared with nobody, so her phone stays silent and Jonas sees "No match". He cannot tell "nobody had one" from "somebody chose not to share".',
        screens: {
          jonas: `<div class="wt-h">Call into your web</div>${card('q', '"Who has a spare room in Vienna?"')}${card('', '<b>No match</b><br><small>You do not learn why.</small>')}`,
          maya: quiet('Matched a note shared with nobody. Silent.'),
        },
      },
    ],
  },
  {
    id: '3',
    label: '3 people',
    title: 'A job lead, months after meeting',
    intro: 'Manifund Example A: an acquaintance finds an opening through your friend, without you lifting a finger. Here Jonas is "you".',
    note: 'Two-hop asks are how TrustWeb is designed (Manifund Example A). The live phones on this page answer one hop today.',
    people: [
      { id: 'sam', name: 'Sam', role: 'Jonas\'s acquaintance' },
      { id: 'jonas', name: 'Jonas', role: 'you, not involved in the moment' },
      { id: 'maya', name: 'Maya', role: 'Jonas\'s friend' },
    ],
    links: [{ a: 'sam', b: 'jonas', tie: Tie.Acquaintance }, { a: 'jonas', b: 'maya', tie: Tie.Friend }],
    steps: [
      {
        title: 'Months ago, Jonas met Sam', changed: [],
        text: 'Sam is an acquaintance of Jonas. Maya is Jonas\'s friend. Sam and Maya have never met.',
        screens: { sam: web(['Jonas']), jonas: web(['Sam', 'Maya']), maya: web(['Jonas']) },
      },
      {
        title: 'Maya notes an opening', changed: ['maya'],
        text: 'She lets friends of friends ask about it. Still nothing is published.',
        screens: { sam: web(['Jonas']), jonas: web(['Sam', 'Maya']), maya: `<div class="wt-h">My inventory</div>${card('', `${POSITION}<br><small>Friends of friends · on</small>`)}` },
      },
      {
        title: 'Sam calls into his web', changed: ['sam', 'jonas', 'maya'], path: ['sam', 'jonas', 'maya'],
        text: '"Who is hiring?" It reaches Jonas, and through Jonas, his friends. Jonas is not asked to do anything.',
        screens: { sam: ask('Who is hiring?', 1), jonas: quiet('Passed on to Jonas\'s friends. Jonas is not involved in the moment.'), maya: quiet('The ask arrives through Jonas and is checked on this phone.') },
      },
      {
        title: 'Maya\'s phone finds a match and asks her', changed: ['maya'],
        text: 'Maya sees who asks (a friend of Jonas) and which line matched. Her yes is the only way anything leaves.',
        screens: { sam: waiting(24), jonas: web(['Sam', 'Maya']), maya: consent('Sam, through Jonas,', 'Who is hiring?', POSITION) },
      },
      {
        title: 'The answer travels back through Jonas', changed: ['maya', 'jonas'], path: ['maya', 'jonas', 'sam'],
        text: 'Maya shares. Her answer goes back the way the ask came, sealed, through Jonas\'s phone.',
        screens: { sam: waiting(9), jonas: quiet('Relays a sealed answer. Jonas cannot read it.'), maya: card('ok', 'Shared with Sam, through Jonas.') },
      },
      {
        title: 'Sam has a job lead', changed: ['sam'],
        text: 'Through a friend of an acquaintance, months after meeting, without anyone broadcasting anything.',
        screens: { sam: `<div class="wt-h">Call into your web</div>${card('ok', `<b>Maya chose to share</b> (through Jonas)<br>${POSITION}`)}`, jonas: web(['Sam', 'Maya']), maya: web(['Jonas']) },
      },
    ],
  },
  {
    id: '4',
    label: '4 people',
    title: 'A funder two hops away',
    intro: 'Manifund Example B: your friend finds a fund through your close friend\'s network, someone neither of you knows. Here Jonas is "you".',
    note: 'Two-hop asks are how TrustWeb is designed (Manifund Example B). The live phones on this page answer one hop today.',
    people: [
      { id: 'lena', name: 'Lena', role: 'Jonas\'s friend, animal welfare project' },
      { id: 'jonas', name: 'Jonas', role: 'you, not required to approve' },
      { id: 'maya', name: 'Maya', role: 'Jonas\'s close friend' },
      { id: 'aisha', name: 'Aisha', role: 'Maya\'s acquaintance' },
    ],
    links: [
      { a: 'lena', b: 'jonas', tie: Tie.Friend },
      { a: 'jonas', b: 'maya', tie: Tie.Close },
      { a: 'maya', b: 'aisha', tie: Tie.Acquaintance },
    ],
    steps: [
      {
        title: 'Four people, three apps', changed: [],
        text: 'Lena works on an animal welfare project. Aisha does not use TrustWeb at all.',
        screens: { lena: web(['Jonas']), jonas: web(['Lena', 'Maya']), maya: web(['Jonas']), aisha: noApp('Aisha just opened an animal welfare fund.') },
      },
      {
        title: 'Maya notes what she heard', changed: ['maya'], path: ['aisha', 'maya'],
        text: 'After meeting Aisha, Maya notes it, for people she regards as friends. Aisha\'s phone is not involved.',
        screens: { lena: web(['Jonas']), jonas: web(['Lena', 'Maya']), maya: `<div class="wt-h">Notes about Aisha</div>${card('', `${FUND}<br><small>Friends of friends</small>`)}`, aisha: noApp('Aisha just opened an animal welfare fund.') },
      },
      {
        title: 'Lena calls into her web', changed: ['lena', 'jonas', 'maya'], path: ['lena', 'jonas', 'maya'],
        text: '"Any new animal welfare funding?" It reaches Jonas and, through him, his close friend Maya. Jonas does not have to approve.',
        screens: { lena: ask('Any new animal welfare funding?', 1), jonas: quiet('Passed on. Jonas is not required to approve.'), maya: quiet('The ask arrives through Jonas and is checked on this phone.'), aisha: noApp('Nothing reaches Aisha.') },
      },
      {
        title: 'Maya\'s phone finds a match and asks her', changed: ['maya'],
        text: 'The match is Maya\'s own note. Aisha is never contacted by anyone\'s phone.',
        screens: { lena: waiting(24), jonas: web(['Lena', 'Maya']), maya: consent('Lena, through Jonas,', 'Any new animal welfare funding?', FUND), aisha: noApp('Nothing reaches Aisha.') },
      },
      {
        title: 'The answer travels back through Jonas', changed: ['maya', 'jonas'], path: ['maya', 'jonas', 'lena'],
        text: 'Maya shares. The answer goes back through Jonas, sealed.',
        screens: { lena: waiting(9), jonas: quiet('Relays a sealed answer. Jonas cannot read it.'), maya: card('ok', 'Shared with Lena, through Jonas.'), aisha: noApp('Aisha just opened an animal welfare fund.') },
      },
      {
        title: 'Lena finds a funder two hops away', changed: ['lena'],
        text: 'Someone neither Lena nor Jonas knows. Next, Lena can ask Jonas to ask Maya for an introduction.',
        screens: { lena: `<div class="wt-h">Call into your web</div>${card('ok', `<b>Maya chose to share</b> (through Jonas)<br>${FUND}`)}`, jonas: web(['Lena', 'Maya']), maya: web(['Jonas']), aisha: noApp('Aisha just opened an animal welfare fund.') },
      },
    ],
  },
]

const SPEEDS = [2, 3, 4, 6]
const DEFAULT_SPEED = 3
const SPEED_KEY = 'trustweb.walkthrough.speed'

function loadSpeed(): number {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY))
    return SPEEDS.includes(v) ? v : DEFAULT_SPEED
  } catch { return DEFAULT_SPEED }
}
function saveSpeed(v: number): void {
  try { localStorage.setItem(SPEED_KEY, String(v)) } catch { /* this visit only */ }
}

const CSS = `
.wt{max-width:1100px;margin:0 auto 26px;background:var(--card);border-radius:20px;padding:18px 18px 16px;box-shadow:0 10px 40px rgba(36,27,46,.12)}
.wt-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
.wt-modes{display:flex;gap:4px;background:var(--bg);border-radius:999px;padding:3px}
.wt-modes button{border:0;background:transparent;border-radius:999px;padding:7px 14px;font:inherit;font-weight:700;font-size:13px;color:var(--soft);cursor:pointer}
.wt-modes button.on{background:var(--card);color:var(--ink);box-shadow:0 1px 6px rgba(36,27,46,.15)}
.wt-speed{font-size:13px;color:var(--soft);display:flex;align-items:center;gap:6px}
.wt-speed select{font:inherit;border-radius:8px;border:1px solid var(--soft);background:var(--card);color:var(--ink);padding:3px 6px}
.wt-intro{font-size:13.5px;color:var(--soft);margin:0 0 6px;line-height:1.5}
.wt-intro b{color:var(--ink)}
.wt-strip{display:block;width:100%;height:64px;margin:2px 0 8px}
.wt-strip text{font:600 12px "Seravek","Avenir Next",system-ui,sans-serif;fill:var(--ink)}
.wt-strip .ln{stroke:var(--soft);opacity:.6}
.wt-strip .ln.on{stroke:#9A37F0;opacity:1}
.wt-strip .nd{fill:var(--bg);stroke:var(--soft);stroke-width:2}
.wt-strip .nd.on{fill:#9A37F0;stroke:#9A37F0}
.wt-banner{display:flex;flex-direction:column;gap:4px;margin-bottom:12px;min-height:82px;border-left:4px solid #9A37F0;padding:2px 0 2px 12px}
.wt-banner .wt-eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#9A37F0;font-weight:700}
.wt-banner h3{font-family:Optima,Candara,"Gill Sans",sans-serif;font-size:20px;font-weight:600;margin:0}
.wt-banner p{font-size:14px;color:var(--soft);line-height:1.5;margin:0}
.wt-devices{display:grid;gap:12px}
.wt-dev{display:flex;flex-direction:column;gap:16px;align-items:stretch;min-width:0}
.wt-dev h4{margin:0;font-size:13.5px;text-align:center}
.wt-dev h4 small{display:block;color:var(--soft);font-weight:400;font-size:11.5px}
.wt-screen{position:relative;height:230px;border-radius:22px;background:#F2EBDC;color:#241B2E;padding:16px 12px;overflow:hidden;
  box-shadow:0 0 0 6px #17111e,0 0 0 7px #3a2f47;font-size:12.5px;line-height:1.45;transition:box-shadow .3s,opacity .3s}
.wt-screen.changed{box-shadow:0 0 0 6px #17111e,0 0 0 7px #3a2f47,0 0 0 11px rgba(154,55,240,.5)}
.wt-screen.idle{opacity:.5}
.wt-tag{position:absolute;right:8px;top:8px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:#9A37F0;color:#fff;border-radius:999px;padding:2px 7px;z-index:2}
.wt-h{font-family:Optima,Candara,"Gill Sans",sans-serif;font-weight:600;font-size:15px;margin-bottom:8px}
.wt-rings{display:flex;flex-wrap:wrap;gap:6px}
.wt-rings span{background:#fff;border-radius:999px;padding:3px 9px;font-weight:600}
.wt-card{background:#fff;border-radius:10px;padding:8px 10px;margin:6px 0}
.wt-card.ok{background:#EAF7F1;border-left:3px solid #4FD7A0}
.wt-card.q{font-weight:600}
.wt-quiet{height:100%;display:grid;place-items:center;text-align:center;color:#5C4F6B;font-style:italic;padding:0 8px}
.wt-noapp{height:100%;display:grid;place-content:center;text-align:center;gap:6px;color:#5C4F6B;border:2px dashed #b9aec4;border-radius:16px;padding:10px}
.wt-cosmic{position:absolute;inset:0;padding:14px 12px;background:linear-gradient(160deg,#2A0E4E,#3B1163 45%,#0E3A55);color:#EDE6F2}
.wt-cosmic .wt-card{color:#241B2E}
.wt-btn{display:inline-block;margin:6px 6px 0 0;border-radius:999px;padding:5px 10px;background:#4FD7A0;color:#0d3527;font-weight:700;font-size:11.5px}
.wt-btn.ghost{background:transparent;color:#BFE6F7;padding-left:0}
.wt-qr{width:110px;height:110px;margin:6px auto;border-radius:8px;background:repeating-conic-gradient(#241B2E 0 25%,#fff 0 50%) 0 0/22px 22px;box-shadow:inset 0 0 0 8px #fff}
.wt-note{font-size:12.5px;color:var(--soft);margin:10px 0 0}
.wt-controls{display:flex;align-items:center;gap:10px;margin-top:16px}
.wt-controls button{border:0;border-radius:999px;cursor:pointer;font:inherit;font-weight:700}
.wt-play{width:46px;height:46px;background:#9A37F0;color:#fff;font-size:16px;flex-shrink:0}
.wt-step{width:34px;height:34px;background:var(--bg);color:var(--ink);flex-shrink:0}
.wt-step[disabled]{opacity:.4;cursor:default}
.wt-controls button:focus-visible,.wt-tick:focus-visible,.wt-modes button:focus-visible{outline:3px solid #12A8E3;outline-offset:2px}
.wt-track{position:relative;flex:1;height:34px;min-width:120px}
.wt-rail{position:absolute;left:0;right:0;top:15px;height:4px;border-radius:2px;background:var(--bg)}
.wt-fill{position:absolute;left:0;top:15px;height:4px;border-radius:2px;background:#9A37F0;width:0}
.wt-tick{position:absolute;top:4px;width:22px;height:26px;margin-left:-11px;border:0;background:transparent;cursor:pointer;padding:0}
.wt-tick::before{content:"";position:absolute;left:10px;top:0;width:2px;height:26px;border-radius:1px;background:var(--soft);opacity:.55}
.wt-tick.done::before,.wt-tick.on::before{background:#9A37F0;opacity:1}
.wt-tick.on::after{content:"";position:absolute;left:5px;top:8px;width:12px;height:12px;border-radius:50%;background:#9A37F0;box-shadow:0 0 0 3px var(--card)}
.wt-count{font-size:12.5px;color:var(--soft);min-width:42px;text-align:right;font-variant-numeric:tabular-nums}
@media (max-width:760px){.wt-devices{grid-template-columns:repeat(2,minmax(0,1fr)) !important}}
@media (prefers-reduced-motion: reduce){.wt-screen{transition:none}}
@media (prefers-color-scheme: dark){
  .wt-screen{background:#1F1729;color:#F4EDF9;box-shadow:0 0 0 6px #0B0710,0 0 0 7px #3A2D4C}
  .wt-screen.changed{box-shadow:0 0 0 6px #0B0710,0 0 0 7px #3A2D4C,0 0 0 11px rgba(190,130,255,.8)}
  .wt-rings span,.wt-card,.wt-cosmic .wt-card{background:#2B2139;color:#F4EDF9}
  .wt-card.ok{background:#173A2C}
  .wt-quiet,.wt-noapp{color:#BBAACD}
  .wt-noapp{border-color:#5d4f70}
}
`

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html) e.innerHTML = html
  return e
}

const NS = 'http://www.w3.org/2000/svg'

/** The who-knows-whom strip: people in a row, ties drawn like the Manifund legend. */
function strip(mode: Mode): { svg: SVGSVGElement; light(path?: string[]): void } {
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('class', 'wt-strip')
  svg.setAttribute('viewBox', '0 0 1000 64')
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  svg.setAttribute('role', 'img')
  const nameOf = (id: string): string => mode.people.find((p) => p.id === id)?.name ?? id
  svg.setAttribute('aria-label', 'Who knows whom: ' + mode.links.map((l) => `${nameOf(l.a)} and ${nameOf(l.b)}, ${l.tie === Tie.Close ? 'close friends' : l.tie === Tie.Friend ? 'friends' : 'acquaintances'}`).join('; '))
  const n = mode.people.length
  const x = (i: number): number => 100 + (800 * i) / Math.max(1, n - 1)
  const pos = new Map(mode.people.map((p, i) => [p.id, x(i)]))
  const lines = mode.links.map((l) => {
    const ln = document.createElementNS(NS, 'line')
    ln.setAttribute('x1', String(pos.get(l.a))); ln.setAttribute('x2', String(pos.get(l.b)))
    ln.setAttribute('y1', '22'); ln.setAttribute('y2', '22')
    ln.setAttribute('class', 'ln')
    ln.setAttribute('stroke-width', l.tie === Tie.Close ? '6' : '3')
    if (l.tie === Tie.Acquaintance) ln.setAttribute('stroke-dasharray', '2 8')
    ln.setAttribute('stroke-linecap', 'round')
    svg.appendChild(ln)
    const t = document.createElementNS(NS, 'text')
    t.setAttribute('x', String(((pos.get(l.a) ?? 0) + (pos.get(l.b) ?? 0)) / 2)); t.setAttribute('y', '12')
    t.setAttribute('text-anchor', 'middle'); t.setAttribute('style', 'font-weight:400;font-size:10.5px;fill:var(--soft)')
    t.textContent = l.tie === Tie.Close ? 'close friend' : l.tie
    svg.appendChild(t)
    return { l, ln }
  })
  const nodes = mode.people.map((p) => {
    const c = document.createElementNS(NS, 'circle')
    c.setAttribute('cx', String(pos.get(p.id))); c.setAttribute('cy', '22'); c.setAttribute('r', '9'); c.setAttribute('class', 'nd')
    svg.appendChild(c)
    const t = document.createElementNS(NS, 'text')
    t.setAttribute('x', String(pos.get(p.id))); t.setAttribute('y', '52'); t.setAttribute('text-anchor', 'middle')
    t.textContent = p.name
    svg.appendChild(t)
    return { id: p.id, c }
  })
  return {
    svg,
    light(path?: string[]): void {
      const on = new Set(path ?? [])
      nodes.forEach(({ id, c }) => c.classList.toggle('on', on.has(id)))
      lines.forEach(({ l, ln }) => {
        const i = path ? path.indexOf(l.a) : -1
        const j = path ? path.indexOf(l.b) : -1
        ln.classList.toggle('on', i >= 0 && j >= 0 && Math.abs(i - j) === 1)
      })
    },
  }
}

/** Builds the player into `host`. Returns a function that pauses playback. */
export function mountWalkthrough(host: HTMLElement): () => void {
  if (!document.getElementById('wt-style')) {
    const style = document.createElement('style')
    style.id = 'wt-style'
    style.textContent = CSS
    document.head.appendChild(style)
  }
  let mode = MODES[0]
  let index = 0
  let playing = false
  let speed = loadSpeed()
  let timer: ReturnType<typeof setTimeout> | undefined

  const box = el('section', 'wt')
  box.setAttribute('aria-label', 'See it in action: TrustWeb on several phones, step by step')
  const modes = el('div', 'wt-modes')
  modes.setAttribute('role', 'tablist')
  modes.setAttribute('aria-label', 'How many people')
  const speedSel = el('select')
  speedSel.setAttribute('aria-label', 'Seconds per step')
  for (const s of SPEEDS) {
    const o = el('option'); o.value = String(s); o.textContent = `${s} s`
    if (s === speed) o.selected = true
    speedSel.appendChild(o)
  }
  speedSel.onchange = (): void => { speed = Number(speedSel.value); saveSpeed(speed); schedule() }
  const speedLbl = el('label', 'wt-speed')
  speedLbl.append('Next step every', speedSel)
  const top = el('div', 'wt-top')
  top.append(modes, speedLbl)
  const intro = el('p', 'wt-intro')
  const stripSlot = el('div')
  const banner = el('div', 'wt-banner')
  banner.setAttribute('aria-live', 'polite')
  const devices = el('div', 'wt-devices')
  const note = el('p', 'wt-note')
  const play = el('button', 'wt-play')
  const prev = el('button', 'wt-step', '‹')
  const next = el('button', 'wt-step', '›')
  prev.setAttribute('aria-label', 'Previous step')
  next.setAttribute('aria-label', 'Next step')
  const track = el('div', 'wt-track')
  const fill = el('div', 'wt-fill')
  const count = el('span', 'wt-count')
  const controls = el('div', 'wt-controls')
  controls.append(prev, play, next, track, count)
  box.append(top, intro, stripSlot, banner, devices, controls, note)
  host.replaceChildren(box)

  let screens = new Map<string, HTMLElement>()
  let ticks: HTMLButtonElement[] = []
  let light: (path?: string[]) => void = () => {}

  function buildMode(): void {
    modes.replaceChildren(...MODES.map((m) => {
      const b = el('button', m.id === mode.id ? 'on' : '', m.label)
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-selected', String(m.id === mode.id))
      b.title = m.title
      b.onclick = (): void => { pause(); mode = m; buildMode(); show(0) }
      return b
    }))
    intro.innerHTML = `<b>${mode.title}.</b> ${mode.intro}`
    const s = strip(mode)
    light = s.light
    stripSlot.replaceChildren(s.svg)
    devices.style.gridTemplateColumns = `repeat(${mode.people.length},minmax(0,1fr))`
    screens = new Map()
    devices.replaceChildren(...mode.people.map((p) => {
      const col = el('div', 'wt-dev', `<h4>${p.name}'s device<small>${p.role}</small></h4>`)
      const scr = el('div', 'wt-screen')
      screens.set(p.id, scr)
      col.appendChild(scr)
      return col
    }))
    track.replaceChildren(el('div', 'wt-rail'), fill)
    ticks = mode.steps.map((st, i) => {
      const t = el('button', 'wt-tick')
      t.style.left = `${(i / (mode.steps.length - 1)) * 100}%`
      t.setAttribute('aria-label', `Step ${i + 1}: ${st.title}`)
      t.title = st.title
      t.onclick = (): void => { pause(); show(i) }
      track.appendChild(t)
      return t
    })
    note.textContent = mode.note ?? ''
    note.hidden = !mode.note
  }

  function show(i: number): void {
    index = Math.max(0, Math.min(mode.steps.length - 1, i))
    const s = mode.steps[index]
    banner.innerHTML = `<span class="wt-eyebrow">This happened now</span><h3>${s.title}</h3><p>${s.text}</p>`
    for (const p of mode.people) {
      const scr = screens.get(p.id)
      if (!scr) continue
      const changed = s.changed.includes(p.id)
      scr.innerHTML = (s.screens[p.id] ?? '') + (changed && index > 0 ? '<span class="wt-tag">changed</span>' : '')
      scr.classList.toggle('changed', changed)
      scr.classList.toggle('idle', index > 0 && !changed)
    }
    light(s.path)
    ticks.forEach((t, k) => { t.classList.toggle('on', k === index); t.classList.toggle('done', k < index) })
    fill.style.width = `${(index / (mode.steps.length - 1)) * 100}%`
    count.textContent = `${index + 1} / ${mode.steps.length}`
    prev.disabled = index === 0
    next.disabled = index === mode.steps.length - 1
  }

  function schedule(): void {
    clearTimeout(timer)
    if (!playing) return
    timer = setTimeout(() => {
      if (index >= mode.steps.length - 1) { pause(); return }
      show(index + 1)
      schedule()
    }, speed * 1000)
  }

  function setPlaying(on: boolean): void {
    playing = on
    play.textContent = on ? '❚❚' : '▶'
    play.setAttribute('aria-label', on ? 'Pause' : 'Play')
    schedule()
  }

  function pause(): void { setPlaying(false) }

  play.onclick = (): void => {
    if (!playing && index >= mode.steps.length - 1) show(0)
    setPlaying(!playing)
  }
  prev.onclick = (): void => { pause(); show(index - 1) }
  next.onclick = (): void => { pause(); show(index + 1) }
  box.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'SELECT') return
    if (e.key === 'ArrowRight') { pause(); show(index + 1) }
    if (e.key === 'ArrowLeft') { pause(); show(index - 1) }
  })

  buildMode()
  show(0)
  setPlaying(false)
  return pause
}
