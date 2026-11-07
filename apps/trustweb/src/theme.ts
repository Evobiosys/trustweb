// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// The appearance setting: system (follow the OS), light or dark. The inline boot block
// (design/boot_theme.inline.js) reads the same key before first paint.
export type Theme = 'system' | 'light' | 'dark'
export const THEME_KEY = 'tw-theme'
const THEMES: readonly string[] = ['system', 'light', 'dark']

export function readTheme(storage: Pick<Storage, 'getItem'> | null): Theme {
  try {
    const v = storage?.getItem(THEME_KEY) ?? null
    return v !== null && THEMES.includes(v) ? (v as Theme) : 'system'
  } catch { return 'system' }
}

export function applyTheme(theme: Theme, root: Pick<HTMLElement, 'setAttribute'>, storage: Pick<Storage, 'setItem'> | null): void {
  root.setAttribute('data-theme', theme)
  try { storage?.setItem(THEME_KEY, theme) } catch { /* private mode: the choice lasts until reload */ }
}
