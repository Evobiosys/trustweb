// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 33: the owner's primary email address and the mail program it lives in. Pure, no DOM.
 * Local only (I1): the address sits on `me`, never in the connect link. A web app cannot choose the sender of a mailto: link,
 * so the provider only picks where "open in <provider>" goes and words the "Sent from" hint.
 */
import { isEmailAddress } from './channel'

export interface PrimaryEmail {
  provider: string
  address: string
}

interface Provider {
  id: string
  label: string
  /** Domain patterns for guessing; a leading "*." is not used, a trailing ".*" matches any TLD. */
  domains: readonly string[]
  /** Documented web compose page, recipient appended URL-encoded; none = plain mailto:. Only Gmail and Outlook document one. */
  compose?: string
}

/** The owner's priority order. */
export const PROVIDERS: readonly Provider[] = [
  { id: 'proton', label: 'Proton', domains: ['proton.me', 'protonmail.com', 'pm.me'] },
  { id: 'gmail', label: 'Gmail', domains: ['gmail.com', 'googlemail.com'], compose: 'https://mail.google.com/mail/?view=cm&to=' },
  { id: 'hotmail-outlook', label: 'Hotmail/Outlook', domains: ['hotmail.*', 'outlook.*', 'live.*'], compose: 'https://outlook.live.com/mail/0/deeplink/compose?to=' },
  { id: 'ik-me', label: 'ik.me (Infomaniak)', domains: ['ik.me'] },
  { id: 'apple-icloud', label: 'Apple Mail (iCloud)', domains: ['icloud.com', 'me.com', 'mac.com'] },
  { id: 'thunderbird', label: 'Thunderbird', domains: [] },
  { id: 'other', label: 'Other', domains: [] },
]

const matches = (domain: string, pattern: string): boolean =>
  pattern.endsWith('.*') ? domain.startsWith(pattern.slice(0, -1)) : domain === pattern

/** Provider id for an address by its domain; Thunderbird has no domain and is never guessed. */
export function guessProvider(address: string): string {
  const domain = address.trim().toLowerCase().split('@')[1] ?? ''
  return PROVIDERS.find((p) => p.domains.some((d) => matches(domain, d)))?.id ?? 'other'
}

/** The address trimmed and lower-cased, or null when it is not a bare address. */
export function validateEmail(input: string): string | null {
  const v = input.trim().toLowerCase()
  return isEmailAddress(v) ? v : null
}

export const providerLabel = (id: string): string => PROVIDERS.find((p) => p.id === id)?.label ?? 'Other'

/** Where "write a mail with <provider>" goes: the provider's web compose page, else mailto:. `to` stays empty on the own card. */
export function composeHref(e: PrimaryEmail, to = ''): string {
  const c = PROVIDERS.find((p) => p.id === e.provider)?.compose
  return c ? c + encodeURIComponent(to) : `mailto:${to}`
}

export const senderHint = (e: PrimaryEmail): string => `Sent from ${e.address} (${providerLabel(e.provider)})`
