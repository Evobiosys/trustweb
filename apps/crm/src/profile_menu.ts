/** The Desk's profile button menu (wave 19): which items show, from what the host lends. Pure. */
import type { Host } from './bridge'

export enum ProfileItem {
  Profile = 'profile',
  Settings = 'settings',
  Phone = 'phone',
  Close = 'close',
}

export function profileItems(h: Partial<Pick<Host, 'renderProfile' | 'showPhoneVersion' | 'closeDesk'>>): ProfileItem[] {
  return [h.renderProfile && ProfileItem.Profile, ProfileItem.Settings, h.showPhoneVersion && ProfileItem.Phone, h.closeDesk && ProfileItem.Close].filter((i): i is ProfileItem => Boolean(i))
}
