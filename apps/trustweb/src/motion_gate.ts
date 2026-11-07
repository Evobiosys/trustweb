// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Motion gate: data-motion="off" on <html> when the person asked for reduced motion, saves data,
// or sits on a slow network. Unknown networks (no navigator.connection) keep motion on.
// The inline boot block (design/boot_theme.inline.js) runs the same rule before first paint.
export type MotionEnv = { reducedMotion: boolean; saveData?: boolean; effectiveType?: string }

const SLOW = ['slow-2g', '2g', '3g']

export function motionAllowed(env: MotionEnv): boolean {
  return !env.reducedMotion && !env.saveData && !(env.effectiveType !== undefined && SLOW.includes(env.effectiveType))
}

type Connection = { saveData?: boolean; effectiveType?: string; addEventListener?: (type: 'change', fn: () => void) => void }

export function installMotionGate(win: Window): void {
  const mq = win.matchMedia('(prefers-reduced-motion: reduce)')
  const conn = (win.navigator as Navigator & { connection?: Connection }).connection
  const apply = (): void => {
    win.document.documentElement.dataset.motion = motionAllowed({ reducedMotion: mq.matches, saveData: conn?.saveData, effectiveType: conn?.effectiveType }) ? 'on' : 'off'
  }
  apply()
  mq.addEventListener('change', apply)
  conn?.addEventListener?.('change', apply)
}
