/**
 * What the Record tab opens for a fresh draft, by where the person came from
 * (owner 2026-10-06, overrides the earlier Settings-only rule):
 *   - from Inventory, or from Meet (the QR / Meet code): a meeting;
 *   - from Web (and the screens that belong to it: Curate, Still true?): just me;
 *   - from anywhere else: what Settings > Recording says.
 * The origin is the screen the person was on when they tapped Record. A note
 * started from a person (the person sheet's "Add a note") is not a Record tap
 * and stays solo. A draft in progress is never switched (main.ts only asks
 * this for a fresh draft). Pure, so the rule is unit-tested as the app runs it.
 */
import { DefaultRecording } from './model'

/** Where a Record tap came from, as far as the rule cares. */
export enum RecordOrigin {
  Web = 'web',
  Inventory = 'inventory',
  Meet = 'meet',
  /** Start, Record or Meeting themselves, Review, Place: Settings decides. */
  Other = 'other',
}

/** The mode a fresh draft opens in, given where the tap came from and the Settings default. */
export function recordModeFor(origin: RecordOrigin, settingsDefault: DefaultRecording): DefaultRecording {
  switch (origin) {
    case RecordOrigin.Inventory:
    case RecordOrigin.Meet:
      return DefaultRecording.Meeting
    case RecordOrigin.Web:
      return DefaultRecording.Solo
    case RecordOrigin.Other:
      return settingsDefault
  }
}
