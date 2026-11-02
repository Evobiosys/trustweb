// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The CLI end to end on an in-memory Io: every subcommand, its --help, its output and its exit codes. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { COMMANDS } from '../src/commands.ts'
import { DEFAULT_RECORD, VERSION, helpFor, run } from '../src/cli.ts'
import { parseRecord } from '../src/record.ts'
import { LATER, NOW, cli, memIo, seeded } from './helpers.mjs'

const record = (io, path = DEFAULT_RECORD) => parseRecord(io.files[path])
const ok = (r) => { assert.equal(r.code, 0, r.err); return r }

// ------------------------------------------------------------------------------------------------ help

test('every subcommand has --help (and help <cmd>, and -h): usage line, description, global options; exit 0', () => {
  const names = Object.keys(COMMANDS)
  assert.equal(names.length, 21)
  for (const name of names) {
    const words = name.split(' ')
    const a = ok(cli(memIo(), ...words, '--help'))
    assert.ok(a.out.startsWith(`usage: trustweb ${name}`), name)
    assert.match(a.out, /global options:\n {2}--record <path>/)
    assert.ok(a.out.includes(COMMANDS[name].details), name)
    for (const [flag] of COMMANDS[name].options ?? []) assert.ok(a.out.includes(flag), `${name} documents ${flag}`)
    assert.equal(ok(cli(memIo(), 'help', ...words)).out, a.out)
    assert.equal(ok(cli(memIo(), ...words, '-h')).out, a.out)
    assert.equal(a.err, '')
  }
})

test('every flag a command reads is documented in its help', () => {
  for (const [name, c] of Object.entries(COMMANDS)) {
    for (const flag of Object.keys(c.flags ?? {})) {
      const shown = (c.options ?? []).some(([f]) => f.startsWith(`--${flag}`) || f.startsWith(`-${flag} `))
      assert.ok(shown, `${name} --${flag}`)
    }
  }
})

test('top help and group help list every command; no arguments shows top help', () => {
  const top = ok(cli(memIo())).out
  assert.equal(ok(cli(memIo(), '--help')).out, top)
  assert.equal(ok(cli(memIo(), 'help')).out, top)
  assert.equal(helpFor([]), top)
  for (const name of Object.keys(COMMANDS).filter((n) => !n.includes(' '))) assert.match(top, new RegExp(`\\n  ${name} `))
  for (const group of ['zone', 'person', 'tag']) {
    assert.match(top, new RegExp(`\\n  ${group} <command>`))
    const g = ok(cli(memIo(), group)).out
    assert.equal(ok(cli(memIo(), group, '--help')).out, g)
    assert.equal(ok(cli(memIo(), 'help', group)).out, g)
    for (const sub of Object.keys(COMMANDS).filter((n) => n.startsWith(`${group} `))) assert.match(g, new RegExp(`\\n  ${sub.split(' ')[1]} `))
  }
})

test('--version prints the package version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(VERSION, pkg.version)
  assert.equal(ok(cli(memIo(), '--version')).out, `trustweb ${VERSION}\n`)
  assert.equal(ok(cli(memIo(), '-v')).out, `trustweb ${VERSION}\n`)
})

test('usage errors exit 2 with one line and a pointer to help', () => {
  const io = memIo()
  ok(cli(io, 'init'))
  const cases = [
    [['nope'], /unknown command 'nope'/],
    [['constructor'], /unknown command 'constructor'/],
    [['toString', 'x'], /unknown command 'toString'/],
    [['help', 'constructor'], /no help for 'constructor'/],
    [['zone', 'nope'], /unknown command 'zone nope'/],
    [['zone', '--json'], /zone needs a command/],
    [['--record', 'x.json'], /name a command/],
    [['--', 'init'], /name a command/],
    [['help', 'nope'], /no help for 'nope'/],
    [['init', 'extra'], /init takes 0 arguments, got 1/],
    [['zone', 'show'], /zone show takes 1 argument, got 0/],
    [['zone', 'add', 'friend'], /zone add takes at least 2 arguments, got 1/],
    [['tag', 'nest', 'a'], /tag nest takes 2 arguments, got 1/],
    [['zone', 'list', '--nope'], /unknown option --nope/],
    [['zone', 'create', 'crew'], /needs --level/],
    [['share', 'bike'], /needs --zone/],
    [['zone', 'list', '--now', 'soon'], /--now "soon" is not a date/],
    [['sees', 'friend', '--json', '--md'], /choose one of --json and --md/],
    [['export', '--format', 'xml'], /--format must be json or jsonl/],
    [['log', '-n', '0'], /-n takes a positive whole number/],
  ]
  for (const [argv, pattern] of cases) {
    const r = cli(io, ...argv)
    assert.equal(r.code, 2, argv.join(' '))
    assert.match(r.err, pattern, argv.join(' '))
    assert.match(r.err, /^trustweb: .*\nsee: trustweb --help\n$/)
    assert.equal(r.out, '')
  }
})

test('a refusal exits 1 with one line; an unexpected failure too', () => {
  const r = cli(memIo(), 'zone', 'list')
  assert.equal(r.code, 1)
  assert.equal(r.err, `trustweb: no record at ${DEFAULT_RECORD}; run: trustweb init\n`)
  const broken = memIo()
  broken.exists = () => true
  broken.readFile = () => { throw new Error('EACCES: permission denied') }
  const b = cli(broken, 'zone', 'list')
  assert.equal(b.code, 1)
  assert.match(b.err, /^trustweb: trustweb-record.json: EACCES: permission denied\n$/)
  const thrower = memIo()
  thrower.out = () => { throw new TypeError('stdout closed') }
  assert.equal(run(['--version'], thrower), 1)
  assert.equal(thrower.stderr, 'trustweb: stdout closed\n')
})

// ------------------------------------------------------------------------------------------------ record file

test('init creates the record; refuses to overwrite; --force archives the old one first', () => {
  const io = memIo()
  assert.equal(ok(cli(io, 'init')).out, `created ${DEFAULT_RECORD} with 7 built-in zones\n`)
  const r = record(io)
  assert.equal(r.device, 'device:cli')
  assert.equal(r.zones[0].createdAt, NOW)
  const again = cli(io, 'init')
  assert.equal(again.code, 1)
  assert.match(again.err, /record exists at trustweb-record.json \(use --force/)
  const forced = ok(cli(io, 'init', '--force', '--device', 'laptop'))
  assert.equal(forced.out, `moved the old record to archive/${DEFAULT_RECORD}.1\ncreated ${DEFAULT_RECORD} with 7 built-in zones\n`)
  assert.equal(record(io).device, 'device:laptop')
  assert.ok(io.files[`archive/${DEFAULT_RECORD}.1`])
  assert.equal(cli(io, 'init', '--force', '--device', 'Bad').code, 2)
})

test('the record path: --record, else $TRUSTWEB_RECORD, else the default; flags may come before the command', () => {
  const io = memIo({ env: { TRUSTWEB_RECORD: 'env.json' } })
  ok(cli(io, 'init'))
  ok(cli(io, '--record', 'flag.json', 'init'))
  ok(cli(io, 'init', '--record=other.json'))
  assert.deepEqual(Object.keys(io.files).sort(), ['env.json', 'flag.json', 'other.json'])
})

test('--now sets the clock for changes and questions', () => {
  const io = memIo()
  ok(cli(io, 'init'))
  ok(cli(io, '--now', LATER, 'zone', 'create', 'crew', '--level', 'friend'))
  assert.equal(record(io).zones.find((z) => z.id === 'crew').createdAt, LATER)
})

test('a damaged record is named, not guessed at', () => {
  const io = memIo({ files: { [DEFAULT_RECORD]: '{"format":"trustweb-cli-record","version":1}' } })
  const r = cli(io, 'zone', 'list')
  assert.equal(r.code, 1)
  assert.match(r.err, /^trustweb: trustweb-record.json: record: device must be text\n$/)
})

// ------------------------------------------------------------------------------------------------ zones

test('zone list: a table, archived left out unless --all; --json carries the placed people', () => {
  const io = seeded()
  ok(cli(io, 'zone', 'archive', 'intending'))
  const t = ok(cli(io, 'zone', 'list')).out.split('\n')
  assert.match(t[0], /^ID\s+LEVEL\s+KIND\s+PEOPLE\s+NAME$/)
  assert.ok(!t.some((l) => l.startsWith('intending')))
  assert.match(t.find((l) => l.startsWith('friend')), /^friend\s+friend\s+built-in\s+2\s+Friends$/)
  assert.match(t.find((l) => l.startsWith('allies')), /^allies\s+close\s+created\s+3\s+Allies$/)
  const all = ok(cli(io, 'zone', 'list', '--all')).out
  assert.match(all, /\nintending\s+intending\s+built-in\s+0\s+Intending to connect \(archived\)\n/)
  const j = JSON.parse(ok(cli(io, 'zone', 'list', '--json')).out)
  assert.deepEqual(j.find((z) => z.id === 'allies').placed, ['kiwi', 'pear', 'plum'])
  assert.equal(j.length, 7)
})

test('zone create, rename, archive, restore print what they did and log it', () => {
  const io = memIo()
  ok(cli(io, 'init'))
  assert.equal(ok(cli(io, 'zone', 'create', 'crew', '--level', 'friend', '--name', 'The crew')).out, 'zone create: crew "The crew" on level friend\n')
  assert.equal(ok(cli(io, 'zone', 'rename', 'crew', 'Garden', 'crew')).out, 'zone rename: crew "The crew" -> "Garden crew"\n')
  assert.equal(ok(cli(io, 'zone', 'archive', 'crew')).out, 'zone archive: crew (it places nobody now)\n')
  assert.equal(ok(cli(io, 'zone', 'restore', 'crew')).out, 'zone restore: crew\n')
  const refused = cli(io, 'zone', 'archive', 'public')
  assert.equal(refused.code, 1)
  assert.match(refused.err, /public cannot be archived/)
  assert.equal(cli(io, 'zone', 'create', 'crew', '--level', 'nope').code, 1)
  assert.equal(record(io).log.length, 5)
})

test('zone add and remove, then zone show (text and JSON)', () => {
  const io = memIo()
  ok(cli(io, 'init'))
  ok(cli(io, 'zone', 'create', 'allies', '--level', 'close'))
  assert.equal(ok(cli(io, 'zone', 'add', 'allies', 'person:plum', 'tag:garden', 'tag:empty')).out,
    'zone add: allies + person:plum, tag:garden, tag:empty (new: person:plum, tag:garden, tag:empty)\n')
  ok(cli(io, 'person', 'tag', 'kiwi', 'garden'))
  assert.equal(ok(cli(io, 'zone', 'show', 'allies')).out, [
    'zone allies "allies"',
    'level:    close (created)',
    `created:  ${NOW}`,
    'archived: no',
    'members:',
    '  person:plum',
    '  tag:garden (holders: kiwi)',
    '  tag:empty (holders: nobody yet)',
    'places:   kiwi, plum',
    '',
  ].join('\n'))
  const j = JSON.parse(ok(cli(io, 'zone', 'show', 'allies', '--json')).out)
  assert.deepEqual(j.placed, ['kiwi', 'plum'])
  assert.deepEqual(j.viaTags, [{ person: 'kiwi', tag: 'garden' }])
  assert.equal(ok(cli(io, 'zone', 'remove', 'allies', 'person:plum', 'tag:garden', 'tag:empty')).out, 'zone remove: allies - person:plum, tag:garden, tag:empty\n')
  ok(cli(io, 'zone', 'archive', 'friend', '--now', LATER))
  const shown = ok(cli(io, 'zone', 'show', 'friend')).out
  assert.match(shown, /level: {4}friend \(built-in\)\ncreated: {2}2026-10-27T12:00:00.000Z\narchived: 2026-11-01T09:30:00.000Z\nmembers:\n {2}none\nplaces: {3}nobody\n/)
  assert.equal(cli(io, 'zone', 'show', 'nope').code, 1)
})

// ------------------------------------------------------------------------------------------------ people and tags

test('person add, tag, untag, list', () => {
  const io = memIo()
  ok(cli(io, 'init'))
  assert.equal(ok(cli(io, 'person', 'list')).out, 'no people yet (add one: trustweb person add <id>)\n')
  assert.equal(ok(cli(io, 'person', 'add', 'fig', '--name', 'Fig')).out, 'person add: fig "Fig"\n')
  assert.equal(ok(cli(io, 'person', 'tag', 'fig', 'garden', 'bikes')).out, 'person tag: fig + garden, bikes (new: tag:garden, tag:bikes)\n')
  assert.equal(ok(cli(io, 'person', 'untag', 'fig', 'bikes')).out, 'person untag: fig - bikes\n')
  ok(cli(io, 'zone', 'add', 'friend', 'person:fig', 'person:kiwi'))
  const t = ok(cli(io, 'person', 'list')).out
  assert.equal(t, 'ID    ZONE    TAGS    NAME\nfig   friend  garden  Fig\nkiwi  friend  -\n')
  assert.deepEqual(JSON.parse(ok(cli(io, 'person', 'list', '--json')).out)[0], { id: 'fig', name: 'Fig', zone: 'friend', tags: ['garden'] })
})

test('tag create, nest, list (holders count nesting)', () => {
  const io = memIo()
  ok(cli(io, 'init'))
  assert.equal(ok(cli(io, 'tag', 'list')).out, 'no tags yet (create one: trustweb tag create <id>)\n')
  assert.equal(ok(cli(io, 'tag', 'create', 'garden', '--label', 'Garden')).out, 'tag create: garden "Garden"\n')
  ok(cli(io, 'tag', 'create', 'seedlings'))
  assert.equal(ok(cli(io, 'tag', 'nest', 'seedlings', 'garden')).out, 'tag nest: seedlings under garden\n')
  ok(cli(io, 'person', 'tag', 'pear', 'seedlings'))
  assert.equal(ok(cli(io, 'tag', 'list')).out, 'ID         PARENTS  HOLDERS  LABEL\ngarden     -        1        Garden\nseedlings  garden   1\n')
  assert.deepEqual(JSON.parse(ok(cli(io, 'tag', 'list', '--json')).out)[0], { id: 'garden', label: 'Garden', parents: [], holders: ['pear'] })
  const cycle = cli(io, 'tag', 'nest', 'garden', 'seedlings')
  assert.equal(cycle.code, 1)
  assert.match(cycle.err, /would make a cycle/)
})

// ------------------------------------------------------------------------------------------------ sharing and seeing

test('share prints the line it appended; a created zone is refused with a hint', () => {
  const io = memIo()
  ok(cli(io, 'init'))
  assert.equal(ok(cli(io, 'share', 'bike', '--zone', 'friend', '--include', 'tag:garden', '--exclude=person:fig')).out,
    'share: item:bike with zone friend + tag:garden - person:fig (new: tag:garden, person:fig)\n')
  ok(cli(io, 'zone', 'create', 'crew', '--level', 'friend'))
  const r = cli(io, 'share', 'bike', '--zone', 'crew')
  assert.equal(r.code, 1)
  assert.match(r.err, /crew is a created zone on level friend: share to friend, or name its people with --include/)
  assert.equal(record(io).shares.length, 1)
})

test('sees: text, JSON and Markdown for a zone, a tag and a person', () => {
  const io = seeded()
  assert.equal(ok(cli(io, 'sees', 'friend')).out, [
    'zone:friend can see 3 items',
    'item:bike', '  because zone:friend may_read item:bike',
    'item:recipe', '  because zone:public may_read item:recipe',
    'item:tools', '  because zone:friend may_read item:tools',
    '',
  ].join('\n'))
  assert.equal(ok(cli(io, 'sees', 'tag:seedlings')).out, [
    'tag:seedlings can see 2 items',
    'item:ladder', '  because tag:seedlings nested_in tag:garden', '  because tag:garden may_read item:ladder',
    'item:recipe', '  because zone:public may_read item:recipe',
    '',
  ].join('\n'))
  assert.match(ok(cli(io, 'sees', 'allies')).out, /^zone:allies can see 4 items\nnote: allies sits on level close: it sees what close sees\n/)
  const kiwi = JSON.parse(ok(cli(io, 'sees', 'person:kiwi', '--json')).out)
  assert.deepEqual(kiwi.items.map((i) => i.item), ['item:bike', 'item:ladder', 'item:recipe'])
  assert.equal(ok(cli(io, 'sees', 'person:kiwi', '--md')).out.split('\n').slice(0, 6).join('\n'),
    '# person:kiwi\n\n## Can see\n\n- item:bike\n  - person:kiwi in_zone zone:close (via allies)')
  assert.match(ok(cli(io, 'sees', 'allies', '--md')).out, /^# zone:allies\n\n> allies sits on level close: it sees what close sees\n\n## Can see\n/)
})

test('sees: nothing to see reads as such; one item is singular; an expired share is gone', () => {
  const io = seeded()
  ok(cli(io, 'zone', 'archive', 'allies'))
  assert.equal(ok(cli(io, 'sees', 'allies')).out, 'zone:allies can see nothing\nnote: allies is archived: it places nobody, so it sees nothing\n')
  assert.equal(ok(cli(io, 'sees', 'allies', '--md')).out, '# zone:allies\n\n> allies is archived: it places nobody, so it sees nothing\n\n## Can see\n\n- nothing\n')
  assert.match(ok(cli(io, 'sees', 'public')).out, /^zone:public can see 1 item\n/)
  assert.equal(ok(cli(io, 'sees', 'closest', '--now', '2028-01-01T00:00:00.000Z')).out, 'zone:closest can see nothing\n')
  assert.equal(cli(io, 'sees', 'person:nobody').code, 1)
})

// ------------------------------------------------------------------------------------------------ export, import, log

test('export json is the record itself; jsonl is the share sink store; --out refuses to overwrite without --force', () => {
  const io = seeded()
  assert.equal(ok(cli(io, 'export')).out, io.files[DEFAULT_RECORD])
  const jsonl = ok(cli(io, 'export', '--format', 'jsonl')).out
  assert.ok(jsonl.split('\n').filter(Boolean).every((l) => JSON.parse(l).by === 'device:cli'))
  assert.match(jsonl, /^\{"subject":"person:fig","relation":"in_zone","object":"zone:friend","since":/)
  assert.equal(ok(cli(io, 'export', '--out', 'backup.json')).out, 'wrote backup.json (json)\n')
  assert.equal(io.files['backup.json'], io.files[DEFAULT_RECORD])
  assert.equal(cli(io, 'export', '--out', 'backup.json').code, 1)
  assert.equal(ok(cli(io, 'export', '--out', 'backup.json', '--force', '--format', 'jsonl')).out,
    'moved the old file to archive/backup.json.1\nwrote backup.json (jsonl)\n')
  assert.equal(io.files['backup.json'], jsonl)
})

test('import: a round trip through export, from a file or stdin; the old record is archived, never lost', () => {
  const src = seeded()
  const exported = ok(cli(src, 'export')).out
  const io = memIo({ files: { 'in.json': exported }, stdin: exported })
  const fresh = ok(cli(io, 'import', 'in.json'))
  assert.equal(fresh.out, 'import: 8 zones, 4 people, 2 tags, 4 share lines from in.json\n')
  const r = record(io)
  assert.deepEqual({ ...r, log: r.log.slice(0, -1) }, parseRecord(exported))
  assert.equal(r.log.at(-1), `${NOW} import: 8 zones, 4 people, 2 tags, 4 share lines from in.json`)
  assert.equal(cli(io, 'import', 'in.json').code, 1)
  const again = ok(cli(io, 'import', '-', '--force'))
  assert.equal(again.out, `moved the old record to archive/${DEFAULT_RECORD}.1\nimport: 8 zones, 4 people, 2 tags, 4 share lines from stdin\n`)
  assert.equal(ok(cli(io, 'sees', 'friend')).out, ok(cli(src, 'sees', 'friend')).out)
})

test('import refuses a missing file and anything that is not a valid record, naming the source', () => {
  const io = memIo({ files: { 'bad.json': '{"format":"x"}' }, stdin: 'nope' })
  assert.match(cli(io, 'import', 'missing.json').err, /^trustweb: no file at missing.json\n$/)
  assert.match(cli(io, 'import', 'bad.json').err, /^trustweb: bad.json: record: not a TrustWeb CLI record/)
  assert.match(cli(io, 'import', '-').err, /^trustweb: stdin: record: not JSON\n$/)
  assert.equal(io.files[DEFAULT_RECORD], undefined)
})

test('log: every change, oldest first; -n keeps the last few', () => {
  const io = seeded()
  const all = ok(cli(io, 'log')).out.trimEnd().split('\n')
  assert.equal(all.length, 13)
  assert.equal(all[0], `${NOW} init: empty record, 7 built-in zones`)
  assert.equal(ok(cli(io, 'log', '-n', '2')).out, all.slice(-2).map((l) => `${l}\n`).join(''))
  assert.equal(ok(cli(io, 'log', '-n', '99')).out.trimEnd().split('\n').length, 13)
})
