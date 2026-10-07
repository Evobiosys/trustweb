// apps/trustweb has no node_modules of its own: it is built with apps/demo's
// toolchain (see vite.config.mjs), so Vite's client types come from there.
/// <reference path="../../demo/node_modules/vite/client.d.ts" />
/// <reference path="../../demo/src/env.d.ts" />

/** The git short sha this build was made from (vite.config.mjs `define`); absent outside Vite (unit tests). */
declare const __APP_VERSION__: string

/** The website the app links to (src/about.ts resolveSiteUrl); set by the app.trustintheweb.org build only. */
interface ImportMetaEnv {
  readonly VITE_TW_SITE_URL?: string
}
