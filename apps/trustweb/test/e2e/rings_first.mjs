// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave44c home-default: Home is the first screen (an absent uiViews.webDefault = home). A spec that is about the rings seeds `webDefault: 'rings'`
 * through this one helper: `ringsFirst(browser)` after `chromium.launch(...)` makes every context of that browser store the record with the rings
 * pinned (a record that already names a view keeps it). Specs about anything else drive through the Home tile or the Web tab.
 */
export function ringsFirst(browser) {
  const make = browser.newContext.bind(browser)
  browser.newContext = async (...args) => pinRings(await make(...args))
  return browser
}

/** The same pin for one context made elsewhere (swiss_harness newPhone). */
export async function pinRings(ctx) {
    await ctx.addInitScript(() => {
      const KEY = 'trustweb.v1.me'
      const set = Storage.prototype.setItem
      Storage.prototype.setItem = function (k, v) {
        if (k === KEY && typeof v === 'string') {
          try { const r = JSON.parse(v); if (r && typeof r === 'object') { r.uiViews = { ...(r.uiViews || {}) }; if (!r.uiViews.webDefault) r.uiViews.webDefault = 'rings'; v = JSON.stringify(r) } } catch { /* not a record */ }
        }
        return set.call(this, k, v)
      }
    })
    return ctx
}
