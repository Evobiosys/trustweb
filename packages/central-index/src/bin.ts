#!/usr/bin/env node
// CLI entry point. Reads WOT_CENTRAL_PORT / WOT_CENTRAL_JURISDICTION /
// WOT_CENTRAL_DATA, binds 127.0.0.1 by default, shuts down cleanly on
// SIGINT and SIGTERM.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCentralServer } from './server.js';

const port = Number(process.env.WOT_CENTRAL_PORT ?? 4187);
const jurisdiction = process.env.WOT_CENTRAL_JURISDICTION ?? 'at';
const dataDir = process.env.WOT_CENTRAL_DATA ?? './data';

// U3's status.html ships in the package's own public/ directory. Serve it out of the box for a
// real deployment; opts.publicDir stays undefined if it isn't there (e.g. a dist-only install).
const __dirname = dirname(fileURLToPath(import.meta.url));
const packagePublicDir = join(__dirname, '..', 'public');
const publicDir = existsSync(join(packagePublicDir, 'status.html')) ? packagePublicDir : undefined;

const server = createCentralServer({ dataDir, jurisdiction, publicDir });

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`wot-central-index: ${signal} received, shutting down`);
  server
    .close()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server
  .listen(port)
  .then((boundPort) => {
    console.log(`wot-central-index listening on 127.0.0.1:${boundPort} (jurisdiction=${jurisdiction}, data=${dataDir})`);
  })
  .catch((err: unknown) => {
    console.error('wot-central-index: failed to start', err instanceof Error ? err.message : err);
    process.exit(1);
  });
