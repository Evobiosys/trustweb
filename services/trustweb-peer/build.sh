#!/bin/sh
# Bundles peer.ts (and the apps/demo + apps/trustweb modules it reuses) into one
# dependency-free ESM file, dist/peer.mjs, for a server that has only Node
# (>= 22, for the global WebSocket and fetch the relay channel uses). No
# installs: esbuild comes with the workspace (vite's dependency).
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
R="$(cd "$HERE/../.." && pwd)"
ESBUILD="$(ls -d "$R"/node_modules/.pnpm/esbuild@0.25.*/node_modules/esbuild/bin/esbuild | head -1)"
echo "... trustweb-peer build running ..."
echo "--------"
"$ESBUILD" "$HERE/peer.ts" --bundle --platform=node --format=esm --target=node22 \
  --outfile="$HERE/dist/peer.mjs" --log-level=warning \
  --banner:js="// trustweb-peer, bundled from services/trustweb-peer/peer.ts ($(cd "$R" && git rev-parse --short HEAD 2>/dev/null || echo unversioned))"
echo "built $HERE/dist/peer.mjs ($(wc -c < "$HERE/dist/peer.mjs") bytes)"
