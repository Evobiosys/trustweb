// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 39 small-ui-b: has the person brought in their own people, beyond what the demo content would add? Pure, no DOM. */

/** More own people (not demo content) than the demo seed holds. Then the demo helpers leave the main flow for Settings > Advanced. */
export function ownDataImported(people: readonly { id: string }[], demoIds: ReadonlySet<string>, seedSize: number): boolean {
  return people.filter((p) => !demoIds.has(p.id)).length > seedSize
}
