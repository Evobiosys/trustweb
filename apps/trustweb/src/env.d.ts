// apps/trustweb has no node_modules of its own: it is built with apps/demo's
// toolchain (see vite.config.mjs), so Vite's client types come from there.
/// <reference path="../../demo/node_modules/vite/client.d.ts" />
/// <reference path="../../demo/src/env.d.ts" />

/** The Web Curator (apps/crm/src/embed.ts, a Svelte app): aliased in vite.config.mjs, loaded lazily, type-checked by the Curator's own `npm run check`. */
declare module '@web-curator' {
  export function mountCurator(el: HTMLElement, lent: { record(): import('./model').AppState | null; setRing(personId: string, ring: string): void }): Promise<void>
  export function mountCuratorPerson(el: HTMLElement, lent: { record(): import('./model').AppState | null; setRing(personId: string, ring: string): void }, personId: string, onclose: () => void, embedded?: boolean): Promise<void>
  export function refreshCurator(): Promise<void>
  export function hideFromRings(lent: unknown, personId: string): Promise<void>
  export function unhideFromRings(lent: unknown, personId: string): Promise<void>
  export function ringFromRings(lent: unknown, personId: string, ring: string): Promise<void>
}

/** The git short sha this build was made from (vite.config.mjs `define`); absent outside Vite (unit tests). */
declare const __APP_VERSION__: string

/** The website the app links to (src/about.ts resolveSiteUrl); set by the app.trustintheweb.org and app.trustweb.one builds only. */
interface ImportMetaEnv {
  readonly VITE_TW_SITE_URL?: string
  /** "1" in a build whose source is public: the "Is this safe?" sheet then also says the code can be read on GitHub. Absent or anything else: the sentence is not in the bundle. */
  readonly VITE_TW_CODE_PUBLIC?: string
}
