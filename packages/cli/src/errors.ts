// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** A failure the CLI reports as one line on stderr. Exit code 2: the command line was wrong (usage); 1: the request was refused. */
export class CliError extends Error {
  readonly exitCode: number
  constructor(message: string, exitCode = 1) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

export const usage = (message: string): CliError => new CliError(message, 2)
