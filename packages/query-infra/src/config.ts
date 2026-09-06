// Query-infra configuration. Extends the network-access config with the
// fields only the query-infra layer needs (vault matching, uniform reply
// tick), so packages/network-access keeps exactly the surface the trunk
// already ships. Ported from rebiosys query-infra
// packages/network-access/src/config.ts (commit 6e9e5a2 / cd498bb).
import { loadConfig, type NetworkAccessConfig } from "@resource-web/network-access";

export interface QueryInfraConfig extends NetworkAccessConfig {
  /** Strongest local model for vault (local-files) queries, memo item 4:
   * "matching via the strongest local model configured." Defaults to
   * `mistral-small:24b`; an owner without that model pulled can override to
   * reuse largeModel. LlmVaultMatcher falls back to the deterministic
   * keyword matcher on any failure regardless (unreachable ollama, missing
   * model, malformed reply), so this default never blocks offline tests,
   * which inject a fake ChatClient instead of touching it. */
  vaultModel: string;
  /** Whether the demo's vault matcher actually calls the LLM, or goes
   * straight to the deterministic keyword matcher. Defaults to false: a live
   * walkthrough needs fast, repeatable results, and a ~24B local model adds
   * several seconds of latency per query plus more conservative recall than
   * the keyword overlap the fixtures are tuned against (observed live: 1-2 of
   * 4 plausible notes vs. keyword's 4/4, see DECISIONS.md D22). Set
   * NETWORK_ACCESS_VAULT_USE_LLM=1 to show the real "strongest local model
   * configured" path instead. */
  vaultUseLlm: boolean;
  /** Uniform reply-scheduling tick, ms (D19/D20 known-debt, Delta 3). */
  replyTickMs: number;
}

export function loadQueryInfraConfig(env: NodeJS.ProcessEnv = process.env): QueryInfraConfig {
  return {
    ...loadConfig(env),
    vaultModel: env.NETWORK_ACCESS_VAULT_MODEL ?? "mistral-small:24b",
    vaultUseLlm: env.NETWORK_ACCESS_VAULT_USE_LLM === "1",
    replyTickMs: env.NETWORK_ACCESS_REPLY_TICK_MS ? Number(env.NETWORK_ACCESS_REPLY_TICK_MS) : 30_000,
  };
}
