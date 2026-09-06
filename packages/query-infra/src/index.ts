// @resource-web/query-infra sits on top of @resource-web/network-access: the
// gates, types, anonymity floor and contact matcher stay there, the query
// gateway (pre-approved templates, red flags, pause control, vault target,
// per-peer contracts, owner review queue) lives here. The core surface is
// re-exported so a consumer of query-infra imports one package, the way the
// rebiosys fork's single network-access barrel used to read.
export * from "@resource-web/network-access";
export * from "./config.js";
export * from "./profiles.js";
export * from "./reply_schedule.js";
export * from "./templates.js";
export * from "./red_flags.js";
export * from "./pause.js";
export * from "./vault.js";
export * from "./vault_query.js";
export * from "./query_gateway.js";
export * from "./contact_channels.js";
export * from "./review_queue.js";
export * from "./restore_prompt.js";
export * from "./contracts.js";
