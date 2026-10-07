/**
 * The grant and claim scripts against a fake host: ssh, sudo, systemctl,
 * chown and curl are stand-ins on PATH, and the host's /var/lib and /etc
 * paths are mapped into a temp dir. What is checked is the scripts' own
 * logic: the grant list edits (idempotent, case-insensitive, validated,
 * 0600, SIGHUP), the guards (demo has no grant list, an undeployed unit is
 * refused), the links built from the loopback card, and the claim ceremony's
 * persona instruction and its "already bound" refusal; the personal
 * instance's host is never defaulted; --republish-cards fails loudly when a
 * card cannot be republished (deploy_wot.sh relies on that).
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'

const REPO = path.resolve(import.meta.dirname, '..', '..', '..')
const CARD = { did: 'did:peer:2.Ez6LSfakefakefake.Vz6Mkfakefakefake', id: 'abcDEF123456', name: 'Jakob' }

function fakeHost() {
  const root = mkdtempSync(path.join(tmpdir(), 'twhost-'))
  const bin = path.join(root, 'bin')
  mkdirSync(bin)
  mkdirSync(path.join(root, 'state'))
  const write = (name, body) => { writeFileSync(path.join(bin, name), '#!/bin/sh\n' + body); chmodSync(path.join(bin, name), 0o755) }
  write('ssh', `host="$1"; shift
echo "$host :: $*" >> "${root}/ssh.log"
cmd=$(printf '%s' "$*" | sed -e "s#/var/lib/trustweb-peer-personal#${root}/state#g" -e "s#/var/lib/trustweb-peer#${root}/state#g" -e "s#/etc/trustweb-peer-personal#${root}/etc#g" -e "s#/srv/questhub-static#${root}/srv#g")
exec sh -c "$cmd"
`)
  write('sudo', 'exec "$@"\n')
  write('chown', `echo "chown $*" >> "${root}/calls.log"\n`)
  write('ssh-add', 'exit 0\n')
  write('chcon', `echo "chcon $*" >> "${root}/calls.log"\n`)
  write('systemctl', `echo "systemctl $*" >> "${root}/calls.log"
case "$1" in
  cat) [ -f "${root}/unit-present" ] ;;
  list-units) cat "${root}/active-units" 2>/dev/null || true ;;
  restart) if [ -f "${root}/state/claim-open" ]; then touch "${root}/window"; else rm -f "${root}/window"; fi ;;
esac
`)
  write('curl', `for a in "$@"; do last="$a"; done
case "$last" in
  */card) printf '%s' '${JSON.stringify(CARD)}' ;;
  */health) echo ok ;;
  */status)
    owner=false; [ -f "${root}/owner" ] && owner=true
    win=false; [ -f "${root}/window" ] && win=true
    printf '{"relay":"connected","peers":0,"owner":%s,"forward":%s,"claimOpen":%s,"presetLines":0,"heldLines":0}' "$owner" "$owner" "$win" ;;
esac
`)
  return { root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }
}

function run(script, args, env) {
  return new Promise((resolve) => {
    execFile(path.join(REPO, 'scripts', script), args, { env, cwd: REPO, timeout: 60_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr })
    })
  })
}

describe('trustweb_peer_grant.sh', () => {
  it('lists, adds (idempotent, case-insensitive), removes; writes 0600 and reloads with SIGHUP; validates names', async () => {
    const h = fakeHost()
    writeFileSync(path.join(h.root, 'unit-present'), '')
    const g = (...a) => run('trustweb_peer_grant.sh', ['--instance', 'personal', '--host', 'sebra', ...a], h.env)
    const grants = () => JSON.parse(readFileSync(path.join(h.root, 'state', 'grants.json'), 'utf8')).names

    expect((await g('--list')).stdout).toContain('(nobody granted yet)')
    const add = await g('--add', 'Anna')
    expect(add.code).toBe(0)
    expect(grants()).toEqual(['Anna'])
    expect((statSync(path.join(h.root, 'state', 'grants.json')).mode & 0o777).toString(8)).toBe('600')
    expect(readFileSync(path.join(h.root, 'calls.log'), 'utf8')).toMatch(/systemctl kill -s HUP trustweb-peer-personal/)
    expect(add.stdout).toContain('--link   and hand that link to "Anna"')
    await g('--add', '  anna ')
    await g('--add', 'Ben  Bauer')
    expect(grants()).toEqual(['Anna', 'Ben Bauer'])
    expect((await g('--list')).stdout).toMatch(/ {2}Anna\n {2}Ben Bauer/)
    await g('--remove', 'ANNA')
    expect(grants()).toEqual(['Ben Bauer'])
    const bad = await g('--add', 'x'.repeat(41))
    expect(bad.code).toBe(2)
    expect(bad.stderr).toMatch(/1 to 40 printable/)
    const bad2 = await g('--add', 'a\u0007b')
    expect(bad2.code).toBe(2)
    expect(grants()).toEqual(['Ben Bauer'])
    // whitespace, newlines included, collapses to one space: the name the app would send
    await g('--add', 'Cleo\n Demo')
    expect(grants()).toEqual(['Ben Bauer', 'Cleo Demo'])
    expect(readFileSync(path.join(h.root, 'ssh.log'), 'utf8')).toMatch(/^sebra :: /m)
    rmSync(h.root, { recursive: true })
  }, 60_000)

  it('--link builds the connect link from the loopback card with the app\'s own function', async () => {
    const h = fakeHost()
    writeFileSync(path.join(h.root, 'unit-present'), '')
    const r = await run('trustweb_peer_grant.sh', ['--instance', 'personal', '--host', 'questhub', '--link'], h.env)
    expect(r.code).toBe(0)
    const link = r.stdout.trim().split('\n').pop()
    const u = new URL(link)
    expect(u.origin + u.pathname).toBe('https://app.idea2.site/trustweb/')
    expect(u.searchParams.get('connect')).toBe(CARD.did)
    expect(u.searchParams.get('name')).toBe('Jakob')
    expect(u.searchParams.has('persona')).toBe(false)
    rmSync(h.root, { recursive: true })
  }, 60_000)

  it('a grant list that cannot be read stops the script: it is never replaced by a list of one', async () => {
    const h = fakeHost()
    writeFileSync(path.join(h.root, 'unit-present'), '')
    const file = path.join(h.root, 'state', 'grants.json')
    writeFileSync(file, JSON.stringify({ names: ['Anna', 'Ben'] }))
    chmodSync(file, 0o000)   // the fake sudo runs as this user: cat fails, as a dropped connection or a sudo error would
    const r = await run('trustweb_peer_grant.sh', ['--instance', 'personal', '--host', 'sebra', '--add', 'Cleo'], h.env)
    chmodSync(file, 0o600)
    expect(r.code).not.toBe(0)
    expect(JSON.parse(readFileSync(file, 'utf8')).names).toEqual(['Anna', 'Ben'])
    rmSync(h.root, { recursive: true })
  }, 60_000)

  it('refuses the demo instance (open, no grant list) and an instance that is not deployed', async () => {
    const h = fakeHost()
    const demo = await run('trustweb_peer_grant.sh', ['--instance', 'demo', '--host', 'questhub', '--list'], h.env)
    expect(demo.code).toBe(2)
    expect(demo.stderr).toMatch(/no grant list/)
    const none = await run('trustweb_peer_grant.sh', ['--instance', 'personal', '--host', 'sebra', '--add', 'Anna'], h.env)
    expect(none.code).toBe(1)
    expect(none.stderr).toMatch(/not deployed on sebra/)
    expect(existsSync(path.join(h.root, 'state', 'grants.json'))).toBe(false)
    rmSync(h.root, { recursive: true })
  }, 60_000)
})

describe('trustweb_peer_claim.sh --instance personal', () => {
  it('opens a window, closes the claim file again, and tells him to use his NORMAL TrustWeb', async () => {
    const h = fakeHost()
    const r = await run('trustweb_peer_claim.sh', ['--instance', 'personal', '--host', 'sebra', '--confirm', 'personal'], h.env)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('THIS ACTS ON: the personal front door (trustweb-peer-personal on sebra)')
    expect(r.stdout).toContain('front door: personal (trustweb-peer-personal on sebra)')
    expect(r.stdout).toContain('"claimOpen":true')
    expect(r.stdout).toContain('in YOUR NORMAL TrustWeb')
    expect(r.stdout).toContain('NOT in a demo account tab')
    expect(r.stdout).toMatch(/https:\/\/app\.idea2\.site\/trustweb\/\?connect=did%3Apeer%3A2/)
    expect(existsSync(path.join(h.root, 'state', 'claim-open'))).toBe(false)
    expect(readFileSync(path.join(h.root, 'calls.log'), 'utf8')).toMatch(/systemctl restart trustweb-peer-personal/)
    rmSync(h.root, { recursive: true })
  }, 60_000)

  it('refuses while an owner is bound and names the reset command for that instance and host', async () => {
    const h = fakeHost()
    writeFileSync(path.join(h.root, 'owner'), '')
    const r = await run('trustweb_peer_claim.sh', ['--instance', 'personal', '--host', 'questhub', '--confirm', 'personal'], h.env)
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('--instance personal --host questhub --reset')
    expect(existsSync(path.join(h.root, 'state', 'claim-open'))).toBe(false)
    rmSync(h.root, { recursive: true })
  }, 60_000)
})

describe('a change names its front door and is confirmed before any host is touched', () => {
  it('claim (open, --reset, --close) and deploy (full, --off) refuse without --instance, without confirmation, or with a mismatched --confirm', async () => {
    const h = fakeHost()
    for (const [script, args, code, msg] of [
      ['trustweb_peer_claim.sh', [], 2, /no default for changes/],
      ['trustweb_peer_claim.sh', ['--reset'], 2, /no default for changes/],
      ['trustweb_peer_claim.sh', ['--close'], 2, /no default for changes/],
      ['trustweb_peer_claim.sh', ['--instance', 'demo', '--reset'], 2, /pass --confirm demo/],
      ['trustweb_peer_claim.sh', ['--instance', 'personal', '--host', 'sebra', '--confirm', 'demo'], 2, /--confirm demo does not match --instance personal/],
      ['trustweb_peer_claim.sh', ['--instance', 'demo', '--host', 'sebra', '--status'], 2, /questhub only/],
      ['deploy_trustweb_peer.sh', ['--off'], 2, /no default for changes/],
      ['deploy_trustweb_peer.sh', [], 2, /no default for changes/],
      ['deploy_trustweb_peer.sh', ['--instance', 'personal', '--host', 'sebra', '--off'], 2, /pass --confirm personal/],
      ['deploy_trustweb_peer.sh', ['--instance', 'demo', '--off', '--confirm', 'personal'], 2, /does not match --instance demo/],
    ]) {
      const r = await run(script, args, h.env)
      expect(r.code, `${script} ${args.join(' ')}`).toBe(code)
      expect(r.stderr, `${script} ${args.join(' ')}`).toMatch(msg)
    }
    expect(existsSync(path.join(h.root, 'ssh.log'))).toBe(false)
    rmSync(h.root, { recursive: true })
  }, 120_000)

  it('--status needs no confirmation (read-only)', async () => {
    const h = fakeHost()
    const r = await run('trustweb_peer_claim.sh', ['--instance', 'personal', '--host', 'sebra', '--status'], h.env)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('"claimOpen":false')
    rmSync(h.root, { recursive: true })
  }, 60_000)
})

describe('the personal inventory on the host: created EMPTY, never overwritten by a deploy', () => {
  function initOnFakeHost(h) {
    // the very command deploy_trustweb_peer.sh step 3/6 runs, from the shared lib, through the fake ssh
    return new Promise((resolve) => {
      execFile('bash', ['-c', `. "${path.join(REPO, 'scripts/trustweb_peer_lib.sh')}" && tw_peer_instance personal && RHOST=sebra && rsh "$(tw_peer_inventory_init_cmd)"`],
        { env: h.env }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }))
    })
  }
  it('absent: becomes {"items":[]} with mode 0600 in a 0700 folder; present: byte-identical afterwards', async () => {
    const h = fakeHost()
    const inv = path.join(h.root, 'etc', 'inventory.json')
    expect((await initOnFakeHost(h)).code).toBe(0)
    expect(readFileSync(inv, 'utf8')).toBe('{"items":[]}\n')
    expect((statSync(inv).mode & 0o777).toString(8)).toBe('600')
    expect((statSync(path.join(h.root, 'etc')).mode & 0o777).toString(8)).toBe('700')
    const sent = JSON.stringify({ items: [{ text: 'Spare desk', audience: 'fof', preset: { by: 'Jakob', at: '2026-10-06' } }] }) + '\n'
    writeFileSync(inv, sent)
    expect((await initOnFakeHost(h)).code).toBe(0)
    expect(readFileSync(inv, 'utf8')).toBe(sent)
    rmSync(h.root, { recursive: true })
  }, 60_000)
})

describe('the personal host is never a default', () => {
  it('deploy, claim and grant refuse --instance personal without --host, before touching any host', async () => {
    const h = fakeHost()
    for (const [script, args] of [
      ['deploy_trustweb_peer.sh', ['--instance', 'personal', '--dry-run']],
      ['trustweb_peer_claim.sh', ['--instance', 'personal', '--status']],
      ['trustweb_peer_grant.sh', ['--instance', 'personal', '--list']],
    ]) {
      const r = await run(script, args, h.env)
      expect(r.code, script).toBe(2)
      expect(r.stderr, script).toMatch(/host is your decision: pass --host sebra or --host questhub/)
    }
    expect(existsSync(path.join(h.root, 'ssh.log'))).toBe(false)
    rmSync(h.root, { recursive: true })
  }, 60_000)
})

describe('deploy_trustweb_peer.sh --republish-cards', () => {
  function withDemoActive() {
    const h = fakeHost()
    writeFileSync(path.join(h.root, 'active-units'), 'trustweb-peer.service loaded active running demo\ntrustweb-peer-personal.service loaded active running personal\n')
    writeFileSync(path.join(h.root, 'state', 'demo-peer.json'), JSON.stringify(CARD))
    return h
  }
  it('republishes the demo card, skips the personal one (no public card), reports both', async () => {
    const h = withDemoActive()
    mkdirSync(path.join(h.root, 'srv', 'app-idea2-trustweb'), { recursive: true })
    const r = await run('deploy_trustweb_peer.sh', ['--republish-cards'], h.env)
    expect(r.code).toBe(0)
    expect(JSON.parse(readFileSync(path.join(h.root, 'srv', 'app-idea2-trustweb', 'demo-peer.json'), 'utf8'))).toEqual(CARD)
    expect(r.stdout).toContain('personal: no public card by design')
    expect(r.stdout).toContain('republish: 2 instance(s) handled')
    expect(r.stdout).toContain('app-trustintheweb absent: no card there') // no second app folder on this host: skipped, not a failure
    rmSync(h.root, { recursive: true })
  }, 60_000)
  it('wave 3: the demo card goes into BOTH app folders (app.idea2.site and app.trustintheweb.org) when both exist', async () => {
    const h = withDemoActive()
    mkdirSync(path.join(h.root, 'srv', 'app-idea2-trustweb'), { recursive: true })
    mkdirSync(path.join(h.root, 'srv', 'app-trustintheweb'), { recursive: true })
    const r = await run('deploy_trustweb_peer.sh', ['--republish-cards'], h.env)
    expect(r.code).toBe(0)
    for (const dir of ['app-idea2-trustweb', 'app-trustintheweb']) {
      expect(JSON.parse(readFileSync(path.join(h.root, 'srv', dir, 'demo-peer.json'), 'utf8'))).toEqual(CARD)
    }
    rmSync(h.root, { recursive: true })
  }, 60_000)
  it('fails (non-zero) when a card cannot be republished, so deploy_wot.sh stops instead of losing the card silently', async () => {
    const h = withDemoActive()   // no srv/app-idea2-trustweb dir: the copy fails
    const r = await run('deploy_trustweb_peer.sh', ['--republish-cards'], h.env)
    expect(r.code).not.toBe(0)
    expect(r.stderr).toMatch(/card republish FAILED for trustweb-peer.service \(demo\)/)
    rmSync(h.root, { recursive: true })
  }, 60_000)
  it('nothing active: nothing to do, exit 0', async () => {
    const h = fakeHost()
    const r = await run('deploy_trustweb_peer.sh', ['--republish-cards'], h.env)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('no active front door on questhub')
    rmSync(h.root, { recursive: true })
  }, 60_000)
})
