/**
 * The installed-app predicate (src/standalone_app.ts, wave 5 item f): display-mode standalone or iOS navigator.standalone
 * means installed; a plain browser tab, or a browser without matchMedia, never does.
 */
import { isStandaloneApp, readStandaloneEnv, runsAsInstalledApp } from '../../src/standalone_app.ts'

describe('isStandaloneApp', () => {
  it('is true for display-mode standalone alone', () => {
    expect(isStandaloneApp({ displayModeStandalone: true, navigatorStandalone: false })).toBe(true)
  })
  it('is true for the iOS home-screen signal alone', () => {
    expect(isStandaloneApp({ displayModeStandalone: false, navigatorStandalone: true })).toBe(true)
  })
  it('is true when both say so', () => {
    expect(isStandaloneApp({ displayModeStandalone: true, navigatorStandalone: true })).toBe(true)
  })
  it('is false in a browser tab (neither signal)', () => {
    expect(isStandaloneApp({ displayModeStandalone: false, navigatorStandalone: false })).toBe(false)
  })
})

describe('readStandaloneEnv', () => {
  const realWindow = globalThis.window
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const setEnv = (win, nav) => {
    globalThis.window = win
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true })
  }
  afterEach(() => {
    if (realWindow === undefined) delete globalThis.window; else globalThis.window = realWindow
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator); else delete globalThis.navigator
  })

  it('reads the display-mode media query and navigator.standalone', () => {
    setEnv({ matchMedia: (q) => ({ matches: q === '(display-mode: standalone)' }) }, { standalone: undefined })
    expect(readStandaloneEnv()).toEqual({ displayModeStandalone: true, navigatorStandalone: false })
    expect(runsAsInstalledApp()).toBe(true)
    setEnv({ matchMedia: () => ({ matches: false }) }, { standalone: true })
    expect(readStandaloneEnv()).toEqual({ displayModeStandalone: false, navigatorStandalone: true })
    expect(runsAsInstalledApp()).toBe(true)
  })
  it('a browser tab reads as not installed', () => {
    setEnv({ matchMedia: () => ({ matches: false }) }, {})
    expect(runsAsInstalledApp()).toBe(false)
  })
  it('a missing or throwing matchMedia reads as a browser tab, never an error', () => {
    setEnv({}, {})
    expect(runsAsInstalledApp()).toBe(false)
    setEnv({ matchMedia: () => { throw new Error('blocked') } }, {})
    expect(runsAsInstalledApp()).toBe(false)
  })
  it('only navigator.standalone === true counts (a truthy string does not)', () => {
    setEnv({ matchMedia: () => ({ matches: false }) }, { standalone: 'yes' })
    expect(runsAsInstalledApp()).toBe(false)
  })
})
