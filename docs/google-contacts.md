<!-- SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later -->
# Google contacts import

Ideally this is a one-time import. We understand if letting go of Google takes longer, so the sync keeps your contacts in step.

- Where: Settings > Import > Google (`apps/trustweb/src/contacts_sync_view.ts`). Read-only (`contacts.readonly`), in the browser, OAuth code + PKCE; the token stays in the tab (sessionStorage).
- First run: every contact goes through the import preview and the Curate page; nothing reaches your web before you accept it.
- Sync (`google_sync.ts`): later runs fetch only what changed in Google. A field you edited in TrustWeb keeps your value; a contact deleted in Google stays here.
- Client id: the one typed into the Google client id field on this device, else TrustWeb's own `TRUSTWEB_GOOGLE_CLIENT_ID` (`apps/trustweb/src/google_flag.ts`, empty until registered). Automatic sync waits for `GOOGLE_CONTACTS_SYNC_ENABLED` in the same file.
- Leaving Google: TrustWeb exports everything (Settings > Your data).
