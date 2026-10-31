// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 (sovereign-switch): where to ask each service for my data (export) and to delete my account. Best-effort public URLs.
 * `verified: false` = not checked on the build day (2026-10-31: the build sandbox could not reach these sites); the page shows a
 * "check" hint next to those. `email` only where a privacy address is public; else the request is written to nobody and the
 * deletion page is the way in. Fix a link here: one line.
 */
export interface RtbfService {
  id: string
  name: string
  exportUrl?: string
  deleteUrl?: string
  email?: string
  /** Shown instead of a link, e.g. "in the app". */
  note?: string
  verified: boolean
}

export const SERVICES_RTBF: readonly RtbfService[] = [
  { id: 'google', name: 'Google', exportUrl: 'https://takeout.google.com/', deleteUrl: 'https://myaccount.google.com/delete-services-or-account', verified: false },
  { id: 'facebook', name: 'Facebook (Meta)', exportUrl: 'https://accountscenter.facebook.com/info_and_permissions/dyi/', deleteUrl: 'https://www.facebook.com/help/delete_account', verified: false },
  { id: 'instagram', name: 'Instagram (Meta)', exportUrl: 'https://accountscenter.instagram.com/info_and_permissions/dyi/', deleteUrl: 'https://www.instagram.com/accounts/remove/request/permanent/', verified: false },
  { id: 'whatsapp', name: 'WhatsApp (Meta)', note: 'In the app: Settings > Account > Request account info; Delete account.', verified: false },
  { id: 'threads', name: 'Threads (Meta)', exportUrl: 'https://accountscenter.instagram.com/info_and_permissions/dyi/', note: 'Delete in the app: Settings > Account.', verified: false },
  { id: 'linkedin', name: 'LinkedIn', exportUrl: 'https://www.linkedin.com/mypreferences/d/download-my-data', deleteUrl: 'https://www.linkedin.com/mypreferences/d/close-account', verified: false },
  { id: 'x', name: 'X (Twitter)', exportUrl: 'https://x.com/settings/download_your_data', deleteUrl: 'https://x.com/settings/deactivate', verified: false },
  { id: 'tiktok', name: 'TikTok', exportUrl: 'https://www.tiktok.com/setting/download-your-data', note: 'Delete in the app: Settings > Account > Deactivate or delete account.', verified: false },
  { id: 'apple', name: 'Apple', exportUrl: 'https://privacy.apple.com/', deleteUrl: 'https://privacy.apple.com/', verified: false },
  { id: 'microsoft', name: 'Microsoft', exportUrl: 'https://account.microsoft.com/privacy', deleteUrl: 'https://account.live.com/closeaccount.aspx', verified: false },
  { id: 'amazon', name: 'Amazon', exportUrl: 'https://www.amazon.com/hz/privacy-central/data-requests/preview.html', deleteUrl: 'https://www.amazon.com/privacy/data-deletion', verified: false },
  { id: 'spotify', name: 'Spotify', exportUrl: 'https://www.spotify.com/account/privacy/', deleteUrl: 'https://support.spotify.com/article/close-account/', email: 'privacy@spotify.com', verified: false },
  { id: 'telegram', name: 'Telegram', deleteUrl: 'https://my.telegram.org/auth?to=delete', note: 'Export: Telegram Desktop > Settings > Advanced > Export Telegram data.', verified: false },
  { id: 'snapchat', name: 'Snapchat', exportUrl: 'https://accounts.snapchat.com/accounts/downloadmydata', deleteUrl: 'https://accounts.snapchat.com/accounts/delete_account', verified: false },
  { id: 'pinterest', name: 'Pinterest', exportUrl: 'https://www.pinterest.com/settings/privacy', deleteUrl: 'https://www.pinterest.com/settings/account-settings', verified: false },
  { id: 'reddit', name: 'Reddit', exportUrl: 'https://www.reddit.com/settings/data-request', deleteUrl: 'https://www.reddit.com/settings/account', verified: false },
  { id: 'discord', name: 'Discord', exportUrl: 'https://support.discord.com/hc/en-us/articles/360004027692', deleteUrl: 'https://support.discord.com/hc/en-us/articles/212500837', email: 'privacy@discord.com', verified: false },
  { id: 'zoom', name: 'Zoom', exportUrl: 'https://zoom.us/profile', deleteUrl: 'https://zoom.us/account', email: 'privacy@zoom.us', verified: false },
  { id: 'dropbox', name: 'Dropbox', exportUrl: 'https://www.dropbox.com/home', deleteUrl: 'https://www.dropbox.com/account/delete', email: 'privacy@dropbox.com', verified: false },
  { id: 'strava', name: 'Strava', exportUrl: 'https://www.strava.com/athlete/delete_your_account', deleteUrl: 'https://www.strava.com/athlete/delete_your_account', verified: false },
  { id: 'signal', name: 'Signal', note: 'Your messages live on your devices only; Signal keeps little beyond the account. Delete in the app: Settings > Account > Delete account.', verified: false },
]
