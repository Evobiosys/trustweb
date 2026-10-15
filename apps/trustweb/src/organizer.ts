/**
 * The organizer page (wave 8, /organizer.html): a desktop page on the app's own host, so /org/* is same origin. Account key in
 * localStorage (trustweb.org.v1); the server keeps the event, the invitee list and three counters, never who the attendees are.
 */
import './styles.css'
import { randomId } from '../../demo/src/crypto'
import { encodeEventLink, decodeEventLink, linkOrigin } from './event_link'
import { newEvent } from './events'
import {
  LANDING, csv, errorWords, eventPayload, limitsLine, mailto, message, parseInvitees, withSrv,
  type OrgEvent, type OrgForm, type OrgLimits,
} from './organizer_rules'

interface Account { org: string; secret: string; name: string }
interface Me { plan: string; limits: OrgLimits; events: OrgEvent[] }
interface Reply { status: number; json: any }

const KEY = 'trustweb.org.v1'
const FIELD_WORDS = { name: 'Give the event a name.', from: 'Set a valid From date and time.', where: 'Say where it happens.', to: 'To must be a valid date, not before From.' }

const style = document.createElement('style')
style.textContent = `
body{display:block;padding:24px 16px 80px}
.org{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:18px;font-size:15px;line-height:1.5}
.org h1{font-family:Optima,Candara,"Gill Sans",sans-serif;font-size:clamp(24px,4.5vw,34px)}
.org h2{font-size:17px;margin-bottom:8px}
.org section{background:var(--card);border-radius:16px;padding:16px 18px;border:1px solid var(--line)}
.org .soft{color:var(--ink-soft);font-size:13.5px}
.org label{display:block;font-size:13px;font-weight:600;margin:10px 0 3px}
.org input,.org textarea{width:100%;font:inherit;padding:8px 10px;border-radius:10px;border:1px solid var(--line);background:var(--linen);color:var(--ink)}
.org textarea{min-height:76px}
.org .row{display:flex;gap:10px;flex-wrap:wrap}.org .row>div{flex:1 1 200px}
.org button{font:inherit;font-weight:700;font-size:14px;border:0;border-radius:999px;padding:8px 16px;cursor:pointer;background:var(--teal);color:#fff}
.org button.alt{background:var(--mist);color:var(--ink)}
.org a.btn{display:inline-block;text-decoration:none;font-weight:700;font-size:14px;border-radius:999px;padding:8px 16px;background:var(--teal);color:#fff}
.org button:focus-visible,.org a:focus-visible,.org input:focus-visible,.org textarea:focus-visible{outline:3px solid var(--electric);outline-offset:2px}
.org .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.org .err{color:var(--warn-ink);margin-top:8px;font-weight:600}
.org .key{font-family:ui-monospace,monospace;font-size:12.5px;word-break:break-all;background:var(--linen);padding:8px 10px;border-radius:10px;margin:6px 0}
.org .card{border-top:1px solid var(--line);padding-top:12px;margin-top:12px}
.org .card .link{font-family:ui-monospace,monospace;font-size:12.5px;white-space:nowrap}
.org .impact{font-weight:700;color:var(--teal);margin:6px 0}
`
document.head.append(style)

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const n = Object.assign(document.createElement(tag), props)
  n.append(...kids)
  return n
}
const button = (text: string, onclick: () => void, alt = false): HTMLButtonElement => el('button', { type: 'button', className: alt ? 'alt' : '', onclick }, text)
const field = (label: string, input: HTMLElement): HTMLElement => el('div', {}, el('label', {}, label), input)
const input = (type = 'text'): HTMLInputElement => el('input', { type })

function load(): Account | null {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return a && typeof a.org === 'string' && typeof a.secret === 'string' ? a : null
  } catch { return null }
}

async function post(path: string, body: unknown): Promise<Reply> {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: r.status, json: r.status === 204 ? null : await r.json().catch(() => null) }
  } catch { return { status: 0, json: null } }
}

let account = load()
let me: Me | null = null
let editing: { id: string; localId: string } | null = null
const copy = (text: string): void => { void navigator.clipboard.writeText(text) }

const root = document.getElementById('org') as HTMLElement
const wrap = el('div', { className: 'org' })
root.append(wrap)

const hero = el('section', {}, el('h1', {}, 'TrustWeb for organizers'), el('p', {}, LANDING), el('p', { className: 'soft' }, 'For organizers: your attendees stay in touch, you see what came out of it.'))
const accountBox = el('section')
const formBox = el('section')
const eventsBox = el('section')
const footer = el('p', { className: 'soft' }, 'This server keeps your event and your invitee list, and three counters. It never knows who your attendees are, what they note or whom they tag.')
wrap.append(hero, accountBox, formBox, eventsBox, footer)

// ---- account
let fresh = false
function renderAccount(): void {
  accountBox.replaceChildren(el('h2', {}, 'Your organizer account'))
  if (!account) {
    const name = input()
    name.maxLength = 80
    const err = el('div', { className: 'err' })
    accountBox.append(field('Name of your organization or yourself', name), el('div', { className: 'actions' }, button('Create account', async () => {
      const n = name.value.trim()
      if (!n) { err.textContent = 'Type a name first.'; return }
      const r = await post('/org', { name: n })
      if (r.status !== 201) { err.textContent = errorWords(r.status, r.json?.error ?? '', { events: 3, invitees: 25 }); return }
      account = { org: r.json.org, secret: r.json.secret, name: n }
      localStorage.setItem(KEY, JSON.stringify(account))
      fresh = true
      renderAll()
      await refresh()
    })), err)
    return
  }
  accountBox.append(el('p', {}, el('b', {}, account.name), me ? ` · ${limitsLine(me.plan, me.limits)}` : ''))
  if (fresh) {
    const key = JSON.stringify({ org: account.org, secret: account.secret })
    accountBox.append(el('p', {}, 'Keep this: it is the only key to your events.'), el('div', { className: 'key' }, key), el('div', { className: 'actions' }, button('Copy', () => copy(key))))
  }
  accountBox.append(el('div', { className: 'actions' }, button('Forget this browser', () => {
    localStorage.removeItem(KEY)
    account = null
    me = null
    fresh = false
    renderAll()
  }, true)))
}

// ---- form
const f = {
  name: input(), from: input('datetime-local'), to: input('datetime-local'), where: input(),
  conditions: el('textarea'), themes: input(), tagName: input(), invitees: el('textarea'),
}
const counter = el('div', { className: 'soft' })
const formErr = el('div', { className: 'err' })
const submit = button('Create event', () => void save())
const cancel = button('Cancel edit', () => { editing = null; resetForm() }, true)
f.tagName.placeholder = 'Default: the event name'
f.invitees.placeholder = 'one e-mail per line'
f.invitees.oninput = () => updateCounter()
formBox.append(
  el('h2', {}, 'New event'),
  field('Name *', f.name),
  el('div', { className: 'row' }, field('From *', f.from), field('To', f.to)),
  field('Where *', f.where), field('Conditions', f.conditions), field('Themes (comma separated)', f.themes),
  field('Tag name (the tag attendees get)', f.tagName), field('Invitees', f.invitees), counter, formErr,
  el('div', { className: 'actions' }, submit, cancel),
)

function updateCounter(): void {
  const n = parseInvitees(f.invitees.value).emails.length
  counter.textContent = `${n} of ${me?.limits.invitees ?? 25}`
}

function resetForm(): void {
  for (const k of ['name', 'from', 'to', 'where', 'conditions', 'themes', 'tagName', 'invitees'] as const) f[k].value = ''
  submit.textContent = 'Create event'
  cancel.hidden = true
  formErr.textContent = ''
  updateCounter()
}

function formValues(): OrgForm {
  return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.value])) as unknown as OrgForm
}

async function save(): Promise<void> {
  formErr.textContent = ''
  if (!account) { formErr.textContent = 'Create your account first.'; return }
  const form = formValues()
  const { emails, bad } = parseInvitees(form.invitees)
  if (bad.length) { formErr.textContent = `Not an e-mail address: ${bad.join(', ')}`; return }
  const limits = me?.limits ?? { events: 3, invitees: 25 }
  if (emails.length > limits.invitees) { formErr.textContent = errorWords(409, 'limit_invitees', limits); return }
  const event = eventPayload(form, account.name)
  const localId = editing?.localId ?? randomId(8)
  const ev = newEvent(event, localId, Date.now())
  if (typeof ev === 'string') { formErr.textContent = FIELD_WORDS[ev]; return }
  const link = encodeEventLink({ ...ev, ...(event.tagName ? { tagName: event.tagName } : {}) }, linkOrigin(location.origin), 'host')
  const auth = { org: account.org, secret: account.secret }
  let r: Reply
  if (editing) r = await post('/org/event', { ...auth, id: editing.id, event, link: withSrv(link, editing.id), invitees: emails })
  else {
    r = await post('/org/event', { ...auth, event, link, invitees: emails })
    if (r.status === 201) r = await post('/org/event', { ...auth, id: r.json.id, event, link: withSrv(link, r.json.id), invitees: emails })
  }
  if (r.status !== 200 && r.status !== 201) { formErr.textContent = errorWords(r.status, r.json?.error ?? '', limits); return }
  editing = null
  resetForm()
  await refresh()
}

// ---- events
function card(e: OrgEvent): HTMLElement {
  const when = e.event.to ? `${e.event.from} to ${e.event.to}` : e.event.from
  const link = el('input', { readOnly: true, value: e.link, className: 'link' })
  link.onfocus = () => link.select()
  return el('div', { className: 'card' },
    el('b', {}, e.event.name), el('div', { className: 'soft' }, `${when} · ${e.event.where}`),
    el('div', { className: 'row' }, el('div', {}, link), button('Copy', () => copy(e.link), true)),
    el('div', { className: 'soft' }, `${e.invitees.length} invitees`),
    el('div', { className: 'impact' }, `opened ${e.counts.opened} · joined ${e.counts.joined} · tagged ${e.counts.tagged}`),
    el('div', { className: 'actions' },
      el('a', { className: 'btn', href: mailto(e.event, e.link, e.invitees) }, 'Send to all'),
      button('Copy message', () => copy(message(e.link)), true),
      button('Edit', () => edit(e), true),
      button('Delete', () => void remove(e), true)))
}

function renderEvents(): void {
  eventsBox.replaceChildren(el('h2', {}, 'Events'))
  if (!account) { eventsBox.append(el('p', { className: 'soft' }, 'Your events appear here.')); return }
  const events = me?.events ?? []
  eventsBox.append(el('div', { className: 'actions' }, button('Refresh', () => void refresh(), true), button('Export CSV', () => download(events), true)))
  if (!events.length) eventsBox.append(el('p', { className: 'soft' }, 'No event yet.'))
  eventsBox.append(...events.map(card))
}

function download(events: OrgEvent[]): void {
  const a = el('a', { href: URL.createObjectURL(new Blob([csv(events)], { type: 'text/csv' })), download: 'trustweb-events.csv' })
  a.click()
  URL.revokeObjectURL(a.href)
}

function edit(e: OrgEvent): void {
  const localId = decodeEventLink(new URL(e.link).hash)?.id ?? randomId(8)
  editing = { id: e.id, localId }
  const v = e.event
  f.name.value = v.name; f.from.value = v.from; f.to.value = v.to ?? ''; f.where.value = v.where
  f.conditions.value = v.conditions ?? ''; f.themes.value = (v.themes ?? []).join(', '); f.tagName.value = v.tagName ?? ''
  f.invitees.value = e.invitees.join('\n')
  submit.textContent = 'Save changes'
  cancel.hidden = false
  updateCounter()
  formBox.scrollIntoView()
}

async function remove(e: OrgEvent): Promise<void> {
  if (!account || !confirm(`Delete "${e.event.name}"? Its link keeps working in the app, but you lose the counters.`)) return
  await post('/org/event', { org: account.org, secret: account.secret, id: e.id, delete: true })
  await refresh()
}

async function refresh(): Promise<void> {
  if (!account) return
  const r = await post('/org/me', { org: account.org, secret: account.secret })
  if (r.status === 200) me = r.json
  else eventsBox.replaceChildren(el('h2', {}, 'Events'), el('div', { className: 'err' }, errorWords(r.status, r.json?.error ?? '', { events: 3, invitees: 25 })))
  if (r.status === 200) renderAll()
}

function renderAll(): void {
  renderAccount()
  renderEvents()
  updateCounter()
}

resetForm()
renderAll()
void refresh()
