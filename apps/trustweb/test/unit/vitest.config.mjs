// Standalone vitest config for the meeting tests, so the run never loads
// apps/trustweb/vite.config.mjs. No imports: apps/trustweb has no
// node_modules, so the tests use vitest globals.
//
// Run from apps/demo (it has the toolchain):
//   cd <repo>/apps/demo && node_modules/.bin/vitest run \
//     --config ../trustweb/test/unit/vitest.config.mjs --root ../trustweb
export default {
  test: {
    globals: true,
    environment: 'node',
    include: ['test/unit/**/*.test.mjs'],
  },
}
