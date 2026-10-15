import { SHORT_LINK_ORIGINS } from './short_link'

/** The origin event links carry: the page's own when it is a production app host, else the live app, so links open without this device. */
export function linkOrigin(pageOrigin: string): string {
  return SHORT_LINK_ORIGINS.includes(pageOrigin) ? pageOrigin : 'https://app.trustweb.one'
}
