// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c header-cluster (ε): the "Update now" button of the old-QR refusal notice. Pure, injectable; main.ts wires the service-worker
 * registration, the release check (app_update.ts), the reload and the install page (install.ts APK_URL).
 */
export type UpdateNowOutcome = 'reloaded' | 'install-page' | 'latest'

export interface UpdateNowDeps {
  registration: () => Promise<{ update(): Promise<unknown>; waiting?: unknown } | undefined>
  /** True when the server publishes a newer release than the one running. */
  newerRelease: () => Promise<boolean>
  reload: () => Promise<void>
  android: boolean
  openInstallPage: () => void
}

export async function updateNow(d: UpdateNowDeps): Promise<UpdateNowOutcome> {
  const reg = await d.registration().catch(() => undefined)
  await reg?.update().catch(() => undefined)
  if (reg?.waiting || (await d.newerRelease().catch(() => false))) { await d.reload(); return 'reloaded' }
  if (d.android) { d.openInstallPage(); return 'install-page' }
  return 'latest'
}
