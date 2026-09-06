// Bind policy after the signing scheme landed (B-20 option A, 2026-09-06).
//
// The pre-signing rule was "loopback, or nothing": withdraw and clear acted on
// a plain id / authorCommitment with no proof of holdership, and an
// authorCommitment is a deterministic hash rather than a secret, so a reachable
// instance would have let anyone who learned one wipe that holder's
// declarations. That hole is closed -- both endpoints now verify an Ed25519
// signature against the key registered with each declaration.
//
// So the rule is now "loopback, or an operator who declared it in the residency
// config". These tests pin THREE separate gates so none of them can quietly
// absorb another:
//   1. loopback, always allowed;
//   2. WOT_CENTRAL_UNSAFE_BIND=1, test-only, unchanged, never a deploy option;
//   3. allowPublicBind in the jurisdiction config, the supported route.
// A reachable bind with none of the three still refuses to start.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCentralServer } from '../src/server.js';
import { loadJurisdiction } from '../src/jurisdiction.js';

describe('bind policy', () => {
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
      expect(() => createCentralServer({ dataDir, host })).toThrow(/allowPublicBind/);
    });
  }

  it('the escape hatch exists only so the refusal is testable, and is not a deployment option', () => {
    process.env.WOT_CENTRAL_UNSAFE_BIND = '1';
    expect(() => createCentralServer({ dataDir, host: '0.0.0.0' })).not.toThrow();
  });

  it('allows a reachable host once the residency config declares allowPublicBind', () => {
    expect(() => createCentralServer({ dataDir, host: '0.0.0.0', allowPublicBind: true })).not.toThrow();
  });

  it('the shipped AT and EU jurisdiction configs both keep the conservative default', () => {
    // Conservative defaults, I9: an instance becomes reachable because an
    // operator wrote it down, never because a config shipped that way.
    expect(loadJurisdiction('at').allowPublicBind).toBe(false);
    expect(loadJurisdiction('eu').allowPublicBind).toBe(false);
  });

  it('only the boolean true opens the bind: no truthy-string fall-through', () => {
    for (const notTrue of ['true', 1, 'yes', {}] as unknown[]) {
      expect(() =>
        createCentralServer({ dataDir, host: '0.0.0.0', allowPublicBind: notTrue as boolean }),
      ).toThrow(/refuses to bind/);
    }
  });
});
