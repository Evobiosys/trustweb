/**
 * Settings > About (owner 2026-10-06): TrustWeb is presented as part of
 * EvoBioSys, never as a standalone brand. The pages live on the website
 * (idea2.site/trustweb, or trustintheweb.org for the app.trustintheweb.org build; both built by
 * scripts/build_tw_front_door.sh); the app only
 * links to them, each opening in a new tab.
 */
import { el } from '../../demo/src/ui/dom'
import { RECORD_FORMAT } from './model'
import { S } from './strings'

/** The website of the idea2.site build (app.idea2.site/trustweb/), and the fallback. */
export const DEFAULT_SITE_URL = 'https://idea2.site/trustweb/'

/**
 * The website this build links to. A build for another home names it at build time
 * (VITE_TW_SITE_URL=https://trustintheweb.org/ for app.trustintheweb.org, scripts/deploy_wot.sh);
 * anything but a plain https URL ending in "/" (no query, no fragment) falls back to the idea2 site.
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

export function aboutUrl(page: AboutPage): string {
  return `${SITE_URL}${page}.html`
}

function outLink(href: string, label: string, cls: string): HTMLElement {
  return el('a', { class: cls, href, target: '_blank', rel: 'noopener noreferrer' }, [label])
}

/** The About group: "TrustWeb, by EvoBioSys", then FAQ, Feedback, Privacy, Imprint. */
export function aboutGroup(): HTMLElement[] {
  return [
    el('h4', { class: 'eyebrow' }, [S.aboutGroup]),
    el('p', { class: 'meta about-by' }, [S.aboutBy, outLink(EVOBIOSYS_URL, S.aboutEvoBioSys, 'about-org')]),
    el('div', { class: 'about-links' }, ABOUT_PAGES.map((p) => outLink(aboutUrl(p), S.aboutPage[p], 'about-link'))),
    // Smooth updates are the hosted version's promise (P20): which build this is, and which data format it keeps.
    el('p', { class: 'meta about-version', 'data-app-version': appVersion() }, [S.aboutVersion(appVersion(), RECORD_FORMAT)]),
  ]
}
