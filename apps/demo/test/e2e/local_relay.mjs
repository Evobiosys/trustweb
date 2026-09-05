/**
 * Run one of this directory's e2e harnesses against a RelayServer booted
 * here, on an ephemeral 127.0.0.1 port, instead of the live relay at
 * questhub.eco.
 *
 *   npx tsx test/e2e/local_relay.mjs test/e2e/second_hop.mjs
 *
 * Every harness in this directory already honours `RELAY_ORIGIN`
 * (`process.env.RELAY_ORIGIN || 'https://questhub.eco'`); this only supplies
 * one. Committed because the C-02/F-01 crypto review and its follow-up both
 * needed exactly this and both rebuilt it by hand: a security review must be
 * reproducible without sending anyone's demo traffic over the internet, and
 * "the e2e passed" means less when the far end is a shared server whose state
 * nobody controls.
 *
 * The server is closed on the child's exit, whatever that exit was, so
 * nothing is left listening. Verify with `lsof -nP -iTCP -sTCP:LISTEN`.
 */
import { spawn } from 'node:child_process'
import { RelayServer } from '../../../../packages/transport/src/relay_server.ts'

const target = process.argv[2]
if (!target) {
  console.error('usage: npx tsx test/e2e/local_relay.mjs <harness.mjs>')
  process.exit(2)
}

const relay = new RelayServer()
const { port } = await relay.listen(0, '127.0.0.1')
const origin = `http://127.0.0.1:${port}`
console.log(`local_relay: RelayServer on ${origin}, running ${target}`)

const child = spawn(process.execPath, ['--import', 'tsx', target], {
  stdio: 'inherit',
  env: { ...process.env, RELAY_ORIGIN: origin },
})
const code = await new Promise((resolve) => child.on('exit', resolve))
await relay.close()
process.exit(code ?? 1)
