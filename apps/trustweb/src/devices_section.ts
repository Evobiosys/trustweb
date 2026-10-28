/** Settings > Devices and backups: device sync where this phone may link devices, the backup card always (it does not depend on Inventory or on device sync). null: the backup service is not there. */
export function devicesSectionChildren<T>(o: { eligible: boolean; devices: () => T[]; backupCard: () => T | null }): (T | null)[] {
  return [...(o.eligible ? o.devices() : []), o.backupCard()]
}
