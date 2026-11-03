// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** `trustweb init`: a new, empty record in ./.trustweb/record.json (or at --record). Refuses to overwrite one. */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { CommandError, type Command } from '../cli.ts'
import { BARE_ID } from '../ids.ts'
import { DEFAULT_DEVICE, RECORD_ENV, emptyRecord, recordPathIn, saveRecord } from '../record.ts'

export const init: Command = {
  name: 'init',
  summary: 'Create an empty record here (.trustweb/record.json)',
  description: [
    'No zone is set up yet: `trustweb zone create <zone>` switches one on. Public and self are always on.',
    'The device name is written as `by` on every tuple this record writes.',
  ].join('\n'),
  options: [{ name: 'device', kind: 'string', placeholder: '<name>', help: `Who writes here, e.g. laptop -> device:laptop (default ${DEFAULT_DEVICE})` }],
  examples: ['trustweb init', 'trustweb init --device laptop', 'trustweb --record ~/web/record.json init'],
  run(ctx) {
    // The same precedence every other command uses to find the record: --record, then TRUSTWEB_RECORD, then here.
    const given = typeof ctx.options.record === 'string' ? resolve(ctx.io.cwd, ctx.options.record) : ctx.io.env[RECORD_ENV] ?? recordPathIn(ctx.io.cwd)
    if (existsSync(given)) throw new CommandError(`a record already exists at ${given}`)
    const name = typeof ctx.options.device === 'string' ? ctx.options.device : DEFAULT_DEVICE.slice('device:'.length)
    if (!BARE_ID.test(name)) throw new CommandError(`"${name}" is not a valid device name (letters, digits, . _ - @)`)
    const device = name.startsWith('device:') ? name : `device:${name}`
    saveRecord(given, emptyRecord(device, ctx.now))
    ctx.emit({ record: given, device }, [`Created ${given}`, `Writing as ${device}. Next: trustweb zone create friend --label "Friends"`])
  },
}
