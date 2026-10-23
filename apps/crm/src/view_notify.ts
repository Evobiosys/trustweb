import { View } from './nav'
import type { Host } from './bridge'

/** Tells the host the Curator's face when it changes (and once on mount); standalone there is no host to tell. */
export function viewNotifier(send: Host['viewChanged']): (view: View) => void {
  let last: 'desk' | 'classic' | undefined
  return (view) => {
    if (view === View.TrustWeb) return   // the host's own app, never a Curator face
    const face = view === View.Classic ? 'classic' : 'desk'   // Dex and the TrustWeb Desk: both the wide Desk
    if (face === last) return
    last = face
    send?.(face)
  }
}
