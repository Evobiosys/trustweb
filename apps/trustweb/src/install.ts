/**
 * Install TrustWeb on the home screen (wave 1733, item 5 / contract I3): the
 * web app manifest (pwa/manifest.json, served by vite.config.mjs) and an
 * Install sheet, reachable from Settings and opened by ?install=1 (the
 * website's and the demo's Install button).
 *
 * What each browser gets:
 *   - Chromium with a pending install prompt: an Install button that raises it.
 *   - iPhone / iPad (any browser there): the "Share > Add to Home Screen" steps.
 *     A home-screen app on iOS keeps its own storage, separate from the
 *     browser's (WebKit's rule since iOS 11; confidence 0.8 that it still holds
 *     on every current iOS). So when this browser already holds the person's
 *     web, the sheet says so BEFORE the steps and offers the backup to move it.
 *   - Already running installed: says so.
 *   - Anything else (Firefox, desktop Safari, a Chromium that has not offered
 *     the prompt): the browser menu, said plainly.
 * No service worker: the app had stale-cache trouble before, and Chromium no
 * longer needs one to offer installing.
 */
import { el } from '../../demo/src/ui/dom'
import { S } from './strings'

/** Chromium's install prompt event (not in the DOM typings). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export enum InstallPath {
  /** Running from the home screen already. */
  Installed = 'installed',
  /** Chromium offered its install prompt: one tap. */
  Prompt = 'prompt',
  /** iPhone / iPad: Share > Add to Home Screen. */
  Ios = 'ios',
  /** No prompt here: the browser's own menu, or nothing. */
  Menu = 'menu',
}

/** What the sheet needs to know about the browser it runs in. */
export interface InstallEnv {
  standalone: boolean
  ios: boolean
  promptReady: boolean
}

/** Which way to install applies here. Pure: the order of the checks is the rule. */
export function installPath(env: InstallEnv): InstallPath {
  if (env.standalone) return InstallPath.Installed
  if (env.promptReady) return InstallPath.Prompt
  if (env.ios) return InstallPath.Ios
  return InstallPath.Menu
}

/** iPhone, iPod, or an iPad (which reports itself as a Mac with a touch screen). */
export function isIosAgent(userAgent: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
}

let deferred: InstallPromptEvent | null = null
let installedNow = false
let onChange: (() => void) | null = null

function standalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return installedNow || nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches
}

export function currentEnv(): InstallEnv {
  return { standalone: standalone(), ios: isIosAgent(navigator.userAgent, navigator.maxTouchPoints ?? 0), promptReady: deferred !== null }
}

/**
 * Called once at boot: keeps Chromium's install prompt for the sheet's button
 * (instead of the browser's own mini bar) and links the manifest and the
 * Apple touch icon. `changed` runs when the prompt arrives or the app got installed.
 */
export function setUpInstall(appUrl: string, changed: () => void): void {
  onChange = changed
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    onChange?.()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installedNow = true
    onChange?.()
  })
  const head = document.head
  const link = (rel: string, href: string): void => {
    if (head.querySelector(`link[rel="${rel}"]`)) return
    head.append(el('link', { rel, href }))
  }
  link('manifest', appUrl + 'manifest.json')
  link('apple-touch-icon', appUrl + 'icons/apple-touch-icon.png')
  if (!head.querySelector('meta[name="theme-color"]')) head.append(el('meta', { name: 'theme-color', content: '#3B1163' }))
}

/** Raises Chromium's prompt; the result says what the person chose. */
async function raisePrompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred
  if (!e) return 'unavailable'
  deferred = null
  try {
    await e.prompt()
    return (await e.userChoice).outcome
  } catch {
    return 'unavailable'
  }
}

/** What the sheet can ask of the app around it. */
export interface InstallHooks {
  /** This browser already holds the person's web (people, things or meetings). */
  hasData: boolean
  /** The backup service answers here (null: not known yet). */
  backupAvailable: boolean | null
  /** Takes the person to the backup card, to move their web into the installed app. */
  openBackup: () => void
  /** Redraws the sheet (after the prompt was answered). */
  redraw: () => void
  toast: (msg: string) => void
}

function steps(lines: readonly string[]): HTMLElement {
  return el('ol', { class: 'install-steps' }, lines.map((l) => el('li', {}, [l])))
}

/** The iOS part: first the storage warning (when there is something to move), then the steps. */
function iosPart(h: InstallHooks): (Node | null)[] {
  const move = h.hasData
    ? el('div', { class: 'warn install-move', 'data-install-move': '1' }, [
        el('b', {}, [S.instIosMoveTitle]),
        el('p', {}, [S.instIosMoveBody]),
        h.backupAvailable === false
          ? el('p', {}, [S.instIosMoveNoServer])
          : el('button', { class: 'btn btn-ghost btn-sm', onclick: h.openBackup }, [S.instIosMoveBackup]),
      ])
    : null
  return [move, el('p', { class: 'meta' }, [S.instIosLead]), steps(S.instIosSteps)]
}

/** The Install sheet's content for this browser. */
export function installSheetContent(h: InstallHooks): (Node | null)[] {
  const path = installPath(currentEnv())
  const head = el('h3', {}, [S.instTitle])
  const by = el('p', { class: 'meta' }, [S.instLead])
  switch (path) {
    case InstallPath.Installed:
      return [head, el('p', { class: 'hint', 'data-install-path': path }, [S.instInstalled])]
    case InstallPath.Prompt: {
      const go = async (): Promise<void> => {
        const r = await raisePrompt()
        h.toast(r === 'accepted' ? S.instAccepted : r === 'dismissed' ? S.instDismissed : S.instUnavailable)
        h.redraw()
      }
      return [head, by, el('button', { class: 'btn btn-electric', 'data-install-path': path, onclick: () => void go() }, [S.instButton])]
    }
    case InstallPath.Ios:
      return [head, by, el('div', { 'data-install-path': path }, iosPart(h))]
    case InstallPath.Menu:
      return [head, by, el('div', { 'data-install-path': path }, [el('p', { class: 'meta' }, [S.instMenu]), steps(S.instMenuSteps)])]
  }
}
