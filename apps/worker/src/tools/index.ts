import { z } from "zod";
import { AxeBuilder } from "@axe-core/playwright";
import {
  BUG_CATEGORIES,
  SEVERITIES,
  VIEWPORTS,
  validateScanUrl,
  type Viewport,
} from "@ubh/shared";
import type { LLMImageBlock, LLMTextBlock } from "../agent/llm.js";
import type { BrowserSession } from "../browser.js";
import type { ToolHandler, ToolRegistry } from "./types.js";

// Helper to build a tool while keeping the I/O types tied together.
function tool<TIn, TOut>(handler: ToolHandler<TIn, TOut>): ToolHandler<unknown, unknown> {
  return handler as unknown as ToolHandler<unknown, unknown>;
}

function textOnly(text: string): Array<LLMTextBlock | LLMImageBlock> {
  return [{ type: "text", text }];
}

const truncate = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n)}…[truncated ${s.length - n} chars]`);

// ─── goto ────────────────────────────────────────────────────────────────────

const GotoInput = z.object({ url: z.string().url() });

const gotoTool = (session: BrowserSession): ToolHandler<unknown, unknown> =>
  tool<z.infer<typeof GotoInput>, { ok: boolean; status?: number; finalUrl?: string; error?: string }>({
    spec: {
      name: "goto",
      description:
        "Navigate the browser to a URL. Use sparingly — prefer staying on the target page. URLs pointing at private IPs or non-HTTP schemes are rejected.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", format: "uri" } },
        required: ["url"],
        additionalProperties: false,
      },
    },
    async execute(raw) {
      const parsed = GotoInput.parse(raw);
      const validation = await validateScanUrl(parsed.url);
      if (!validation.ok) return { ok: false, error: `url_rejected:${validation.reason}` };
      // Navigate every viewport so subsequent screenshots stay aligned.
      await session.gotoAll(validation.url.toString());
      await session.settleAll();
      const page = session.requirePage();
      return { ok: true, finalUrl: page.url() };
    },
    formatResult(out) {
      return textOnly(JSON.stringify(out));
    },
  });

// ─── screenshot ──────────────────────────────────────────────────────────────

const ScreenshotInput = z.object({
  viewport: z.enum(VIEWPORTS).optional(),
  fullPage: z.boolean().optional(),
});

const screenshotTool = (session: BrowserSession): ToolHandler<unknown, unknown> =>
  tool<z.infer<typeof ScreenshotInput>, { dataBase64: string; viewport: Viewport; stable: boolean }>({
    spec: {
      name: "screenshot",
      description:
        "Capture a PNG screenshot of the current page. Set fullPage=true for a scrolled capture; otherwise just the current viewport. The result includes a 'stable' flag — if false, the page hadn't fully settled and any visual finding from this image should carry lower confidence.",
      inputSchema: {
        type: "object",
        properties: {
          viewport: { type: "string", enum: [...VIEWPORTS] },
          fullPage: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
    async execute(raw) {
      const parsed = ScreenshotInput.parse(raw ?? {});
      // If the agent doesn't specify, screenshot the primary viewport.
      const viewport = parsed.viewport ?? session.primaryViewport;
      const page = session.pageFor(viewport);
      const { stable } = await session.settle(viewport);
      const buf = await page.screenshot({ fullPage: parsed.fullPage ?? false, type: "png" });
      const downsampled = await downsampleIfNeeded(buf);
      return {
        dataBase64: downsampled.toString("base64"),
        viewport,
        stable,
      };
    },
    formatResult(out) {
      const blocks: Array<LLMTextBlock | LLMImageBlock> = [
        {
          type: "text",
          text: `Screenshot (viewport=${out.viewport}, stable=${out.stable})`,
        },
        { type: "image", mediaType: "image/png", data: out.dataBase64 },
      ];
      return blocks;
    },
  });

async function downsampleIfNeeded(buf: Buffer): Promise<Buffer> {
  // Downsampling without an image lib would require shelling out; keep this a
  // no-op for v1 and rely on Playwright's native viewport scaling. Documented
  // here so the cost-control hook is visible.
  return buf;
}

// ─── get_dom ─────────────────────────────────────────────────────────────────

const GetDomInput = z.object({
  selector: z.string().optional(),
  maxChars: z.number().int().min(500).max(20000).optional(),
});

const getDomTool = (session: BrowserSession): ToolHandler<unknown, unknown> =>
  tool<z.infer<typeof GetDomInput>, { html: string; selector: string; truncated: boolean }>({
    spec: {
      name: "get_dom",
      description:
        "Return the serialized HTML of the current page (or a CSS-selector subtree). Whitespace is collapsed and <script> + <style> contents are stripped to keep tokens down. maxChars defaults to 4000.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string" },
          maxChars: { type: "integer", minimum: 500, maximum: 20000 },
        },
        additionalProperties: false,
      },
    },
    async execute(raw) {
      const parsed = GetDomInput.parse(raw ?? {});
      const page = session.requirePage();
      const selector = parsed.selector ?? "html";
      const cap = parsed.maxChars ?? 4000;
      const html = await page.evaluate((sel) => {
        const el = document.querySelector(sel) ?? document.documentElement;
        const clone = el.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("script,style,svg path").forEach((n) => n.remove());
        return clone.outerHTML.replace(/\s+/g, " ").trim();
      }, selector);
      return { html: html.slice(0, cap), selector, truncated: html.length > cap };
    },
    formatResult(out) {
      return textOnly(`DOM (${out.selector}${out.truncated ? ", truncated" : ""}):\n${out.html}`);
    },
  });

// ─── get_console_logs ────────────────────────────────────────────────────────

const consoleLogsTool = (session: BrowserSession): ToolHandler<unknown, unknown> =>
  tool<Record<string, never>, { entries: typeof session.consoleEntries }>({
    spec: {
      name: "get_console_logs",
      description:
        "Return all console messages and uncaught exceptions captured since the page loaded. Empty array means the console has been silent.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    async execute() {
      return { entries: session.consoleEntries.slice() };
    },
    formatResult(out) {
      if (out.entries.length === 0) return textOnly("Console: (no messages)");
      const text = out.entries
        .map((e) => `[${e.level}] ${truncate(e.text, 400)}`)
        .join("\n");
      return textOnly(`Console (${out.entries.length} entries):\n${text}`);
    },
  });

// ─── get_network_errors ──────────────────────────────────────────────────────

const networkErrorsTool = (session: BrowserSession): ToolHandler<unknown, unknown> =>
  tool<Record<string, never>, { errors: typeof session.networkErrors }>({
    spec: {
      name: "get_network_errors",
      description:
        "Return all HTTP responses with status >= 400 plus failed requests (DNS, refused, aborted) captured during the scan.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    async execute() {
      return { errors: session.networkErrors.slice() };
    },
    formatResult(out) {
      if (out.errors.length === 0) return textOnly("Network: (no failed requests)");
      const text = out.errors
        .map((e) => `${e.method} ${e.url} → ${e.status || "fail"} ${e.statusText}`)
        .join("\n");
      return textOnly(`Network errors (${out.errors.length}):\n${text}`);
    },
  });

// ─── click / type / scroll ───────────────────────────────────────────────────

const ClickInput = z.object({ selector: z.string() });
const clickTool = (session: BrowserSession): ToolHandler<unknown, unknown> =>
  tool<z.infer<typeof ClickInput>, { ok: boolean; error?: string }>({
    spec: {
      name: "click",
      description:
        "Click an element by CSS selector. Use only when you want to drive an interaction (e.g., open a menu, dismiss a modal) to investigate further.",
      inputSchema: {
        type: "object",
        properties: { selector: { type: "string" } },
        required: ["selector"],
        additionalProperties: false,
      },
    },
    async execute(raw) {
      const parsed = ClickInput.parse(raw);
      const page = session.requirePage();
      try {
        await page.locator(parsed.selector).first().click({ timeout: 3000 });
        await session.settle();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    formatResult(out) {
      return textOnly(JSON.stringify(out));
    },
  });

const TypeInput = z.object({ selector: z.string(), text: z.string() });
const typeTool = (session: BrowserSession): ToolHandler<unknown, unknown> =>
  tool<z.infer<typeof TypeInput>, { ok: boolean; error?: string }>({
    spec: {
      name: "type",
      description: "Type text into an input or textarea identified by CSS selector.",
      inputSchema: {
        type: "object",
        properties: { selector: { type: "string" }, text: { type: "string" } },
        required: ["selector", "text"],
        additionalProperties: false,
      },
    },
    async execute(raw) {
      const parsed = TypeInput.parse(raw);
      const page = session.requirePage();
      try {
        await page.locator(parsed.selector).first().fill(parsed.text, { timeout: 3000 });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    formatResult(out) {
      return textOnly(JSON.stringify(out));
    },
  });

const ScrollInput = z.object({ direction: z.enum(["up", "down", "top", "bottom"]) });
const scrollTool = (session: BrowserSession): ToolHandler<unknown, unknown> =>
  tool<z.infer<typeof ScrollInput>, { ok: boolean }>({
    spec: {
      name: "scroll",
      description: "Scroll the page. 'down' / 'up' move by ~80% of the viewport.",
      inputSchema: {
        type: "object",
        properties: { direction: { type: "string", enum: ["up", "down", "top", "bottom"] } },
        required: ["direction"],
        additionalProperties: false,
      },
    },
    async execute(raw) {
      const parsed = ScrollInput.parse(raw);
      const page = session.requirePage();
      await page.evaluate((dir) => {
        const h = window.innerHeight * 0.8;
        if (dir === "top") window.scrollTo({ top: 0 });
        else if (dir === "bottom") window.scrollTo({ top: document.body.scrollHeight });
        else window.scrollBy({ top: dir === "down" ? h : -h });
      }, parsed.direction);
      await session.settle();
      return { ok: true };
    },
    formatResult() {
      return textOnly("scrolled");
    },
  });

// ─── check_accessibility ─────────────────────────────────────────────────────

const checkA11yTool = (session: BrowserSession): ToolHandler<unknown, unknown> =>
  tool<Record<string, never>, { violations: Array<{ id: string; impact: string | null; nodes: number; help: string }> }>({
    spec: {
      name: "check_accessibility",
      description:
        "Re-run axe-core against the current DOM and return its violations. The initial scan already includes axe results; only call this if you've changed the page state via click/type/scroll.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    async execute() {
      const page = session.requirePage();
      const result = await new AxeBuilder({ page }).analyze();
      const violations = result.violations.map((v) => ({
        id: v.id,
        impact: v.impact ?? null,
        nodes: v.nodes.length,
        help: v.help,
      }));
      return { violations };
    },
    formatResult(out) {
      if (out.violations.length === 0) return textOnly("axe-core: no violations");
      const lines = out.violations.map((v) => `- ${v.id} (${v.impact}, ${v.nodes} nodes): ${v.help}`);
      return textOnly(`axe-core (${out.violations.length} violations):\n${lines.join("\n")}`);
    },
  });

// ─── report_bug ──────────────────────────────────────────────────────────────

const ReportBugInput = z.object({
  category: z.enum(BUG_CATEGORIES),
  severity: z.enum(SEVERITIES),
  confidence: z.number().min(0).max(1),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  domSnippet: z.string().max(4000).optional(),
  reproductionSteps: z.array(z.string()).optional(),
  affectedViewports: z.array(z.enum(VIEWPORTS)).optional(),
  bbox: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
});

const reportBugTool = (session: BrowserSession): ToolHandler<unknown, unknown> =>
  tool<z.infer<typeof ReportBugInput>, { accepted: boolean; index: number }>({
    spec: {
      name: "report_bug",
      description:
        "Emit a UI bug finding. Call this once per distinct bug you have evidence for. Confidence < 0.6 will be hidden from the user by default.",
      inputSchema: {
        type: "object",
        properties: {
          category: { type: "string", enum: [...BUG_CATEGORIES] },
          severity: { type: "string", enum: [...SEVERITIES] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          title: { type: "string", minLength: 1, maxLength: 200 },
          description: { type: "string", minLength: 1, maxLength: 2000 },
          domSnippet: { type: "string", maxLength: 4000 },
          reproductionSteps: { type: "array", items: { type: "string" } },
          affectedViewports: {
            type: "array",
            items: { type: "string", enum: [...VIEWPORTS] },
          },
          bbox: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
            },
            required: ["x", "y", "width", "height"],
            additionalProperties: false,
          },
        },
        required: ["category", "severity", "confidence", "title", "description"],
        additionalProperties: false,
      },
    },
    async execute(raw) {
      const parsed = ReportBugInput.parse(raw);
      const internal = {
        category: parsed.category,
        severity: parsed.severity,
        confidence: parsed.confidence,
        title: parsed.title,
        description: parsed.description,
        reproductionSteps: parsed.reproductionSteps ?? [],
        affectedViewports: (parsed.affectedViewports ?? []) as Viewport[],
        ...(parsed.domSnippet !== undefined ? { domSnippet: parsed.domSnippet } : {}),
        ...(parsed.bbox !== undefined ? { bbox: parsed.bbox } : {}),
      };
      session.reportedBugs.push(internal);
      return { accepted: true, index: session.reportedBugs.length };
    },
    formatResult(out) {
      return textOnly(`Recorded finding #${out.index}.`);
    },
  });

// ─── registry ────────────────────────────────────────────────────────────────

export function buildToolRegistry(session: BrowserSession): ToolRegistry {
  const handlers: ToolHandler<unknown, unknown>[] = [
    gotoTool(session),
    screenshotTool(session),
    getDomTool(session),
    consoleLogsTool(session),
    networkErrorsTool(session),
    clickTool(session),
    typeTool(session),
    scrollTool(session),
    checkA11yTool(session),
    reportBugTool(session),
  ];
  const registry: ToolRegistry = new Map();
  for (const h of handlers) registry.set(h.spec.name, h);
  return registry;
}
