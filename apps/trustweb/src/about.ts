/**
 * Settings > About (owner 2026-10-06): TrustWeb is presented as part of
 * EvoBioSys, never as a standalone brand. The pages live on the website
 * (trustintheweb.org, built by
 * scripts/build_tw_front_door.sh); the app only
 * links to them, each opening in a new tab.
 */
import { el } from '../../demo/src/ui/dom'
import { HELP_MAIL } from './help_mail'
import { devEventsFile } from './dev_events'
import { devRecordFile } from './dev_record'
import { SCHEMA_VERSION } from './schema_version'
import { S } from './strings'

/** The website the app links to, and the fallback. */
export const DEFAULT_SITE_URL = 'https://trustintheweb.org/'

/**
 * The website this build links to. A build for another home names it at build time
 * (VITE_TW_SITE_URL, scripts/deploy_wot.sh);
 * anything but a plain https URL ending in "/" (no query, no fragment) falls back to the default.
 */
export function resolveSiteUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return DEFAULT_SITE_URL
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && u.href === raw && raw.endsWith('/') && !u.search && !u.hash ? raw : DEFAULT_SITE_URL
  } catch {
    return DEFAULT_SITE_URL
  }
}

export const SITE_URL = resolveSiteUrl(import.meta.env?.VITE_TW_SITE_URL)
export const EVOBIOSYS_URL = 'https://evobiosys.org/'

/** The website pages Settings links to, in the order they show. */
export enum AboutPage {
  Faq = 'faq',
  Feedback = 'feedback',
  Privacy = 'privacy',
  Imprint = 'imprint',
}

export const ABOUT_PAGES: readonly AboutPage[] = [AboutPage.Faq, AboutPage.Feedback, AboutPage.Privacy, AboutPage.Imprint]

/** The git short sha of this build; "dev" where no build defined it (unit tests). */
export function appVersion(): string {
  return typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : 'dev'
}

/** Feedback is the mail link; the other pages live on the website. */
export function aboutUrl(page: AboutPage): string {
  if (page === AboutPage.Feedback) return HELP_MAIL
  return `${SITE_URL}${page}.html`
}

function outLink(href: string, label: string, cls: string): HTMLElement {
  return el('a', { class: cls, href, target: '_blank', rel: 'noopener noreferrer' }, [label])
}

/** The About group: "TrustWeb, by EvoBioSys", then FAQ, Feedback, Privacy, Imprint. */
export function aboutGroup(): (HTMLElement | null)[] {
  return [
    el('h4', { class: 'eyebrow' }, [S.aboutGroup]),
    el('p', { class: 'meta about-by' }, [S.aboutBy, outLink(EVOBIOSYS_URL, S.aboutEvoBioSys, 'about-org')]),
    el('p', { class: 'meta about-steward' }, [S.aboutSteward]),
    el('div', { class: 'about-links' }, ABOUT_PAGES.map((p) => outLink(aboutUrl(p), S.aboutPage[p], 'about-link'))),
    // Smooth updates are the hosted version's promise (P20): which build this is, and which data format it keeps.
    el('p', { class: 'meta about-version', 'data-app-version': appVersion() }, [S.aboutVersion(appVersion(), SCHEMA_VERSION)]),
    devRecordFile() ? el('p', { class: 'meta about-dev-record' }, [`dev record: ${devRecordFile()}`]) : null,
    devEventsFile() ? el('p', { class: 'meta about-dev-events' }, [`dev events: ${devEventsFile()?.events.length}`]) : null,
  ]
}
