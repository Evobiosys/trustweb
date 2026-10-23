/** Wave 19 (Jakob 2026-10-23): the views Settings > View and the chevron offer, one naming. Pure. */
import type { Host } from './bridge'
import { View } from './nav'
import { S } from './strings'

export { DEX_URL } from '../../trustweb/src/desktop_view'

/** TrustWeb (the phone app) only inside TrustWeb, where the host lends the way there. */
export const viewChoices = (h: Partial<Pick<Host, 'showPhoneVersion'>>): View[] => [View.Dex, View.Desk, View.Classic, ...(h.showPhoneVersion ? [View.TrustWeb] : [])]

export const viewLabel = (v: View): string => S.views[v]
