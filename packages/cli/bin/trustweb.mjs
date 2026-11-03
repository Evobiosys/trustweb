#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// The `trustweb` command. Registers the TypeScript hooks, then hands argv to src/main.ts. Exit code = what main returns.
import '../scripts/register.mjs'

const { main } = await import('../src/main.ts')
process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
})
