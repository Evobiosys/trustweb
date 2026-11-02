/** Organizer page rules (wave 8): invitee list, link, mail, CSV and limit words. Pure and DOM-free. */
export interface OrgLimits { events: number; invitees: number }
export interface OrgCounts { opened: number; joined: number; tagged: number }
export interface OrgEventFields {
  name: string
  from: string
  where: string
  to?: string
  conditions?: string
  themes?: string[]
  tagName?: string
  organizer?: string
  /** A small png, jpeg or webp data URL (never a remote url: its host would learn who opened the join sheet). */
  logo?: string
}
export interface OrgEvent { id: string; event: OrgEventFields; link: string; invitees: string[]; counts: OrgCounts }
/** The form as typed: every field is text. */
export interface OrgForm { name: string; from: string; to: string; where: string; conditions: string; themes: string; tagName: string; invitees: string }

const ORG_RE = /^[A-Za-z0-9_-]{22}$/
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/
const LOGO_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/
/** The server's cap on event.logo (services/trustweb-backup/organizer.mjs). */
export const MAX_LOGO_CHARS = 8192

/** "Sign in with my key": the key as the page shows it ({"org","secret"}, the stored account shape works too), or null. */
export function parseOrgKey(text: string): { org: string; secret: string } | null {
  let v: unknown
  try { v = JSON.parse(text.trim()) } catch { return null }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null
  const { org, secret } = v as Record<string, unknown>
  return typeof org === 'string' && ORG_RE.test(org) && typeof secret === 'string' && SECRET_RE.test(secret) ? { org, secret } : null
}

/** Is `v` a logo the server takes and the join sheet may show? */
export function logoOk(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_LOGO_CHARS && LOGO_RE.test(v)
}

export const LANDING = 'Ever built rapport at an event and it vanished? Send everyone a link. Stay a resource for each other.'

const EMAIL = /^[^\s@]+@[^\s@]+$/

export function parseInvitees(text: string): { emails: string[]; bad: string[] } {
  const emails: string[] = []
  const bad: string[] = []
  for (const raw of text.split(/[\n\r]+/)) {
    const e = raw.trim().toLowerCase()
    if (!e) continue
    if (!EMAIL.test(e) || e.length > 254) bad.push(e)
    else if (!emails.includes(e)) emails.push(e)
  }
  return { emails, bad }
}

/** The link with the server's event id beside the event in the fragment (not inside the JSON). */
export function withSrv(link: string, id: string): string {
  return `${link.replace(/&srv=[^&]*/, '')}&srv=${id}`
}

/** What the server stores as `event`; empty optional fields stay out. */
export function eventPayload(f: OrgForm, organizer: string): OrgEventFields {
  const themes = [...new Set(f.themes.split(',').map((t) => t.trim()).filter(Boolean))]
  const opt = (k: 'to' | 'conditions' | 'tagName' | 'organizer', v: string): Partial<OrgEventFields> => (v.trim() ? { [k]: v.trim() } : {})
  return { name: f.name.trim(), from: f.from.trim(), where: f.where.trim(), ...opt('to', f.to), ...opt('conditions', f.conditions), ...(themes.length ? { themes } : {}), ...opt('tagName', f.tagName), ...opt('organizer', organizer) }
}

/** The text of the mail and of "Copy message". */
export function message(link: string): string {
  return `${LANDING}\n\n${link}`
}

/** RFC 6068: recipients in Bcc so attendees never see each other. */
export function mailto(ev: Pick<OrgEventFields, 'name'>, link: string, emails: string[]): string {
  const enc = encodeURIComponent
  return `mailto:?bcc=${emails.map(enc).join(',')}&subject=${enc(ev.name)}&body=${enc(message(link).replace(/\n/g, '\r\n'))}`
}

/** A cell, quoted when needed; a leading = + - @ is defused so a spreadsheet does not run it. */
function cell(v: string | number): string {
  const s = /^[=+\-@]/.test(String(v)) ? `'${v}` : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function csv(events: OrgEvent[]): string {
  const rows = events.map((e) => [e.event.name, e.event.from, e.event.where, e.invitees.length, e.counts.opened, e.counts.joined, e.counts.tagged])
  return [['name', 'from', 'where', 'invitees', 'opened', 'joined', 'tagged'], ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

export function limitsLine(plan: string, limits: OrgLimits): string {
  const base = `${plan === 'hosted' ? 'Hosted' : 'Free'} plan: ${limits.events} events, ${limits.invitees} invitees per event.`
  return plan === 'hosted' ? base : `${base} Hosting and support: connect@japossert.com`
}

/** A server refusal in words. */
export function errorWords(status: number, code: string, limits: OrgLimits): string {
  if (status === 409 && code === 'limit_events') return `Your plan allows ${limits.events} events. Delete one, or write to connect@japossert.com for more.`
  if (status === 409 && code === 'limit_invitees') return `Your plan allows ${limits.invitees} invitees per event. Remove some, or write to connect@japossert.com for more.`
  if (status === 403) return 'The server did not accept this key. Forget this browser and create an account, or paste the key you kept.'
  if (status === 429) return 'Too many tries. Wait a minute and try again.'
  if (status === 503) return 'The server is full right now. Write to connect@japossert.com.'
  if (status === 400) return 'The server refused one of the fields. Check the name, dates, place and e-mail addresses.'
  return 'The server could not be reached. Try again in a moment.'
}
