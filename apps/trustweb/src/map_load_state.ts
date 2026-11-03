// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Load state of the Map view's world outline (its own lazy chunk): loading until the first render, failed when the chunk cannot load (offline). */
export type MapLoad = 'loading' | 'ready' | 'failed'
export type MapLoadEvent = 'loaded' | 'error' | 'retry'

export function nextMapLoad(state: MapLoad, event: MapLoadEvent): MapLoad {
  if (state === 'loading') return event === 'loaded' ? 'ready' : event === 'error' ? 'failed' : state
  if (state === 'failed' && event === 'retry') return 'loading'
  return state
}
