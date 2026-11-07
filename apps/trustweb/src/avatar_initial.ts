// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The colour of the initial inside an avatar. Pure; web_view.ts applies it. */

/** filled = on the ring's own colour; light = on the two pale ring fills (acquaintances, intending); outlined = no fill (not connected yet): the screen colour shows behind it. */
export type AvatarVariant = 'filled' | 'light' | 'outlined'

const TOKEN: Record<AvatarVariant, string> = { filled: '--on-person', light: '--ring-ink', outlined: '--ink' }

/** A CSS colour that reads a design token, so it follows the theme (light/dark) by itself. */
export const initialColor = (variant: AvatarVariant): string => `var(${TOKEN[variant]})`
