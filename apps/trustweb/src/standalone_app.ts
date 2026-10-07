/**
 * Is this the INSTALLED app (wave 5, item f; owner 2026-10-07: "when I install it, the show demo content and add a device
 * should no longer be visible, because this is now my personal version")? Installed means the browser runs it as its own
 * window: CSS display-mode standalone (Chromium, desktop and Android), or navigator.standalone (iOS home-screen apps).
 *
 * Deliberately NOT install.ts's own check: that one also counts "the install just happened in THIS tab" (installedNow),
 * and the tab that did the installing is still a browser tab, so the browser's desktop dock must stay there.
 * Pure predicate plus one reader; no state.
 */

/** What the browser says about how this page is shown. */
export interface StandaloneEnv {
  /** matchMedia('(display-mode: standalone)') */
  displayModeStandalone: boolean
  /** navigator.standalone (iOS Safari and its home-screen apps; undefined elsewhere) */
  navigatorStandalone: boolean
}

/** The installed app: either signal alone is enough. A plain browser tab has neither. */
export function isStandaloneApp(env: StandaloneEnv): boolean {
  return env.displayModeStandalone || env.navigatorStandalone
}

/** Reads the two signals; a browser without matchMedia (or one that throws) reads as "a browser tab". */
export function readStandaloneEnv(): StandaloneEnv {
  let displayModeStandalone = false
  try { displayModeStandalone = window.matchMedia('(display-mode: standalone)').matches } catch { /* no matchMedia: a browser tab */ }
  return { displayModeStandalone, navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone === true }
}

/** True when this page runs as the installed app. */
export function runsAsInstalledApp(): boolean {
  return isStandaloneApp(readStandaloneEnv())
}
