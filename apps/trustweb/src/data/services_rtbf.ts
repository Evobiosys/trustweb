// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 (sovereign-switch): where to ask each service for my data (export) and to delete my account. Best-effort public URLs.
 * Wave 28 (sovereign-import): the page now IMPORTS from these services, so each entry also carries what the import needs: `estimate`
 * (how long the service takes), `watchFor` (what to look out for), `archivePatterns` + `verifyMarkers` (the verify gate, ported as data
 * from the owner's sovereign-takeout, services.py, researched 2026-07-21) and `mailFrom` (sender domains of the "your export is ready"
 * mail, for the mail watcher: export_watch.ts). `other: true` = under "Other services" (collapsed). Order of SERVICES_RTBF = page order.
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
  /** Under "Other services" (collapsed) instead of the main list. */
  other?: boolean
  /** How long the service usually takes to deliver the archive. Absent: the page shows the generic DEFAULT_ESTIMATE. */
  estimate?: string
  /** What to look out for (shown under the (i)). */
  watchFor?: string[]
  /** Filename patterns of the delivered archive (case-insensitive, `*` wildcard) and the member names a real archive holds. */
  archivePatterns?: string[]
  verifyMarkers?: string[]
  /** `any`: one marker is enough; `all`: every marker; `loose`: only existence + size (plain files, no zip). Absent: any. */
  verifyMode?: 'any' | 'all' | 'loose'
  /** Sender domains of the export-ready mail. Absent: the mail watcher cannot match this service. */
  mailFrom?: string[]
}

export const DEFAULT_ESTIMATE = 'usually 10 min to 2 days'

/** Where the page starts: WhatsApp first (its contacts set up the trust zones), then the big ones. The rest is `other`. */
export const MAIN_ORDER = ['whatsapp', 'google', 'facebook', 'instagram', 'x', 'linkedin', 'amazon', 'spotify', 'reddit'] as const

export const SERVICES_RTBF: readonly RtbfService[] = [
  { id: 'whatsapp', name: 'WhatsApp (Meta)', note: 'In the app: Settings > Account > Request account info; Delete account.', verified: false, estimate: 'minutes for a chat export, about 3 days for the account report', verifyMarkers: ['_chat.txt'], watchFor: ['The contacts come from your phone book and from group member lists in chat exports; WhatsApp does not export a contact list itself.', 'Export a chat "without media" to keep the file small.'] },
  { id: 'google', name: 'Google', exportUrl: 'https://takeout.google.com/', deleteUrl: 'https://myaccount.google.com/deleteaccountoptions', verified: false, estimate: 'minutes to a few hours', archivePatterns: ['takeout-*.zip', 'takeout-*.tgz'], verifyMarkers: ['Takeout/'], mailFrom: ['google.com'], watchFor: ['Tick every product that holds data (My Activity, Access Log Activity too).', 'The link in the mail expires after a few days: download at once.', 'Shared Drive files of others and published content stay: a Takeout does not touch them.'] },
  { id: 'facebook', name: 'Facebook (Meta)', exportUrl: 'https://accountscenter.facebook.com/info_and_permissions/dyi/', deleteUrl: 'https://accountscenter.facebook.com/deletion_and_deactivation', verified: false, estimate: 'minutes to hours', archivePatterns: ['facebook-*.zip'], verifyMarkers: ['personal_information', 'your_'], mailFrom: ['facebookmail.com'], watchFor: ['Choose JSON, not HTML, so TrustWeb can read it.', 'You must be logged in; Meta may ask for your password again.'] },
  { id: 'instagram', name: 'Instagram (Meta)', exportUrl: 'https://accountscenter.instagram.com/info_and_permissions/dyi/', deleteUrl: 'https://accountscenter.instagram.com/deletion_and_deactivation', verified: false, estimate: 'hours to about 2 weeks', archivePatterns: ['instagram-*.zip'], verifyMarkers: ['personal_information', 'your_'], mailFrom: ['mail.instagram.com'], watchFor: ['Choose JSON, not HTML.', 'Can take up to 2 weeks for big accounts.'] },
  { id: 'x', name: 'X (Twitter)', exportUrl: 'https://x.com/settings/download_your_data', deleteUrl: 'https://x.com/settings/deactivate', verified: false, estimate: 'up to 24 hours', archivePatterns: ['twitter-*.zip', 'x-*.zip'], verifyMarkers: ['data/'], mailFrom: ['x.com', 'twitter.com'], watchFor: ['X asks for a code sent to your phone or mail first.', 'Deactivating starts a 30-day window; it is not the same as erasure.'] },
  { id: 'linkedin', name: 'LinkedIn', exportUrl: 'https://www.linkedin.com/mypreferences/d/download-my-data', deleteUrl: 'https://www.linkedin.com/psettings/account-management', verified: false, estimate: 'about 10 minutes (the fast file) to 24 hours (everything)', archivePatterns: ['Basic_LinkedInDataExport_*.zip', 'Complete_LinkedInDataExport_*.zip', 'LinkedInDataExport*.zip'], verifyMarkers: ['Connections.csv', 'Profile.csv'], mailFrom: ['linkedin.com'], watchFor: ['Connections.csv is what sets up your trust zones; it can come first in a quick file.', 'Re-entering your password is needed to confirm.'] },
  { id: 'amazon', name: 'Amazon', exportUrl: 'https://www.amazon.com/hz/privacy-central/data-requests/preview.html', deleteUrl: 'https://www.amazon.com/gp/help/customer/display.html?nodeId=GDK92DNLSGWTV6MP', verified: false, estimate: 'a few days up to 30 days', archivePatterns: ['Your*.zip', 'amazon-data*.zip'], verifyMarkers: ['Your Orders', 'Your_Orders'], verifyMode: 'loose', mailFrom: ['amazon.de', 'amazon.com'], watchFor: ['Names of the files vary; assign a download to Amazon by hand if it is not recognised.', 'Amazon mails a confirmation you must answer within 5 days.'] },
  { id: 'spotify', name: 'Spotify', exportUrl: 'https://www.spotify.com/account/privacy/', deleteUrl: 'https://support.spotify.com/article/close-account/', email: 'privacy@spotify.com', verified: false, estimate: 'up to 30 days (extended streaming history is the slow part)', archivePatterns: ['my_spotify_data*.zip', 'MyData*.zip'], verifyMarkers: ['MyData/', 'Userdata.json'], mailFrom: ['spotify.com'], watchFor: ['Spotify mails a confirmation link first: click it, or nothing starts.', 'Premium must be cancelled before the close-account option shows.'] },
  { id: 'reddit', name: 'Reddit', exportUrl: 'https://www.reddit.com/settings/data-request', deleteUrl: 'https://www.reddit.com/settings/account', verified: false, estimate: 'up to 30 days', archivePatterns: ['export_*.zip', 'reddit_export*.zip'], verifyMarkers: ['comments.csv', 'posts.csv'], mailFrom: ['reddit.com', 'redditmail.com'], watchFor: ['Deleting the account does not delete posted comments: they stay as "[deleted]".'] },
  { id: 'threads', name: 'Threads (Meta)', exportUrl: 'https://accountscenter.instagram.com/info_and_permissions/dyi/', note: 'Delete in the app: Settings > Account.', verified: false, other: true },
  { id: 'tiktok', name: 'TikTok', exportUrl: 'https://www.tiktok.com/setting/download-your-data', note: 'Delete in the app: Settings > Account > Deactivate or delete account.', verified: false, other: true },
  { id: 'apple', name: 'Apple', exportUrl: 'https://privacy.apple.com/', deleteUrl: 'https://privacy.apple.com/', verified: false, other: true },
  { id: 'microsoft', name: 'Microsoft', exportUrl: 'https://account.microsoft.com/privacy', deleteUrl: 'https://account.live.com/closeaccount.aspx', verified: false, other: true },
  { id: 'telegram', name: 'Telegram', deleteUrl: 'https://my.telegram.org/auth?to=delete', note: 'Export: Telegram Desktop > Settings > Advanced > Export Telegram data.', verified: false, other: true },
  { id: 'snapchat', name: 'Snapchat', exportUrl: 'https://accounts.snapchat.com/accounts/downloadmydata', deleteUrl: 'https://accounts.snapchat.com/accounts/delete_account', verified: false, other: true },
  { id: 'pinterest', name: 'Pinterest', exportUrl: 'https://www.pinterest.com/settings/privacy', deleteUrl: 'https://www.pinterest.com/settings/account-settings', verified: false, other: true },
  { id: 'discord', name: 'Discord', exportUrl: 'https://support.discord.com/hc/en-us/articles/360004027692', deleteUrl: 'https://support.discord.com/hc/en-us/articles/212500837', email: 'privacy@discord.com', verified: false, other: true },
  { id: 'zoom', name: 'Zoom', exportUrl: 'https://zoom.us/profile', deleteUrl: 'https://zoom.us/account', email: 'privacy@zoom.us', verified: false, other: true },
  { id: 'dropbox', name: 'Dropbox', exportUrl: 'https://www.dropbox.com/home', deleteUrl: 'https://www.dropbox.com/account/delete', email: 'privacy@dropbox.com', verified: false, other: true },
  { id: 'strava', name: 'Strava', exportUrl: 'https://www.strava.com/athlete/delete_your_account', deleteUrl: 'https://www.strava.com/athlete/delete_your_account', verified: false, other: true },
  { id: 'signal', name: 'Signal', note: 'Your messages live on your devices only; Signal keeps little beyond the account. Delete in the app: Settings > Account > Delete account.', verified: false, other: true },
]

/** The main list, in page order. */
export const mainServices = (list: readonly RtbfService[] = SERVICES_RTBF): RtbfService[] => MAIN_ORDER.flatMap((id) => list.filter((x) => x.id === id && !x.other))

/** The collapsed "Other services". */
export const otherServices = (list: readonly RtbfService[] = SERVICES_RTBF): RtbfService[] => list.filter((x) => x.other)
