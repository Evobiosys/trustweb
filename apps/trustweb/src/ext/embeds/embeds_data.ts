// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 small-ui-c: read and write the embeds slice of the record, and the device-local consent to load Google Docs or Telegram. */
import type { AppState } from '../../model'
import type { TwCtx } from '../tw_registry'
import { MODULE_ID, parseEmbeds, type EmbedsData } from './embeds_model'

export const readEmbeds = (s: AppState): EmbedsData => parseEmbeds(s.extData?.[MODULE_ID])

export function writeEmbeds(ctx: TwCtx, d: EmbedsData): void {
  const s = ctx.store()
  s.extData = { ...s.extData, [MODULE_ID]: d }
  ctx.bus.emit('save')
}

// A consent belongs to the device it was given on: localStorage, never synced.
const CONSENT_KEY = 'trustweb.v1.embeds.consent'
export interface Consent { docs?: true; telegram?: true }

export function readConsent(): Consent {
  try {
    const v = JSON.parse(localStorage.getItem(CONSENT_KEY) ?? '{}') as Record<string, unknown> | null
    return { ...(v?.docs === true ? { docs: true } : {}), ...(v?.telegram === true ? { telegram: true } : {}) }
  } catch { return {} }
}

export function writeConsent(c: Consent): void {
  try { if (c.docs || c.telegram) localStorage.setItem(CONSENT_KEY, JSON.stringify(c)); else localStorage.removeItem(CONSENT_KEY) } catch { /* not kept: the next load asks again */ }
}
