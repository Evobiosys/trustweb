/**
 * Wave 11 (APK + notifications): the kinds of arrival a person can be told about, each with its own switch under
 * Settings > Notifications, and the one mapping from a wire's envelope type to a kind. No DOM: the app (main.ts notify)
 * and the service worker (sw/sw.ts, which reads waiting wires by itself after a push wake) both decide through here, so a
 * switch that is off here is off everywhere.
 */
import type { NotifyKinds } from './model'

export type NotifyKind = keyof NotifyKinds

export const NOTIFY_KINDS: readonly NotifyKind[] = ['connect', 'ask', 'chat', 'reminder', 'event']

export const ALL_KINDS_ON: NotifyKinds = { connect: true, ask: true, chat: true, reminder: true, event: true }

/** An older record has no per-kind switches: all on, as they were. */
export function kindsOf(s: { notifyKinds?: NotifyKinds }): NotifyKinds {
  return { ...ALL_KINDS_ON, ...(s.notifyKinds ?? {}) }
}

/** The one gate: notifications on at all, and this kind on. */
export function wantsKind(s: { notificationsOn: boolean; notifyKinds?: NotifyKinds; chatsHidden?: boolean }, kind: NotifyKind): boolean {
  // Chat Do Not Disturb (wave 25) silences chat notifications only.
  return s.notificationsOn && kindsOf(s)[kind] && !(kind === 'chat' && s.chatsHidden)
}

/** Which kind a wire's envelope type `t` (apps/demo/src/wire.ts) is about; null: nothing to tell a person (an answer, a ping). */
export function kindOfWire(t: string): NotifyKind | null {
  switch (t) {
    case 'connect': case 'connect-ack': return 'connect'
    case 'query': case 'ask-again': return 'ask'
    case 'chat': return 'chat'
    default: return null
  }
}

/**
 * What the service worker shows for the wires it could read (names are the connections' display names, as stored on this
 * device; a wire from an unknown sender has none). One line per kind, nothing for a kind that is off.
 */
export function workerLines(arrivals: { kind: NotifyKind; name: string | null }[], kinds: NotifyKinds): string[] {
  const lines: string[] = []
  for (const kind of NOTIFY_KINDS) {
    if (kind === 'reminder' || kind === 'event' || !kinds[kind]) continue // a reminder or event notice is this page's own, never a waiting wire
    const of = arrivals.filter((a) => a.kind === kind)
    if (!of.length) continue
    const names = [...new Set(of.map((a) => a.name).filter((n): n is string => Boolean(n)))]
    const who = names.length === 0 ? 'Someone' : names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} others`
    const n = of.length
    if (kind === 'connect') lines.push(n === 1 ? `${who} wants to connect.` : `${who} want to connect.`)
    else if (kind === 'ask') lines.push(n === 1 ? `${who} is sending you a query.` : `${who} sent you ${n} queries.`)
    else lines.push(n === 1 ? `${who} sent you a message.` : `${who} sent you ${n} messages.`)
  }
  return lines
}

/** When a wake arrives but no wire could be read (no keys yet, the drain did not answer in time): one line, if anything is on. */
export const WORKER_FALLBACK = 'Something arrived for you. Open TrustWeb to see it.'
