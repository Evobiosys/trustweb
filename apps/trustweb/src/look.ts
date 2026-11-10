// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39 small-ui-b: the look of the app (Settings > General > Theme): Default, Sleek (dense, calm greys, thin lines, 13 px, compact; the
 * Tana approach) or Dex-like (soft, white, indigo accent). A look is a CSS-variable overlay on the design tokens (html[data-look]);
 * it sits beside the light/dark choice (theme.ts), never replaces it. The token tables below are what styles.css repeats under
 * "wave 39 small-ui-b"; look.test checks they name real tokens and keep WCAG AA. Pure, no DOM.
 */
export type Look = 'default' | 'sleek' | 'dex'
export const LOOK_KEY = 'tw-look'
export const LOOKS: readonly Look[] = ['default', 'sleek', 'dex']

export function readLook(storage: Pick<Storage, 'getItem'> | null): Look {
  try {
    const v = storage?.getItem(LOOK_KEY) ?? null
    return v !== null && (LOOKS as readonly string[]).includes(v) ? (v as Look) : 'default'
  } catch { return 'default' }
}

/** Default is stored as absent, so the app returns to its own look. */
export function applyLook(look: Look, root: Pick<HTMLElement, 'setAttribute' | 'removeAttribute'>, storage: Pick<Storage, 'setItem' | 'removeItem'> | null): void {
  if (look === 'default') root.removeAttribute('data-look'); else root.setAttribute('data-look', look)
  try { if (look === 'default') storage?.removeItem(LOOK_KEY); else storage?.setItem(LOOK_KEY, look) } catch { /* private mode: lasts until reload */ }
}

type Tokens = Record<string, string>
export interface LookTokens { light: Tokens; dark: Tokens }

/** Sleek: only the differences from tokens.css. --hairline is new (the one border width). */
export const SLEEK_TOKENS: LookTokens = {
  light: {
    '--fs-1': '11.5px', '--fs-2': '13px', '--fs-3': '15px', '--fs-4': '18px', '--fs-5': '22px',
    '--lh-ui': '1.35', '--lh-text': '1.5',
    '--s-2': '6px', '--s-3': '9px', '--s-4': '12px', '--s-5': '18px', '--s-6': '24px',
    '--r-card': '8px', '--r-control': '6px', '--r-chip': '6px', '--r-sheet': '12px',
    '--dur-1': '90ms', '--dur-2': '140ms',
    '--surface-0': '#F7F7F6', '--surface-1': '#FFFFFF', '--surface-2': '#EFEFED', '--raised': '#FFFFFF', '--surface-tab': 'rgba(255,255,255,.96)',
    '--ink': '#1E1E1C', '--ink-2': '#5B5B57', '--ink-3': '#8A8A85',
    '--line': 'rgba(0,0,0,.09)', '--line-strong': 'rgba(0,0,0,.18)',
    '--trust-tint': '#E8F1F0', '--shadow-float': '0 4px 14px rgba(0,0,0,.10)',
    '--hairline': '1px',
  },
  dark: {
    '--fs-1': '11.5px', '--fs-2': '13px', '--fs-3': '15px', '--fs-4': '18px', '--fs-5': '22px',
    '--lh-ui': '1.35', '--lh-text': '1.5',
    '--s-2': '6px', '--s-3': '9px', '--s-4': '12px', '--s-5': '18px', '--s-6': '24px',
    '--r-card': '8px', '--r-control': '6px', '--r-chip': '6px', '--r-sheet': '12px',
    '--dur-1': '90ms', '--dur-2': '140ms',
    '--surface-0': '#171717', '--surface-1': '#1F1F1E', '--surface-2': '#2B2B29', '--raised': '#252524', '--surface-tab': 'rgba(31,31,30,.96)',
    '--ink': '#ECECE8', '--ink-2': '#B4B4AE', '--ink-3': '#85857F',
    '--line': 'rgba(255,255,255,.10)', '--line-strong': 'rgba(255,255,255,.22)',
    '--trust-tint': '#16302E', '--shadow-float': '0 4px 14px rgba(0,0,0,.5)',
    '--hairline': '1px',
  },
}

/** Dex-like: soft white surfaces, an indigo accent, 14 px text, roomy rounded controls. Inspired by the personal CRM Dex, no copy of its design. */
export const DEX_TOKENS: LookTokens = {
  light: {
    '--fs-2': '14px', '--r-card': '12px', '--r-control': '8px', '--r-sheet': '16px',
    '--surface-0': '#F6F6F9', '--surface-1': '#FFFFFF', '--surface-2': '#ECECF3', '--raised': '#FFFFFF', '--surface-tab': 'rgba(255,255,255,.96)',
    '--ink': '#1B1B2B', '--ink-2': '#58586E', '--ink-3': '#8888A0',
    '--line': 'rgba(27,27,43,.10)', '--line-strong': 'rgba(27,27,43,.22)',
    '--trust': '#4B45C4', '--trust-strong': '#3A35A8', '--trust-tint': '#ECEBFB', '--focus': '#4B45C4',
    '--shadow-float': '0 10px 28px rgba(27,27,43,.14)',
  },
  dark: {
    '--fs-2': '14px', '--r-card': '12px', '--r-control': '8px', '--r-sheet': '16px',
    '--surface-0': '#14141C', '--surface-1': '#1C1C27', '--surface-2': '#2A2A39', '--raised': '#232331', '--surface-tab': 'rgba(28,28,39,.96)',
    '--ink': '#EEEEF6', '--ink-2': '#B6B6CC', '--ink-3': '#8686A0',
    '--line': 'rgba(238,238,246,.12)', '--line-strong': 'rgba(238,238,246,.26)',
    '--trust': '#8C86F0', '--trust-strong': '#B5B1FA', '--trust-tint': '#26244A', '--focus': '#8C86F0',
    '--shadow-float': '0 10px 28px rgba(0,0,0,.5)',
  },
}
