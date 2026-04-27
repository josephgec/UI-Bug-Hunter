import type { Page } from "playwright";
import { FlowDefinitionSchema, type FlowDefinition, type FlowStep } from "@ubh/shared";
import type { BrowserSession } from "../browser.js";

export interface FlowRunResult {
  /** 1-indexed; null if every step succeeded. */
  failedAt: number | null;
  /** Steps that ran (whether they passed or failed). */
  executed: { step: FlowStep; index: number; ok: boolean; error?: string; elapsedMs: number }[];
}

export interface FlowRunOptions {
  /** Render every step on every viewport. Default: only the primary viewport. */
  allViewports?: boolean;
  /** Per-step timeout in ms. Default 15000. */
  stepTimeoutMs?: number;
  /** Substitution map for type steps. {{credentials.foo}} → values["foo"]. */
  credentialSubstitutions?: Record<string, string>;
}

/**
 * Execute a flow on a BrowserSession. Each step runs sequentially. If
 * `strictAssertions` is true the run stops at the first failure; otherwise
 * subsequent steps still run (useful for "report every issue you can").
 */
export async function executeFlow(
  session: BrowserSession,
  definition: unknown,
  opts: FlowRunOptions & { strictAssertions: boolean },
): Promise<FlowRunResult> {
  const parsed = FlowDefinitionSchema.parse(definition);
  const stepTimeoutMs = opts.stepTimeoutMs ?? 15000;
  const result: FlowRunResult = { failedAt: null, executed: [] };

  for (let i = 0; i < parsed.steps.length; i++) {
    const step = parsed.steps[i]!;
    const start = Date.now();
    try {
      await runStep(session, step, {
        stepTimeoutMs,
        allViewports: opts.allViewports ?? false,
        ...(opts.credentialSubstitutions
          ? { credentialSubstitutions: opts.credentialSubstitutions }
          : {}),
      });
      result.executed.push({ step, index: i + 1, ok: true, elapsedMs: Date.now() - start });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.executed.push({ step, index: i + 1, ok: false, error: message, elapsedMs: Date.now() - start });
      if (result.failedAt === null) result.failedAt = i + 1;
      if (opts.strictAssertions) break;
    }
  }
  return result;
}

async function runStep(
  session: BrowserSession,
  step: FlowStep,
  opts: { stepTimeoutMs: number; allViewports: boolean; credentialSubstitutions?: Record<string, string> },
): Promise<void> {
  const targets: Page[] = opts.allViewports
    ? session.viewports.map((v) => session.pageFor(v))
    : [session.requirePage()];

  switch (step.kind) {
    case "goto": {
      for (const page of targets) {
        const response = await page.goto(step.url, {
          waitUntil: "domcontentloaded",
          timeout: opts.stepTimeoutMs,
        });
        if (step.failOnStatus && response && response.status() >= step.failOnStatus) {
          throw new Error(`goto ${step.url} returned ${response.status()}`);
        }
      }
      await session.settleAll();
      return;
    }
    case "click": {
      for (const page of targets) {
        await page.locator(step.selector).first().click({ timeout: opts.stepTimeoutMs });
      }
      if (step.postWaitMs && step.postWaitMs > 0) {
        await targets[0]!.waitForTimeout(step.postWaitMs);
      }
      await session.settleAll();
      return;
    }
    case "type": {
      const text = substitute(step.text, opts.credentialSubstitutions);
      for (const page of targets) {
        const locator = page.locator(step.selector).first();
        if (step.clear !== false) {
          await locator.fill("", { timeout: opts.stepTimeoutMs });
        }
        await locator.fill(text, { timeout: opts.stepTimeoutMs });
      }
      return;
    }
    case "wait": {
      for (const page of targets) {
        if (step.selector) {
          await page.locator(step.selector).first().waitFor({
            state: step.state ?? "visible",
            timeout: opts.stepTimeoutMs,
          });
        } else if (step.durationMs) {
          await page.waitForTimeout(step.durationMs);
        }
      }
      return;
    }
    case "assert": {
      for (const page of targets) {
        if (step.selectorPresent) {
          const count = await page.locator(step.selectorPresent).count();
          if (count === 0) {
            throw new Error(`assert selectorPresent failed: ${step.selectorPresent}`);
          }
        }
        if (step.textPresent) {
          const html = await page.content();
          if (!html.includes(step.textPresent)) {
            throw new Error(`assert textPresent failed: "${step.textPresent}"`);
          }
        }
        if (step.urlMatches) {
          const url = page.url();
          // Treat as a simple substring/regex literal; full pattern features
          // can land later if users ask.
          if (!url.includes(step.urlMatches) && !new RegExp(step.urlMatches).test(url)) {
            throw new Error(`assert urlMatches failed: ${step.urlMatches} (got ${url})`);
          }
        }
      }
      return;
    }
  }
}

/**
 * Substitute {{credentials.foo}} placeholders in a type-step text. We do this
 * here rather than in the flow definition so plaintext credential values never
 * appear in the stored Flow row.
 */
function substitute(template: string, substitutions: Record<string, string> | undefined): string {
  if (!substitutions) return template;
  return template.replace(/\{\{\s*credentials\.([a-zA-Z0-9_-]+)\s*\}\}/g, (whole, name: string) => {
    return name in substitutions ? substitutions[name]! : whole;
  });
}
