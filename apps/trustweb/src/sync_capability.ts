// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43 sync-visibility (Jakob): vault sync (Obsidian/Logseq) shows only on devices that can do it; on a phone the Obsidian and Tana
 * entries sit under Advanced. Pure over an injected environment; `syncEnvFrom` reads the real window/navigator. No imports: apps/mcp loads this
 * file under plain node, so the three phone tests of install.ts (isAndroidAgent, isIosAgent) and layout_pick.ts (isPhone) are repeated here.
 */

export interface SyncEnv { phone: boolean; tauri: boolean }
export type Placement = 'main' | 'advanced'
export interface SyncPlacement { obsidian: Placement; tana: Placement }
export interface SyncCapabilities { localVault: boolean; tana: boolean; placement: SyncPlacement }

interface WinLike { innerWidth?: number; matchMedia?: (q: string) => { matches: boolean } }
interface NavLike { userAgent?: string; maxTouchPoints?: number }

/** A phone = Android/iOS agent, or a coarse pointer on a window under 700 px (layout_pick.isPhone). Absent window/navigator = desktop. */
export function syncEnvFrom(win: WinLike | undefined, nav: NavLike | undefined): SyncEnv {
  const ua = nav?.userAgent ?? ''
  let coarse = false
  try { coarse = win?.matchMedia?.('(pointer: coarse)').matches === true } catch { /* no media query: not coarse */ }
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1)
  const phone = /Android/.test(ua) || ios || (coarse && (win?.innerWidth ?? Infinity) < 700)
  return { phone, tauri: !!win && '__TAURI__' in win }
}

export const syncEnv = (): SyncEnv => syncEnvFrom(typeof window === 'undefined' ? undefined : window, typeof navigator === 'undefined' ? undefined : navigator)

/** A vault is a folder on a computer: desktop browsers and the Tauri shell. */
export const canSyncLocalVault = (env: SyncEnv): boolean => env.tauri || !env.phone

/** The Tana API needs a network and a token only, so every device can; a phone just keeps it under Advanced. */
export const canSyncTana = (_env: SyncEnv): boolean => true

export function syncPlacement(env: SyncEnv): SyncPlacement {
  const where: Placement = env.tauri || !env.phone ? 'main' : 'advanced'
  return { obsidian: where, tana: where }
}

export const syncCapabilities = (env: SyncEnv): SyncCapabilities => ({ localVault: canSyncLocalVault(env), tana: canSyncTana(env), placement: syncPlacement(env) })
