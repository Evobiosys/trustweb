// Withdrawal and clear are not signature-verified yet (README "Known gap"). An
// authorCommitment is a deterministic hash, not a secret, so a reachable instance would let
// anyone who learns one wipe that holder's declarations -- a capability the local-first path
// grants to nobody. createCentralServer therefore refuses a non-loopback bind outright rather
// than leaving it to deployment discipline. These tests pin that refusal so it cannot be
// quietly relaxed before the signing scheme lands.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCentralServer } from '../src/server.js';

describe('loopback-only bind guard', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'wot-central-loopback-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.WOT_CENTRAL_UNSAFE_BIND;
  });

  it('allows the default host, which is loopback', () => {
    const server = createCentralServer({ dataDir });
    expect(server).toBeDefined();
  });

  for (const host of ['127.0.0.1', 'localhost', '::1']) {
    it(`allows the loopback host ${host}`, () => {
      expect(() => createCentralServer({ dataDir, host })).not.toThrow();
    });
  }

  for (const host of ['0.0.0.0', '::', '192.168.1.10']) {
    it(`refuses the reachable host ${host} and names the reason`, () => {
      expect(() => createCentralServer({ dataDir, host })).toThrow(/refuses to bind/);
      expect(() => createCentralServer({ dataDir, host })).toThrow(/signature-verified/);
    });
  }

  it('the escape hatch exists only so the refusal is testable, and is not a deployment option', () => {
    process.env.WOT_CENTRAL_UNSAFE_BIND = '1';
    expect(() => createCentralServer({ dataDir, host: '0.0.0.0' })).not.toThrow();
  });
});
