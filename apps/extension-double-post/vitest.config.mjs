// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Run from apps/demo:
//   node_modules/.bin/vitest run --config ../extension-double-post/vitest.config.mjs --root ../extension-double-post
export default {
  test: { globals: true, environment: 'node', include: ['test/unit/**/*.test.mjs'] },
}
