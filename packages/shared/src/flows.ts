import { z } from "zod";

// Flow definition format. Phase 3 ships five step kinds — enough to express
// "log in, navigate to checkout, fill the form, submit, wait for the order
// confirmation page" — and the runner verifies each step before moving on.
//
// The format is intentionally narrow. Anything richer (conditionals, loops,
// per-step viewport overrides) is deferred until we see what users actually
// record.

const Selector = z.string().min(1).max(500);

export const FlowGotoStep = z.object({
  kind: z.literal("goto"),
  url: z.string().url(),
  /** Treat the navigation as failed if the page returns this status or higher. */
  failOnStatus: z.number().int().min(400).max(599).optional(),
});

export const FlowClickStep = z.object({
  kind: z.literal("click"),
  selector: Selector,
  /** Wait at least this long after clicking before the next step. */
  postWaitMs: z.number().int().min(0).max(30000).optional(),
});

export const FlowTypeStep = z.object({
  kind: z.literal("type"),
  selector: Selector,
  /** The text to type. May reference {{credentials.foo}} for vault values. */
  text: z.string().max(2000),
  /** Whether to clear the field first. Default true. */
  clear: z.boolean().optional(),
});

export const FlowWaitStep = z.object({
  kind: z.literal("wait"),
  /** Either a CSS selector to wait for, OR a duration in ms. Exactly one. */
  selector: Selector.optional(),
  durationMs: z.number().int().min(50).max(60000).optional(),
  state: z.enum(["visible", "attached", "hidden", "detached"]).optional(),
});

export const FlowAssertStep = z.object({
  kind: z.literal("assert"),
  /** Assert that a selector exists, OR that body text contains a string, OR URL matches. */
  selectorPresent: Selector.optional(),
  textPresent: z.string().max(500).optional(),
  urlMatches: z.string().max(500).optional(),
});

export const FlowStepSchema = z
  .discriminatedUnion("kind", [
    FlowGotoStep,
    FlowClickStep,
    FlowTypeStep,
    FlowWaitStep,
    FlowAssertStep,
  ])
  .refine(
    (s) => {
      if (s.kind === "wait") return Boolean(s.selector) !== Boolean(s.durationMs);
      if (s.kind === "assert") {
        return Boolean(s.selectorPresent) || Boolean(s.textPresent) || Boolean(s.urlMatches);
      }
      return true;
    },
    {
      message: "wait requires exactly one of {selector, durationMs}; assert requires at least one assertion",
    },
  );

export type FlowStep = z.infer<typeof FlowStepSchema>;

export const FlowDefinitionSchema = z.object({
  steps: z.array(FlowStepSchema).min(1).max(50),
});
export type FlowDefinition = z.infer<typeof FlowDefinitionSchema>;
