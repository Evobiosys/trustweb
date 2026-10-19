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
 * Static on purpose: no relay, no app data, the same every time. Two-hop asks
 * are live in the app since wave 6 (2026-10-08: "How far?" in the ask dock,
 * hops.ts); this page still plays them as a script, and the 3- and 4-person
 * modes say so. Honest about the middle: the answer travels back through the
 * middle person's phone, which does not show it to them (it is not sealed
 * past them yet: roadmap).
 */

enum Tie {
  Close = 'close',
  Friend = 'friend',
  Acquaintance = 'acquaintance',
}

interface Who { id: string; name: string; role: string }
/** `since`: the step from which the tie exists; before it, the strip draws "not connected yet". */
interface Link { a: string; b: string; tie: Tie; since?: number }
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
  /**
   * The same story when the asker chose "Ask only my direct contacts" (wave 3,
   * Settings > Advanced): the ask stops at the friend in the middle, so the
   * "(through Jonas)" answer never comes. Only modes with a second hop have it.
   */
  direct?: Step[]
}

// ----------------------------------------------------------------- screens
const web = (names: string[]): string =>
  `<div class="wt-h">Your TrustWeb</div><div class="wt-rings">${names.length ? names.map((n) => `<span>${n}</span>`).join('') : '<em>Nobody yet</em>'}</div>`
const card = (cls: string, body: string): string => `<div class="wt-card ${cls}">${body}</div>`
const quiet = (body: string): string => `<div class="wt-quiet">${body}</div>`
const ask = (q: string, n: number): string => `<div class="wt-h">Ask your web</div>${card('q', `"${q}"`)}<small>Asked ${n === 1 ? '1 person' : `${n} people`} in your web.</small>`
const waiting = (s: number): string => `<div class="wt-h">Ask your web</div><small>Answers in about ${s} s</small>`
const consent = (who: string, q: string, match: string): string =>
  `<div class="wt-cosmic"><b>${who} asks</b><br>"${q}"<br><small>On this phone, this matches:</small>${card('', match)}<span class="wt-btn">Share these</span><span class="wt-btn ghost">Don't share</span></div>`
const noApp = (body: string): string => `<div class="wt-noapp"><b>No TrustWeb app</b><br>${body}</div>`
/** The friend in the middle: "Pass their asks on", switched on for this friend on their card (off by default since wave 6f). */
const relayYes = (who: string, q: string): string =>
  `<div class="wt-cosmic"><b>${who} asks your friends</b><br>"${q}"<br><small>Pass their asks on: <b>On</b> (he switched it on on their card; it is off by default).</small>${card('ok', 'Passed on. You never see the answer.')}</div>`
/** The asker's screen with the setting on: the ask and the line saying it stops at direct contacts. */
const askDirect = (q: string): string => `${ask(q, 1)}<br><small>${DIRECT_ONLY}</small>`
/** The friend in the middle, with an ask that says "direct contacts only": checked on his phone, never passed on. */
const directHere = (who: string): string =>
  `<div class="wt-cosmic"><b>${who} asks you</b><br><small>${who} asks direct contacts only: checked against your own resources, not passed on to your friends.</small>${card('', 'Nothing of yours matches. Nothing is passed on.')}</div>`
const noMatch = `<div class="wt-h">Ask your web</div>${card('', '<b>No match</b>')}<small>Only your direct contacts were asked.</small>`
const DIRECT_ONLY = 'Ask only my direct contacts: <b>On</b>'
const AISHA_REAL = 'In real life: she just opened a small fund for open-source tools.'
/** The widest tier, as the app names it (wave 2, P22): acquaintances, and through a friend, friends of friends. */
const WIDEST = 'Shared with: acquaintances (and friends of friends, through a friend)'

const LOUDSPEAKERS = 'Loudspeakers'
const POSITION = 'We have a new position to fill'
const FUND = 'Aisha just opened a small fund for open-source tools'

const MODES: Mode[] = [
  {
    id: '2',
    label: '2 people · Ask a friend',
    title: 'Ask a friend',
    intro: 'Your web is the people you have connected with. Jonas meets Maya, they connect with one scan, and later Jonas asks his web for loudspeakers.',
    people: [
      { id: 'jonas', name: 'Jonas', role: 'asks his web' },
      { id: 'maya', name: 'Maya', role: 'can lend loudspeakers' },
    ],
    links: [{ a: 'jonas', b: 'maya', tie: Tie.Friend, since: 2 }],
    steps: [
      {
        title: 'Two people, two phones', changed: [],
        text: 'Jonas and Maya have not met yet. Whatever each of them notes stays on their own phone.',
        screens: { jonas: web([]), maya: web([]) },
      },
      {
        title: 'They meet in person', changed: ['jonas'],
        text: 'They talk over coffee. With Maya\'s yes, Jonas records it for his own notes. The lines it gives start as close friends only, and nothing is shared with anyone.',
        screens: {
          jonas: `<div class="wt-h">Meeting</div>${card('ok', 'Maya agreed to recording the meeting.')}${card('', '<i>Maya:</i> I can lend you my loudspeakers some weekend.')}`,
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
        text: 'One line in her resources (things she could lend or offer), and who may ask about it. Nothing is published anywhere.',
        screens: { jonas: web(['Maya']), maya: `<div class="wt-h">My Resources</div>${card('', `${LOUDSPEAKERS}<br><small>${WIDEST}</small>`)}${card('', 'Spare room in Vienna<br><small>Shared with: nobody</small>')}` },
      },
      {
        title: 'Jonas calls into his web', changed: ['jonas', 'maya'], path: ['jonas', 'maya'],
        text: 'He asks in his own words. The question goes only to people he is connected with.',
        screens: { jonas: ask('Does anyone have loudspeakers I could borrow?', 1), maya: quiet('The ask arrives and is checked on this phone.') },
      },
      {
        title: 'Maya\'s phone finds a match and asks her', changed: ['maya'], path: ['jonas', 'maya'],
        text: 'Only a person can say yes. Maya sees who asks and exactly which line matched. Every answer comes back at one fixed moment, about two minutes after the ask, so a fast or slow reply reveals nothing.',
        screens: { jonas: waiting(24), maya: consent('Jonas', 'Does anyone have loudspeakers...?', LOUDSPEAKERS) },
      },
      {
        title: 'Maya shares', changed: ['maya'], path: ['maya', 'jonas'],
        text: 'Her answer waits for that moment, like every answer, so timing gives nothing away.',
        screens: { jonas: waiting(9), maya: card('ok', 'Shared. It leaves at the fixed moment.') },
      },
      {
        title: 'Jonas gets his answer', changed: ['jonas'], path: ['maya', 'jonas'],
        text: 'He sees what Maya chose to share, and nothing else from her phone.',
        screens: { jonas: `<div class="wt-h">Ask your web</div>${card('ok', `<b>Maya chose to share</b><br>${LOUDSPEAKERS}`)}`, maya: web(['Jonas']) },
      },
      {
        title: 'Not sharing looks the same as having nothing', changed: ['jonas', 'maya'], path: ['jonas', 'maya'],
        text: 'Jonas asks for a spare room. Maya has one noted, shared with nobody, so her phone stays silent and Jonas sees "No match". He cannot tell "nobody had one" from "somebody chose not to share".',
        screens: {
          jonas: `<div class="wt-h">Ask your web</div>${card('q', '"Who has a spare room in Vienna?"')}${card('', '<b>No match</b><br><small>You do not learn why.</small>')}`,
          maya: `${card('', 'Spare room in Vienna<br><small>Shared with: nobody</small>')}${quiet('Silent: nothing leaves this phone.')}`,
        },
      },
    ],
  },
  {
    id: '3',
    label: '3 people · Job lead',
    title: 'A job lead, months after meeting',
    intro: 'Example A from our funding application (Manifund): an acquaintance finds an opening through a friend, without the person in the middle lifting a finger. Jonas is the friend in the middle.',
    note: 'Second-degree query, played as a script: Jonas\'s phone passes it on (he switched that on for Sam; it is off by default), Maya says yes for this ask. In the app this is live: choose "How far?" when you ask.',
    people: [
      { id: 'sam', name: 'Sam', role: 'Jonas\'s acquaintance' },
      { id: 'jonas', name: 'Jonas', role: 'in the middle: passes the ask along and the answer back' },
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
        text: 'She lets acquaintances ask about it, and through a friend, friends of friends. Still nothing is published.',
        screens: { sam: web(['Jonas']), jonas: web(['Sam', 'Maya']), maya: `<div class="wt-h">My Resources</div>${card('', `${POSITION}<br><small>${WIDEST}</small>`)}` },
      },
      {
        title: 'Sam calls into his web', changed: ['sam', 'jonas', 'maya'], path: ['sam', 'jonas', 'maya'],
        text: '"Who is hiring?" It reaches Jonas and, through him, his friends. Jonas\'s phone passes Sam\'s asks on to his friends because he switched "Pass their asks on" on for Sam (it is off by default). He is not asked each time, and the answer is not shown to him.',
        screens: { sam: ask('Who is hiring?', 1), jonas: relayYes('Sam', 'Who is hiring?'), maya: quiet('The ask arrives through Jonas and is checked on this phone.') },
      },
      {
        title: 'Maya\'s phone finds a match and asks her', changed: ['maya'], path: ['jonas', 'maya'],
        text: 'The second yes is Maya\'s. She sees who asks (Sam, an acquaintance of her friend Jonas) and which line matched. She decides whether to answer; her yes is the only way anything leaves.',
        screens: { sam: waiting(24), jonas: web(['Sam', 'Maya']), maya: consent('Sam, through Jonas,', 'Who is hiring?', POSITION) },
      },
      {
        title: 'The answer travels back through Jonas', changed: ['maya', 'jonas'], path: ['maya', 'jonas', 'sam'],
        text: 'Maya shares. Her answer goes back the way the ask came, through Jonas\'s phone, end-to-end encrypted: only Maya and Sam can read it.',
        screens: { sam: waiting(9), jonas: quiet('Carries the answer back to Sam. It is not shown to Jonas.'), maya: card('ok', 'Shared with Sam, through Jonas.') },
      },
      {
        title: 'Sam has a job lead', changed: ['sam'], path: ['jonas', 'sam'],
        text: 'Through a friend of an acquaintance, months after meeting, without anyone broadcasting anything. It was not in Jonas\'s resources but in Maya\'s, and the answer says so: "through Jonas". Next, Sam can ask Jonas for an introduction to Maya.',
        screens: { sam: `<div class="wt-h">Ask your web</div>${card('ok', `<b>Maya chose to share</b> (through Jonas)<br>${POSITION}<br><small>Not in Jonas's resources: in Maya's, his friend's.</small>`)}<small>Next: ask Jonas to introduce you to Maya.</small>`, jonas: web(['Sam', 'Maya']), maya: web(['Jonas']) },
      },
    ],
    direct: [
      {
        title: 'Months ago, Jonas met Sam', changed: [],
        text: 'Sam is an acquaintance of Jonas. Maya is Jonas\'s friend. Sam and Maya have never met. Sam has switched on "Ask only my direct contacts" (Settings > Advanced).',
        screens: { sam: web(['Jonas']), jonas: web(['Sam', 'Maya']), maya: web(['Jonas']) },
      },
      {
        title: 'Maya notes an opening', changed: ['maya'],
        text: 'She lets acquaintances ask about it, and through a friend, friends of friends. Still nothing is published.',
        screens: { sam: web(['Jonas']), jonas: web(['Sam', 'Maya']), maya: `<div class="wt-h">My Resources</div>${card('', `${POSITION}<br><small>${WIDEST}</small>`)}` },
      },
      {
        title: 'Sam calls into his web, direct contacts only', changed: ['sam', 'jonas'], path: ['sam', 'jonas'],
        text: '"Who is hiring?" It reaches Jonas and stops there: the ask says "direct contacts only", so Jonas\'s phone checks his own resources and does not pass it on, whatever his own setting says.',
        screens: { sam: askDirect('Who is hiring?'), jonas: directHere('Sam'), maya: quiet('Nothing reaches Maya.') },
      },
      {
        title: 'Sam sees "No match"', changed: ['sam'], path: ['jonas', 'sam'],
        text: 'Nothing in Jonas\'s own resources matched, so Sam sees "No match". Maya\'s opening stays where it is: an answer "through Jonas" comes only when Sam lets his asks go further.',
        screens: { sam: noMatch, jonas: web(['Sam', 'Maya']), maya: web(['Jonas']) },
      },
    ],
  },
  {
    id: '4',
    label: '4 people · Funder',
    title: 'A funder you have never met, through two friends',
    intro: 'Example B from our funding application (Manifund): a friend finds a fund through your close friend\'s network, someone neither of you knows. Jonas is the friend in the middle.',
    note: 'Played as a script: asks that pass through a second person. In the app this is live: choose "How far?" when you ask.',
    people: [
      { id: 'lena', name: 'Lena', role: 'Jonas\'s friend, open-source project' },
      { id: 'jonas', name: 'Jonas', role: 'in the middle: passes the ask along and the answer back' },
      { id: 'maya', name: 'Maya', role: 'Jonas\'s close friend' },
      { id: 'aisha', name: 'Aisha', role: 'Maya\'s acquaintance, no app' },
    ],
    links: [
      { a: 'lena', b: 'jonas', tie: Tie.Friend },
      { a: 'jonas', b: 'maya', tie: Tie.Close },
      { a: 'maya', b: 'aisha', tie: Tie.Acquaintance },
    ],
    steps: [
      {
        title: 'Four people, three apps', changed: [],
        text: 'Lena works on an open-source project. Aisha does not use TrustWeb at all.',
        screens: { lena: web(['Jonas']), jonas: web(['Lena', 'Maya']), maya: web(['Jonas']), aisha: noApp(AISHA_REAL) },
      },
      {
        title: 'Maya notes what she heard', changed: ['maya'],
        text: 'After meeting Aisha, Maya notes it, for people she regards as friends. Aisha\'s phone is not involved.',
        screens: { lena: web(['Jonas']), jonas: web(['Lena', 'Maya']), maya: `<div class="wt-h">Notes about Aisha</div>${card('', `${FUND}<br><small>${WIDEST}</small>`)}`, aisha: noApp(AISHA_REAL) },
      },
      {
        title: 'Lena calls into her web', changed: ['lena', 'jonas', 'maya'], path: ['lena', 'jonas', 'maya'],
        text: '"Any new open-source funding?" It reaches Jonas and, through him, his close friend Maya. Jonas\'s phone passes Lena\'s questions on because he switched "Pass their asks on" on for her (it is off by default): he is not asked each time, and the answer is not shown to him.',
        screens: { lena: ask('Any new open-source funding?', 1), jonas: quiet('Passed on. Jonas is not asked each time.'), maya: quiet('The ask arrives through Jonas and is checked on this phone.'), aisha: noApp('Nothing reaches Aisha.') },
      },
      {
        title: 'Maya\'s phone finds a match and asks her', changed: ['maya'], path: ['jonas', 'maya'],
        text: 'The match is Maya\'s own note. She sees who asks (Lena, a friend of Jonas) and decides. Aisha is never contacted by anyone\'s phone.',
        screens: { lena: waiting(24), jonas: web(['Lena', 'Maya']), maya: consent('Lena, through Jonas,', 'Any new open-source funding?', FUND), aisha: noApp('Nothing reaches Aisha.') },
      },
      {
        title: 'The answer travels back through Jonas', changed: ['maya', 'jonas'], path: ['maya', 'jonas', 'lena'],
        text: 'Maya shares only what she herself noted. The answer goes back through Jonas, end-to-end encrypted: only Maya and Lena can read it. Lena learns nothing else about Aisha.',
        screens: { lena: waiting(9), jonas: quiet('Carries the answer back to Lena. It is not shown to Jonas.'), maya: card('ok', 'Shared with Lena, through Jonas.'), aisha: noApp(AISHA_REAL) },
      },
      {
        title: 'Lena finds a funder, through Jonas and Maya', changed: ['lena'], path: ['jonas', 'lena'],
        text: 'Lena has never met Aisha, and neither has Jonas. Lena can now ask Jonas to ask Maya for an introduction.',
        screens: { lena: `<div class="wt-h">Ask your web</div>${card('ok', `<b>Maya chose to share</b> (through Jonas)<br>${FUND}`)}<small>Next: ask Jonas to introduce you to Maya.</small>`, jonas: web(['Lena', 'Maya']), maya: web(['Jonas']), aisha: noApp(AISHA_REAL) },
      },
    ],
    direct: [
      {
        title: 'Four people, three apps', changed: [],
        text: 'Lena works on an open-source project. Aisha does not use TrustWeb at all. Lena has switched on "Ask only my direct contacts" (Settings > Advanced).',
        screens: { lena: web(['Jonas']), jonas: web(['Lena', 'Maya']), maya: web(['Jonas']), aisha: noApp(AISHA_REAL) },
      },
      {
        title: 'Maya notes what she heard', changed: ['maya'],
        text: 'After meeting Aisha, Maya notes it, for people she regards as friends. Aisha\'s phone is not involved.',
        screens: { lena: web(['Jonas']), jonas: web(['Lena', 'Maya']), maya: `<div class="wt-h">Notes about Aisha</div>${card('', `${FUND}<br><small>${WIDEST}</small>`)}`, aisha: noApp(AISHA_REAL) },
      },
      {
        title: 'Lena calls into her web, direct contacts only', changed: ['lena', 'jonas'], path: ['lena', 'jonas'],
        text: '"Any new open-source funding?" It reaches Jonas and stops there: the ask says "direct contacts only", so Jonas\'s phone checks his own resources and does not pass it on to Maya.',
        screens: { lena: askDirect('Any new open-source funding?'), jonas: directHere('Lena'), maya: quiet('Nothing reaches Maya.'), aisha: noApp('Nothing reaches Aisha.') },
      },
      {
        title: 'Lena sees "No match"', changed: ['lena'], path: ['jonas', 'lena'],
        text: 'Nothing in Jonas\'s own resources matched, so Lena sees "No match". Maya\'s note about the fund stays where it is: an answer "through Jonas" comes only when Lena lets her asks go further.',
        screens: { lena: noMatch, jonas: web(['Lena', 'Maya']), maya: web(['Jonas']), aisha: noApp(AISHA_REAL) },
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
.wt-direct{font-size:13px;color:var(--soft);display:flex;align-items:center;gap:6px;cursor:pointer}
.wt-direct[hidden]{display:none}
.wt-speed select{font:inherit;border-radius:8px;border:1px solid var(--soft);background:var(--card);color:var(--ink);padding:3px 6px}
.wt-intro{font-size:13.5px;color:var(--soft);margin:0 0 6px;line-height:1.5}
.wt-intro b{color:var(--ink)}
.wt-strip{display:block;width:100%;height:64px;margin:2px 0 0}
.wt-strip .ln.pending{stroke-dasharray:4 6;opacity:.35}
.wt-strip-text{display:none;font-size:13px;font-weight:600;margin:4px 0}
.wt-legend{font-size:11.5px;color:var(--soft);margin:0 0 8px;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center}
.wt-legend .lg{display:inline-block;width:22px;height:0;border-top:3px solid var(--soft);margin-right:4px;vertical-align:middle}
.wt-legend .lg.close{border-top-width:6px}
.wt-legend .lg.acq{border-top-style:dotted}
.wt-legend .lg.route{border-top-color:#9A37F0}
.wt-scripted{font-size:12.5px;font-weight:700;color:var(--ink);background:var(--bg);border-radius:10px;padding:6px 10px;margin:0 0 8px;display:inline-block}
.wt-hint{font-size:12.5px;color:var(--soft);margin:8px 0 0;text-align:center}
@media (max-width:600px){.wt-strip{display:none}.wt-strip-text{display:block}}
.wt-strip text{font:600 12px "Seravek","Avenir Next",system-ui,sans-serif;fill:var(--ink)}
.wt-strip .ln{stroke:var(--soft);opacity:.6}
.wt-strip .ln.on{stroke:#9A37F0;opacity:1}
.wt-strip .nd{fill:var(--bg);stroke:var(--soft);stroke-width:2}
.wt-strip .nd.on{fill:#9A37F0;stroke:#9A37F0}
.wt-banner{display:flex;flex-direction:column;gap:4px;margin-bottom:12px;min-height:7.5em;border-left:4px solid #9A37F0;padding:2px 0 2px 12px}
.wt-banner .wt-eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#9A37F0;font-weight:700}
.wt-banner h3{font-family:"Inter","Seravek","Avenir Next","Segoe UI",system-ui,sans-serif;font-size:20px;font-weight:600;margin:0}
.wt-banner p{font-size:14px;color:var(--soft);line-height:1.5;margin:0}
.wt-devices{display:grid;gap:18px}
.wt-dev{display:flex;flex-direction:column;gap:16px;align-items:stretch;min-width:0}
.wt-dev h4{margin:0;font-size:13.5px;text-align:center}
.wt-dev h4 small{display:block;color:var(--soft);font-weight:400;font-size:11.5px}
.wt-screen{position:relative;min-height:240px;border-radius:22px;background:#F2EBDC;color:#241B2E;padding:28px 12px 14px;overflow:hidden;
  box-shadow:0 0 0 6px #17111e,0 0 0 7px #3a2f47;font-size:12.5px;line-height:1.45;transition:box-shadow .3s,opacity .3s}
.wt-screen.changed{box-shadow:0 0 0 6px #17111e,0 0 0 7px #3a2f47,0 0 0 9px rgba(154,55,240,.6)}
.wt-screen.idle{opacity:.7}
.wt-tag{position:absolute;right:8px;top:8px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:#9A37F0;color:#fff;border-radius:999px;padding:2px 7px;z-index:2}
.wt-h{font-family:"Inter","Seravek","Avenir Next","Segoe UI",system-ui,sans-serif;font-weight:600;font-size:15px;margin-bottom:8px}
.wt-rings{display:flex;flex-wrap:wrap;gap:6px}
.wt-rings span{background:#fff;border-radius:999px;padding:3px 9px;font-weight:600}
.wt-card{background:#fff;border-radius:10px;padding:8px 10px;margin:6px 0}
.wt-card.ok{background:#EAF7F1;border-left:3px solid #4FD7A0}
.wt-card.q{font-weight:600}
.wt-quiet{height:100%;display:grid;place-items:center;text-align:center;color:#5C4F6B;font-style:italic;padding:0 8px}
.wt-noapp{height:100%;display:grid;place-content:center;text-align:center;gap:6px;color:#5C4F6B;border:2px dashed #b9aec4;border-radius:16px;padding:10px}
/* in the flow (not absolute), so a long prompt grows the screen instead of clipping its buttons */
.wt-cosmic{margin:-28px -12px -14px;padding:28px 12px 16px;min-height:240px;border-radius:22px;background:linear-gradient(160deg,#2A0E4E,#3B1163 45%,#0E3A55);color:#EDE6F2}
.wt-cosmic .wt-card{color:#241B2E}
.wt-btn{display:inline-block;margin:6px 6px 0 0;border-radius:999px;padding:5px 10px;background:#4FD7A0;color:#0d3527;font-weight:700;font-size:11.5px}
.wt-btn.ghost{background:transparent;color:#BFE6F7;padding-left:0}
.wt-qr{width:110px;height:110px;margin:6px auto;border-radius:8px;background:repeating-conic-gradient(#241B2E 0 25%,#fff 0 50%) 0 0/22px 22px;box-shadow:inset 0 0 0 8px #fff}
.wt-note{font-size:13px;color:var(--ink);margin:0 0 8px;border-left:3px solid #12A8E3;padding-left:10px}
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
  .wt-screen.changed{box-shadow:0 0 0 6px #0B0710,0 0 0 7px #3A2D4C,0 0 0 9px rgba(190,130,255,.85)}
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
function tieWord(t: Tie): string {
  return t === Tie.Close ? 'close friend' : t
}

function strip(mode: Mode): { el: HTMLElement; light(step: number, path?: string[]): void } {
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
    t.textContent = tieWord(l.tie)
    svg.appendChild(t)
    return { l, ln, t }
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
  // Below 600px the SVG text would be a few pixels tall: a wrapping text line instead.
  const text = el('p', 'wt-strip-text')
  const legend = el('p', 'wt-legend', '<span class="lg close"></span>close friend <span class="lg friend"></span>friend <span class="lg acq"></span>acquaintance <span class="lg route"></span>this step\'s route')
  const wrap = el('div', 'wt-strip-wrap')
  wrap.append(svg, text, legend)
  return {
    el: wrap,
    light(step: number, path?: string[]): void {
      const on = new Set(path ?? [])
      nodes.forEach(({ id, c }) => c.classList.toggle('on', on.has(id)))
      lines.forEach(({ l, ln, t }) => {
        const exists = step >= (l.since ?? 0)
        const i = path ? path.indexOf(l.a) : -1
        const j = path ? path.indexOf(l.b) : -1
        ln.classList.toggle('on', exists && i >= 0 && j >= 0 && Math.abs(i - j) === 1)
        ln.classList.toggle('pending', !exists)
        t.textContent = exists ? tieWord(l.tie) : 'not connected yet'
      })
      text.textContent = mode.people.map((p, k) => {
        const l = mode.links.find((x) => x.a === p.id && mode.people[k + 1]?.id === x.b)
        const tie = l ? (step >= (l.since ?? 0) ? tieWord(l.tie) : 'not connected yet') : ''
        return p.name + (tie ? ` · ${tie} · ` : '')
      }).join('')
    },
  }
}

/** Builds the player into `host`. Returns a function that pauses playback. */
export interface WalkthroughOptions {
  liveHint?: string
  /** Start with the asker's "Ask only my direct contacts" on (the app passes its own setting). Default off. */
  directOnly?: boolean
}

export function mountWalkthrough(host: HTMLElement, opts: WalkthroughOptions = {}): () => void {
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
  let directOnly = opts.directOnly === true
  let timer: ReturnType<typeof setTimeout> | undefined
  /** The steps in force: the direct-contacts-only story where the mode has one and the toggle is on. */
  const steps = (): Step[] => (directOnly && mode.direct ? mode.direct : mode.steps)

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
  speedLbl.append('Autoplay:', speedSel, 'per step')
  // The asker's setting, as a toggle on the walkthrough itself (only the modes with a second hop change).
  const directBox = el('input')
  directBox.type = 'checkbox'
  directBox.checked = directOnly
  directBox.dataset.wtDirect = '1'
  directBox.onchange = (): void => { pause(); directOnly = directBox.checked; buildMode(); show(0) }
  const directLbl = el('label', 'wt-direct')
  directLbl.append(directBox, 'Ask only direct contacts')
  const top = el('div', 'wt-top')
  top.append(modes, directLbl, speedLbl)
  const scripted = el('p', 'wt-scripted', opts.liveHint ?? 'Illustration: these phones are scripted, not live. The real phones are further down the page.')
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
  const hint = el('p', 'wt-hint', 'Press play, or step through with the arrows.')
  box.append(top, scripted, intro, note, stripSlot, banner, devices, controls, hint)
  host.replaceChildren(box)

  let screens = new Map<string, HTMLElement>()
  let ticks: HTMLButtonElement[] = []
  let light: (step: number, path?: string[]) => void = () => {}

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
    stripSlot.replaceChildren(s.el)
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
    ticks = steps().map((st, i) => {
      const t = el('button', 'wt-tick')
      t.style.left = `${(i / (steps().length - 1)) * 100}%`
      t.setAttribute('aria-label', `Step ${i + 1}: ${st.title}`)
      t.title = st.title
      t.onclick = (): void => { pause(); show(i) }
      track.appendChild(t)
      return t
    })
    directLbl.hidden = !mode.direct
    note.textContent = directOnly && mode.direct ? 'Scripted: the asker switched on "Ask only my direct contacts", so the ask stops at the friend in the middle.' : (mode.note ?? '')
    note.hidden = !note.textContent
  }

  function show(i: number): void {
    index = Math.max(0, Math.min(steps().length - 1, i))
    const s = steps()[index]
    banner.innerHTML = `<span class="wt-eyebrow">This happened now</span><h3>${s.title}</h3><p>${s.text}</p>`
    for (const p of mode.people) {
      const scr = screens.get(p.id)
      if (!scr) continue
      const changed = s.changed.includes(p.id)
      scr.innerHTML = (s.screens[p.id] ?? '') + (changed && index > 0 ? '<span class="wt-tag">changed</span>' : '')
      scr.classList.toggle('changed', changed)
      scr.classList.toggle('idle', index > 0 && !changed)
    }
    light(index, s.path)
    hint.hidden = playing || index > 0
    ticks.forEach((t, k) => { t.classList.toggle('on', k === index); t.classList.toggle('done', k < index) })
    fill.style.width = `${(index / (steps().length - 1)) * 100}%`
    count.textContent = `${index + 1} / ${steps().length}`
    prev.disabled = index === 0
    next.disabled = index === steps().length - 1
  }

  function schedule(): void {
    clearTimeout(timer)
    if (!playing) return
    timer = setTimeout(() => {
      if (index >= steps().length - 1) { pause(); return }
      show(index + 1)
      schedule()
    }, speed * 1000)
  }

  function setPlaying(on: boolean): void {
    playing = on
    play.textContent = on ? '❚❚' : '▶'
    play.setAttribute('aria-label', on ? 'Pause' : 'Play')
    hint.hidden = on || index > 0
    schedule()
  }

  function pause(): void { setPlaying(false) }

  play.onclick = (): void => {
    if (!playing && index >= steps().length - 1) show(0)
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
