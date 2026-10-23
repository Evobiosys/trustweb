/** Wave 18 (Jakob 2026-10-23): which face a device opens on. A wide browser tab opens the Desk unless this device chose the phone version. */
export const DESKTOP_KEY = 'trustweb.ui.desktop'
export type DesktopView = 'desk' | 'phone'

export function desktopView(stored: string | null, wide: boolean, embedded: boolean, standalone: boolean): DesktopView {
  return wide && !embedded && !standalone && stored !== 'phone' ? 'desk' : 'phone'
}

/** The Curator sheet may take the whole window (`.desk-wide`) only while the device resolves to the Desk; the phone version keeps it inside the phone. */
export const wideAllowed = (stored: string | null, wide: boolean, embedded: boolean, standalone: boolean): boolean => desktopView(stored, wide, embedded, standalone) === 'desk'
