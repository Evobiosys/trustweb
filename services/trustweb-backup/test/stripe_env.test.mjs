// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// scripts/stripe_env_from_keychain.sh against a FAKE `security` on PATH: it exports both keys, prints nothing, and fails closed when an item is missing.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/stripe_env_from_keychain.sh')

function fakeSecurity(items) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakesec-'))
  const body = Object.entries(items).map(([svc, val]) => `[ "$3" = "${svc}" ] && { echo "${val}"; exit 0; }`).join('\n')
  fs.writeFileSync(path.join(dir, 'security'), `#!/bin/sh\n# args: find-generic-password -s <service> -w\n${body}\nexit 44\n`, { mode: 0o755 })
  return dir
}
const run = (dir, cmd) => spawnSync('sh', ['-c', cmd], { env: { PATH: `${dir}:/usr/bin:/bin`, HOME: os.tmpdir() }, encoding: 'utf8' })

test('sourcing exports STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY and prints neither', () => {
  const dir = fakeSecurity({ 'questhub-stripe-test': 'sk_test_FAKE0001', 'questhub-stripe-test-pk': 'pk_test_FAKE0002' })
  const r = run(dir, `. ${SCRIPT} && [ "$STRIPE_SECRET_KEY" = sk_test_FAKE0001 ] && [ "$STRIPE_PUBLISHABLE_KEY" = pk_test_FAKE0002 ] && sh -c 'test -n "$STRIPE_SECRET_KEY"' && echo exported`)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.trim(), 'exported')
  assert.ok(!(r.stdout + r.stderr).includes('FAKE000'))
})

test('a missing item fails closed: nothing exported, a message that names the service but never a value', () => {
  const dir = fakeSecurity({ 'questhub-stripe-test': 'sk_test_FAKE0001' })
  const r = run(dir, `. ${SCRIPT}; echo "rc=$? sk=[$STRIPE_SECRET_KEY] pk=[$STRIPE_PUBLISHABLE_KEY]"`)
  assert.match(r.stdout, /rc=[1-9]\d* sk=\[\] pk=\[\]/)
  assert.match(r.stderr, /questhub-stripe-test-pk/)
  assert.ok(!(r.stdout + r.stderr).includes('FAKE0001'))
})
