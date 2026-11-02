// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The command groups, in the order help lists them. Each file exports one Command (a group with subcommands, or a leaf). */
import type { Command } from '../cli.ts'
import { init } from './init.ts'
import { log } from './log.ts'

export const COMMANDS: readonly Command[] = [init, log]
