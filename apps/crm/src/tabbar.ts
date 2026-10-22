/** Settings > Tab bar: how the Curator's bottom bar behaves. */
export enum TabbarMode {
  Always = 'always',
  Hover = 'hover',
  Hidden = 'hidden',
}

export const TABBAR_MODES: readonly TabbarMode[] = [TabbarMode.Always, TabbarMode.Hover, TabbarMode.Hidden]

/** A saved value back to a mode; anything unknown (older prefs have none) is Always. */
export function tabbarMode(x: unknown): TabbarMode {
  return TABBAR_MODES.find((m) => m === x) ?? TabbarMode.Always
}
