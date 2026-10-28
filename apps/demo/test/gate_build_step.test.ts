import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The suites in this package import @resource-web/* workspace packages whose
 * `main` points at dist/. A fresh checkout has no dist/, so `vitest run` and
 * `tsc --noEmit` fail until those packages are built. The package scripts must
 * therefore build them first, so `pnpm test` / `pnpm typecheck` are green from
 * a clean clone, not only after someone remembered to build by hand.
 */

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  scripts: Record<string, string>
}

describe('test gate builds workspace dependencies first', () => {
  it('has a build:deps script that builds every workspace package @ew/demo depends on', () => {
    expect(pkg.scripts['build:deps']).toBe('pnpm --filter "@ew/demo^..." build')
  })

  it.each(['pretest', 'pretypecheck'])('%s runs build:deps', (hook) => {
    expect(pkg.scripts[hook]).toBe('pnpm build:deps')
  })
})
