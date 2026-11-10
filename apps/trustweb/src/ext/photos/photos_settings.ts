// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 photo-rails: the opt-in row in Settings > Advanced, "Match faces on this device (alpha)". Small and always loaded (the module itself is heavy);
 * the row is only drawn while the Photos module is on. Off unless the owner switches it on; nothing in the app sends a photo anywhere either way.
 */
import { el } from '../../../../demo/src/ui/dom'
import type { AppState } from '../../model'
import { S } from '../../strings'
import { MODULE_ID, parsePhotos } from './photos_data'

export const faceMatchOn = (s: AppState): boolean => parsePhotos(s.extData?.[MODULE_ID]).faceMatch === true

export function faceMatchRow(s: AppState, save: () => void, redraw: () => void): HTMLElement {
  const on = faceMatchOn(s)
  return el('button', {
    class: 'radio' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on), 'aria-pressed': String(on), 'data-photos-face-match': '',
    onclick: () => { s.extData = { ...s.extData, [MODULE_ID]: { ...parsePhotos(s.extData?.[MODULE_ID]), faceMatch: !on } }; save(); redraw() },
  }, [el('b', {}, [S.photos.faceMatch]), el('small', {}, [S.photos.faceMatchHint])])
}
