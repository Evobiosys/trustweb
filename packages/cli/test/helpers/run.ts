// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Runs the CLI in-process against a temporary directory, the way a person would type it, and captures stdout, stderr and
 * the exit code. `--now` is pinned so every run is reproducible. Made-up ids only, no personal data.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../../src/main.ts'
import { loadRecord, saveRecord, type TrustRecord } from '../../src/record.ts'

export const NOW = '2026-11-02T12:00:00.000Z'

export interface Result {
  code: number
  stdout: string
  stderr: string
  /** stdout parsed as JSON (for --json runs). */
  json<T = unknown>(): T
}

export class Cli {
  readonly dir: string
  readonly env: Record<string, string | undefined>
  constructor(dir = mkdtempSync(join(tmpdir(), 'trustweb-cli-')), env: Record<string, string | undefined> = {}) {
    this.dir = dir
    this.env = { TRUSTWEB_NOW: NOW, ...env }
  }

  /** `cli.run('zone', 'create', 'friend')`; an argument of the form `--now=<iso>` overrides the pinned clock. */
  async run(...argv: string[]): Promise<Result> {
    let stdout = ''
    let stderr = ''
    const code = await main(argv, { cwd: this.dir, env: this.env, stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) })
    return { code, stdout, stderr, json: <T>() => JSON.parse(stdout) as T }
  }

  /** Runs and asserts success; returns stdout. */
  async ok(...argv: string[]): Promise<string> {
    const r = await this.run(...argv)
    if (r.code !== 0) throw new Error(`expected exit 0 for \`trustweb ${argv.join(' ')}\`, got ${r.code}\n${r.stderr}${r.stdout}`)
    return r.stdout
  }

  record(): TrustRecord {
    return loadRecord(join(this.dir, '.trustweb', 'record.json'))
  }
}

/** Edits the record file directly (for fixtures that the commands under test should not have to build). */
export function withRecord(cli: Cli, edit: (r: TrustRecord) => void): TrustRecord {
  const path = join(cli.dir, '.trustweb', 'record.json')
  const r = loadRecord(path)
  edit(r)
  saveRecord(path, r)
  return r
}

/**
 * A fresh record (device:laptop) with the usual fixture, written directly: zones friend and close on, community
 * archived; ada in friend, cy in close, bo in no zone; tag garden on bo, tag roses (nested in garden) on cy. Made-up ids only.
 */
export async function seeded(): Promise<Cli> {
  const cli = new Cli()
  await cli.ok('init', '--device', 'laptop')
  withRecord(cli, (r) => {
    r.zones.friend = { label: 'Friends', createdAt: NOW }
    r.zones.close = { label: 'Close friends and allies', createdAt: NOW }
    r.zones.community = { label: 'Community', createdAt: NOW, archivedAt: NOW }
    r.persons.ada = { name: 'Ada', addedAt: NOW }
    r.persons.bo = { name: 'Bo', addedAt: NOW }
    r.persons.cy = { name: 'Cy', addedAt: NOW }
    r.tags.garden = { label: 'garden', addedAt: NOW }
    r.tags.roses = { label: 'roses', addedAt: NOW }
    const by = 'device:laptop'
    r.tuples.push(
      { subject: 'person:ada', relation: 'in_zone', object: 'zone:friend', since: NOW, by },
      { subject: 'person:cy', relation: 'in_zone', object: 'zone:close', since: NOW, by },
      { subject: 'person:bo', relation: 'has_tag', object: 'tag:garden', since: NOW, by },
      { subject: 'person:cy', relation: 'has_tag', object: 'tag:roses', since: NOW, by },
      { subject: 'tag:roses', relation: 'nested_in', object: 'tag:garden', since: NOW, by },
    )
  })
  return cli
}
