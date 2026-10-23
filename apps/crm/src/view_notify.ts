import { View } from './nav'
import type { Host } from './bridge'

/** Tells the host the Curator's face when it changes (and once on mount); standalone there is no host to tell. */
export function viewNotifier(send: Host['viewChanged']): (view: View) => void {
  let last: View | undefined
  return (view) => {
    if (view === last) return
    last = view
    send?.(view)
  }
}
