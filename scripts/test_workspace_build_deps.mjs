// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Guard: every workspace package that consumes another workspace package through
// its built dist/ must build that dependency before `test` and `typecheck`.
// Why: on 2026-11-02 a fresh-clone `pnpm typecheck` failed with "Cannot find
// module '@resource-web/protocol'" etc., because `tsc --noEmit` does not build
// dependencies and dist/ is not committed. Fix pattern (PR #43, #53):
//   "build:deps": "pnpm --filter \"<name>^...\" build",
//   "pretest": "pnpm build:deps", "pretypecheck": "pnpm build:deps"
// Run: node --test scripts/test_workspace_build_deps.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Only simple "dir/*" globs are used in pnpm-workspace.yaml; parse them by hand.
const globs = [...readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8').matchAll(/^\s*-\s*["']?([^"'\s]+)\/\*["']?\s*$/gm)].map((m) => m[1]);
const pkgs = new Map();
for (const dir of globs) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const file = join(root, dir, entry.name, 'package.json');
    if (entry.isDirectory() && existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, 'utf8'));
      pkgs.set(pkg.name, { pkg, rel: `${dir}/${entry.name}` });
    }
  }
}

// The entry TypeScript (moduleResolution NodeNext) resolves: exports["."] wins over main.
function entryPoint(pkg) {
  const dot = typeof pkg.exports === 'string' ? pkg.exports : pkg.exports?.['.'];
  if (dot) return typeof dot === 'string' ? dot : dot.types ?? dot.import ?? dot.default;
  return pkg.types ?? pkg.main;
}
const isDistPublished = (pkg) => /^(\.\/)?dist\//.test(entryPoint(pkg) ?? '');

for (const [name, { pkg, rel }] of pkgs) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const distDeps = Object.keys(deps).filter(
    (d) => String(deps[d]).startsWith('workspace:') && pkgs.has(d) && isDistPublished(pkgs.get(d).pkg),
  );
  if (distDeps.length === 0) continue;

  test(`${rel} builds its dist/ workspace deps (${distDeps.join(', ')}) before test/typecheck`, () => {
    const s = pkg.scripts ?? {};
    const filter = `pnpm --filter "${name}^..." build`;
    const runsBuildDeps = (cmd) => typeof cmd === 'string' && (cmd.includes('build:deps') || cmd.includes(filter));
    assert.ok(s['build:deps']?.includes(filter), `${name} (${rel}) is missing script "build:deps": "${filter}"`);
    for (const hook of ['pretest', 'pretypecheck']) {
      if (!s[hook.slice(3)]) continue; // no test/typecheck script, nothing to guard
      assert.ok(runsBuildDeps(s[hook]), `${name} (${rel}) is missing script "${hook}": "pnpm build:deps"`);
    }
  });
}
