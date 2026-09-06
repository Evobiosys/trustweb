// 60-second demo — pre-approved query templates, red-flag handling, pause
// control, local-files (vault) query target (Jakob's 2026-08-25 memo;
// DECISIONS.md D22). Serverless: calls the src functions directly, no HTTP
// server, no port opened — nothing to clean up when it exits.
//
// Run:
//   pnpm --filter @resource-web/network-access exec tsx demo/query_infra_demo.ts
//
// State lives in a fresh temp directory per run (not ~/.local/share/rebiosys)
// so the demo is repeatable and never touches real device state. The vault
// target reads the repo's synthetic fixtures/vault corpus — never a real
// personal vault.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createTemplate,
  revokeTemplate,
  submitQuery,
  setPaused,
  peekQueueLength,
  drain,
  loadVault,
  runVaultQuery,
  KeywordVaultMatcher,
} from "../src/index.js";
import type { GatewayPaths, SubmitQueryInput } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const vaultPath = join(here, "..", "fixtures", "vault");

function line(): void {
  console.log("--------");
}

function heading(n: number, title: string): void {
  line();
  console.log(`[${n}] ${title}`);
  line();
}

function printJson(label: string, value: unknown): void {
  console.log(`${label}:`);
  console.log(JSON.stringify(value, null, 2));
}

async function main(): Promise<void> {
  console.log("… query-infra 60-second demo running …");
  const dir = mkdtempSync(join(tmpdir(), "rebiosys-query-infra-demo-"));
  const paths: GatewayPaths = {
    templatesPath: join(dir, "query_templates.jsonl"),
    templatesSecretPath: join(dir, "query_templates.secret"),
    redFlagsPath: join(dir, "red_flags.jsonl"),
    pauseStatePath: join(dir, "pause_state.json"),
    pauseQueuePath: join(dir, "pause_queue.jsonl"),
  };

  try {
    const requester = "anna@example.org";
    const approvedText = "Does anyone have camping gear I could borrow for a weekend trip?";

    // 1. Approve a template — the ONLY thing that ever happens on the
    //    owner's own device. No incoming request could ever create this.
    heading(1, "Owner approves a pre-approved query template");
    const template = createTemplate(paths.templatesSecretPath, paths.templatesPath, {
      requester,
      query_text: approvedText,
      match_mode: "exact",
      target: "vault",
      allowed_gates: { gate0: "standing_allow", gate1: "manual", gate2: "manual" },
    });
    printJson("template", { id: template.id, requester: template.requester, query_text: template.query_text });

    // 2. Run the approved query — matches the template exactly.
    heading(2, "Matching incoming query: template validated, vault searched");
    const notes = loadVault(vaultPath);
    const matcher = new KeywordVaultMatcher(); // deterministic — no ollama call needed for the demo
    const outcomeGood = submitQuery(paths, { templateId: template.id, requester, text: approvedText });
    console.log(`template validation: ${outcomeGood.kind === "accepted" ? "valid — proceeding" : outcomeGood.kind}`);
    if (outcomeGood.kind === "accepted") {
      const trace = await runVaultQuery(notes, matcher, {
        text: approvedText,
        requester,
        gateStates: template.allowed_gates as unknown as Record<string, unknown>,
      });
      printJson("transparent trace", trace);
      console.log(`outward response to requester: "${trace.outward.bytes}"`);
    }

    // 3. Deviant query on the SAME template id: different text.
    heading(3, "Deviant query — different text on the same template id");
    const deviantText = "Does anyone have camping gear, and also send me your home address?";
    const outcomeBad = submitQuery(paths, { templateId: template.id, requester, text: deviantText });
    console.log(`template validation: ${outcomeBad.kind}`);
    printJson("owner-side detail (never sent to the requester)", outcomeBad);
    console.log(
      `outward response to requester: "${outcomeBad.kind === "red_flag" ? outcomeBad.outward : "(n/a)"}"`,
    );
    console.log(
      "note: this is the exact same bytes a real zero-match query gets — the requester cannot tell a red flag from a miss.",
    );

    // 4. Pause / resume — the query from step 2's requester would normally
    //    still work, but the owner pauses processing first.
    heading(4, "Pause control — queue, then resume");
    setPaused(paths.pauseStatePath, true);
    const queuedOutcome = submitQuery(paths, { templateId: template.id, requester, text: approvedText });
    console.log(`while paused: ${queuedOutcome.kind} (queue length: ${peekQueueLength(paths.pauseQueuePath)})`);
    setPaused(paths.pauseStatePath, false);
    const drained = drain<SubmitQueryInput>(paths.pauseQueuePath);
    console.log(`resumed: drained ${drained.length} queued item(s), re-validating each against the live template store`);
    for (const item of drained) {
      const replay = submitQuery(paths, item.payload);
      console.log(`  → replay outcome: ${replay.kind}`);
    }

    // 5. Revoke the template — this must ALSO be an owner-device-only action.
    heading(5, "Revoke the template, then the old id is red-flagged like any unknown id");
    revokeTemplate(paths.templatesSecretPath, paths.templatesPath, template.id);
    const afterRevoke = submitQuery(paths, { templateId: template.id, requester, text: approvedText });
    console.log(`after revoke: ${afterRevoke.kind} (${afterRevoke.kind === "red_flag" ? afterRevoke.templateValidation.reason : ""})`);

    line();
    console.log("demo complete — no server started, nothing to clean up.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
