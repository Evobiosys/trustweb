// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 (msg-host): what "Chat" on a person's card opens. The asked service, else the one pinned for that person, else the one
 * used last, else the first the person can be reached on (TrustWeb's own chat first). Pure, no DOM; the card row that calls it is
 * its own wave (chat-row). Deep links per service:
 *   trustweb  in-app route (the chat sheet)
 *   geb       https://app.consensu.al/chat?with=<did>   (Geb = Consensual; channel.ts channelLink)
 *   signal    sgnl://signal.me/#p/+E164 or #eu/<code>, https://signal.me/... as fallback (sgnl:// fails silently without the app)
 *   molly     the same sgnl:// link (Molly handles sgnl://); a label, so it can be pinned apart from Signal
 *   whatsapp  https://wa.me/<digits>
 *   matrix    https://matrix.to/#/@user:server (opens Element X where installed; Element X documents no element:// user link)
 */
import { channelLink } from './channel'
import { Channel, type Person } from './model'

export const SERVICES = ['trustweb', 'geb', 'signal', 'molly', 'whatsapp', 'matrix'] as const
export type ServiceId = (typeof SERVICES)[number]

export type ChatTarget =
  | { service: 'trustweb'; route: 'chat'; personId: string }
  | { service: Exclude<ServiceId, 'trustweb'>; href: string; fallback?: string }

type Reachable = Pick<Person, 'id' | 'name' | 'peerId' | 'channels' | 'links' | 'chatPin' | 'chatLast'>

/** The signal.me https link for a person (a typed channel first, then a link on the card), or null. */
function signalHttps(p: Reachable): string | null {
  const v = p.channels?.[Channel.Signal]
  if (v) return channelLink(Channel.Signal, v)
  return p.links?.signal?.startsWith('https://signal.me/') ? p.links.signal : null
}

export function chatTarget(p: Reachable, service: ServiceId): ChatTarget | null {
  switch (service) {
    case 'trustweb':
      return p.peerId ? { service, route: 'chat', personId: p.id } : null
    case 'geb': {
      const v = p.channels?.[Channel.Consensual]
      return v ? { service, href: channelLink(Channel.Consensual, v) } : null
    }
    case 'signal':
    case 'molly': {
      const https = signalHttps(p)
      return https ? { service, href: https.replace(/^https:/, 'sgnl:'), fallback: https } : null
    }
    case 'whatsapp': {
      const v = p.channels?.[Channel.WhatsApp]
      const href = v ? channelLink(Channel.WhatsApp, v) : p.links?.whatsapp
      return href ? { service, href } : null
    }
    case 'matrix': {
      const v = p.channels?.[Channel.Matrix]
      return v ? { service, href: channelLink(Channel.Matrix, v) } : null
    }
  }
}

export const availableServices = (p: Reachable): ServiceId[] => SERVICES.filter((s) => chatTarget(p, s) !== null)

export function openChat(people: readonly Reachable[], personId: string, serviceId?: ServiceId): ChatTarget | null {
  const p = people.find((x) => x.id === personId)
  if (!p) return null
  const order = [serviceId, p.chatPin, p.chatLast, ...SERVICES].filter((s): s is ServiceId => s !== undefined)
  for (const s of order) { const t = chatTarget(p, s); if (t) return t }
  return null
}

/** Remembers the service just opened for this person (this device). */
export function noteUsed(p: Pick<Person, 'chatLast'>, service: ServiceId): void { p.chatLast = service }

/** Pins a service for this person; null unpins. */
export function pinService(p: Pick<Person, 'chatPin'>, service: ServiceId | null): void {
  if (service) p.chatPin = service; else delete p.chatPin
}

/** A pinned home-screen shortcut in the shape of Geb's ShortcutSpec (geb repo, branch wave27/shortcuts); none for the in-app chat. */
export function shortcutSpec(p: Pick<Person, 'id' | 'name'>, t: ChatTarget | null): { id: string; label: string; deepLink: string } | null {
  if (!t || !('href' in t)) return null
  return { id: `tw-${t.service}-${p.id}`, label: p.name.trim().slice(0, 40), deepLink: t.href }
}
