// Wires templates.ts + red_flags.ts + pause.ts into one entry point every
// incoming query — network-intro or vault — passes through before it ever
// touches a matcher. This is additive: the pre-existing free-text
// receiveQuery()/gates.ts path (D19-D21) is untouched and keeps working
// exactly as before for anything that doesn't go through submitQuery(). This
// gateway is the new, stricter front door the memo asks for: "incoming
// requests can only reference existing template IDs."
//
// Flow, in order:
//   1. template validation (templates.ts) — unknown id / tampered record /
//      wrong requester / wrong text all reject.
//   2. on reject: emit a red-flag event (red_flags.ts) and return the exact
//      byte-identical "nothing shareable" text — never a distinguishing
//      reason outward (see red_flags.ts's file header for why).
//   3. on accept, while paused: enqueue the validated request and return
//      "queued" — no matcher starts, nothing is lost.
//   4. on accept, not paused: return "accepted" with the resolved template;
//      the caller (demo/server.ts) proceeds down the network ladder or the
//      vault query path per template.target.
import {
  currentView as currentTemplateView,
  listAllRaw as listAllTemplatesRaw,
  loadOrCreateSecret,
  validateAgainstTemplate,
} from "./templates.js";
import type { QueryTemplate } from "./templates.js";
import { emitRedFlag } from "./red_flags.js";
import type { RedFlagEvent } from "./red_flags.js";
import { isPaused, enqueue, drain } from "./pause.js";
import type { QueuedItem } from "./pause.js";

export interface GatewayPaths {
  templatesPath: string;
  templatesSecretPath: string;
  redFlagsPath: string;
  pauseStatePath: string;
  pauseQueuePath: string;
}

export interface SubmitQueryInput {
  templateId: string;
  requester: string;
  text: string;
  receivedAt?: number;
}

export interface TemplateValidationTrace {
  status: "valid" | "rejected";
  template_id: string;
  requester: string;
  reason?: string;
}

export interface RedFlagTrace {
  emitted: boolean;
  event?: RedFlagEvent;
}

export type SubmitOutcome =
  | {
      kind: "red_flag";
      outward: string;
      templateValidation: TemplateValidationTrace;
      redFlag: RedFlagTrace;
    }
  | {
      kind: "queued";
      queued: QueuedItem<SubmitQueryInput>;
      templateValidation: TemplateValidationTrace;
    }
  | {
      kind: "accepted";
      template: QueryTemplate;
      templateValidation: TemplateValidationTrace;
    };

const REJECTED_OUTWARD_TEXT = "No shareable result for this request.";

function validate(paths: GatewayPaths, input: SubmitQueryInput) {
  const secret = loadOrCreateSecret(paths.templatesSecretPath);
  const raw = listAllTemplatesRaw(paths.templatesPath);
  const valid = currentTemplateView(paths.templatesPath, secret);
  return validateAgainstTemplate(raw, valid, {
    templateId: input.templateId,
    requester: input.requester,
    text: input.text,
  });
}

/** The gateway's one entry point. Synchronous (all local file I/O, same
 * idiom as templates.ts/pause.ts) — the caller awaits nothing here; async
 * matching only happens after "accepted", outside this module. */
export function submitQuery(paths: GatewayPaths, input: SubmitQueryInput): SubmitOutcome {
  const result = validate(paths, input);

  if (!result.ok) {
    const event = emitRedFlag(paths.redFlagsPath, {
      requester: input.requester,
      templateId: input.templateId || null,
      reason: result.reason,
      receivedText: input.text,
      now: input.receivedAt,
    });
    return {
      kind: "red_flag",
      outward: REJECTED_OUTWARD_TEXT,
      templateValidation: {
        status: "rejected",
        template_id: input.templateId,
        requester: input.requester,
        reason: result.reason,
      },
      redFlag: { emitted: true, event },
    };
  }

  const templateValidation: TemplateValidationTrace = {
    status: "valid",
    template_id: result.template.id,
    requester: input.requester,
  };

  if (isPaused(paths.pauseStatePath)) {
    const queued: QueuedItem<SubmitQueryInput> = {
      id: result.template.id + ":" + String(input.receivedAt ?? Date.now()),
      enqueued_at: new Date(input.receivedAt ?? Date.now()).toISOString(),
      payload: input,
    };
    enqueue(paths.pauseQueuePath, queued);
    return { kind: "queued", queued, templateValidation };
  }

  return { kind: "accepted", template: result.template, templateValidation };
}

export interface ResumeResult {
  drainedCount: number;
  outcomes: SubmitOutcome[];
}

/**
 * Drains whatever queued while paused and re-runs each item through
 * submitQuery() again — NOT a raw replay. A template revoked during the
 * pause window is re-checked here (validateAgainstTemplate reads the live
 * store fresh each call), so a revocation made while paused is honored
 * instead of being bypassed by a queue built before the revoke. If the
 * system is still paused when resumeQueue() is called (nothing changed the
 * pause flag), items are drained and immediately re-queued in the same
 * order rather than silently dropped — resumeQueue() is meant to be called
 * right after setPaused(path, false).
 */
export function resumeQueue(paths: GatewayPaths): ResumeResult {
  const items = drain<SubmitQueryInput>(paths.pauseQueuePath);
  const outcomes = items.map((item) => submitQuery(paths, item.payload));
  return { drainedCount: items.length, outcomes };
}
