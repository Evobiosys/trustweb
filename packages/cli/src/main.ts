// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The root command: `trustweb`. Wires the command groups (src/commands) into the tree and runs one line. */
import { execute, type Command, type Io } from './cli.ts'
import { COMMANDS } from './commands/index.ts'

export const VERSION = '0.1.0'

export const ROOT: Command = {
  name: 'trustweb',
  summary: 'trustweb: trust zones, persons, tags and shares of a TrustWeb record, from the command line. Local files only; no network.',
  description: [
    'The record is .trustweb/record.json, found by walking up from the current directory (like git finds .git).',
    'Zones are the TrustWeb ladder: public < intending < acquaintance < community < friend < close < closest < self.',
    'Who sees what is decided by the app\'s own check (apps/trustweb/src/share_sink); the CLI only edits the record it reads.',
  ].join('\n'),
  subcommands: COMMANDS,
  examples: [
    'trustweb init --device laptop',
    'trustweb zone create friend --label "Friends"',
    'trustweb person add ada --name "Ada"',
    'trustweb zone add-person friend ada',
    'trustweb share add bike --zone friend',
    'trustweb show zone friend',
    'trustweb export > record.json',
  ],
}

export const main = (argv: readonly string[], io: Io): Promise<number> => execute(ROOT, argv, io, VERSION)
