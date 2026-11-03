# archive

`replay.ts` / `replay.test.ts`: the RFC 4303-style anti-replay window of round 1. Round 2 (owner decision: forward secrecy) replaced it
with the symmetric ratchet in `src/ratchet.ts`, whose per-counter message keys are deleted after use, so a replay has no key left: the
ratchet's bounded map of skipped keys IS the window now (MAX_SKIP = 1024). Kept here, not deleted, per the repo rule. Not exported, not run.
