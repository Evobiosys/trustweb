// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 photo-rails: Tools > Images: show / grey out / hide. One setting for this device (like the system-tags switch), applied to every
 * picture the app draws: profile pictures, the Network, the photo grids. Default show. Pure apart from the storage passed in.
 */
export const IMAGE_MODES = ['show', 'grey', 'hide'] as const
export type ImageMode = (typeof IMAGE_MODES)[number]
const KEY = 'trustweb.v1.imagemode'
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const parseImageMode = (v: unknown): ImageMode => ((IMAGE_MODES as readonly unknown[]).includes(v) ? (v as ImageMode) : 'show')

export function readImageMode(st: Store = localStorage): ImageMode {
  try { return parseImageMode(st.getItem(KEY)) } catch { return 'show' }
}

/** Show is the default, so it is stored as nothing. */
export function writeImageMode(m: ImageMode, st: Store = localStorage): void {
  try { if (m === 'show') st.removeItem(KEY); else st.setItem(KEY, m) } catch { /* not remembered */ }
}

export const nextImageMode = (m: ImageMode): ImageMode => IMAGE_MODES[(IMAGE_MODES.indexOf(m) + 1) % IMAGE_MODES.length]

/** The picture to draw: none while hidden (the initials show instead). Grey is a look (CSS on body[data-tw-images]), not a different picture. */
export const pictureUrl = (m: ImageMode, url: string | undefined): string | undefined => (m === 'hide' ? undefined : url)

let current: ImageMode | null = null
/** The mode in force, read from storage once and then kept (the avatar code asks for it once per picture). */
export const imageMode = (): ImageMode => (current ??= readImageMode())

/** Puts the mode on <body data-tw-images> where the CSS grey-out and hide rules read it. */
export function applyImageMode(m: ImageMode = imageMode()): void {
  current = m
  if (typeof document !== 'undefined') document.body.dataset.twImages = m
}

export function setImageMode(m: ImageMode, st: Store = localStorage): void {
  writeImageMode(m, st)
  applyImageMode(m)
}
