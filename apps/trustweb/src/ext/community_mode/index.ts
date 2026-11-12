// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 41 community-mode: the Personal | Community interface switch. Small, so not heavy: this stub, the pure rules (mode.ts) and the
 * DOM shell (shell.ts) sit in the main bundle; the Community view itself still loads with the community-mighty module.
 * Off = the app is the Personal shell only, no switch, no notice.
 */
import { S } from '../../strings'
import { EXT_DATA_MERGERS } from '../ext_data'
import type { TwCtx, TwModule } from '../tw_registry'
import { MODE_ID, mergeModeData } from './mode'

EXT_DATA_MERGERS.set(MODE_ID, mergeModeData)

/** main.ts binds the shell's bus subscription before the registry starts; init takes it, dispose gives it back (no subscription while the module is off). */
let attach: ((ctx: TwCtx) => () => void) | null = null
let detach: (() => void) | null = null
export const bindModeShell = (fn: (ctx: TwCtx) => () => void): void => { attach = fn }

export const module: TwModule = {
  id: MODE_ID,
  title: S.mode.title,
  description: S.mode.desc,
  kind: 'view',
  enabledByDefault: true,
  init(ctx) { detach?.(); detach = attach?.(ctx) ?? null },
  dispose() { detach?.(); detach = null },
}
