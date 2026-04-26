import { chromium, type Browser, type BrowserContext, type ConsoleMessage, type Page } from "playwright";
import { VIEWPORT_PRESETS, type Viewport } from "@ubh/shared";

export interface ConsoleEntry {
  level: "log" | "info" | "warning" | "error" | "debug" | "other";
  text: string;
  url?: string;
  lineNumber?: number;
  at: number;
}

export interface NetworkErrorEntry {
  url: string;
  method: string;
  status: number;
  statusText: string;
  resourceType: string;
  at: number;
}

export interface ReportedBugInternal {
  category: string;
  severity: string;
  confidence: number;
  title: string;
  description: string;
  evidenceScreenshotPath?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  domSnippet?: string;
  reproductionSteps: string[];
}

// Wraps a single Playwright page so the agent's tools share state cleanly:
// console events, failed responses, and emitted findings are all accumulated
// here. One BrowserSession per scan; tear down with close().
export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  page: Page | null = null;

  consoleEntries: ConsoleEntry[] = [];
  networkErrors: NetworkErrorEntry[] = [];
  reportedBugs: ReportedBugInternal[] = [];

  constructor(public readonly viewport: Viewport) {}

  async start(): Promise<Page> {
    const preset = VIEWPORT_PRESETS[this.viewport];
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      viewport: { width: preset.width, height: preset.height },
      deviceScaleFactor: preset.deviceScaleFactor,
      isMobile: preset.isMobile,
      hasTouch: preset.hasTouch,
      ...(preset.userAgent ? { userAgent: preset.userAgent } : {}),
    });
    const page = await this.context.newPage();
    this.page = page;
    this.wireListeners(page);
    return page;
  }

  private wireListeners(page: Page): void {
    page.on("console", (msg: ConsoleMessage) => {
      const location = msg.location();
      this.consoleEntries.push({
        level: normalizeConsoleLevel(msg.type()),
        text: msg.text(),
        ...(location.url ? { url: location.url } : {}),
        ...(typeof location.lineNumber === "number"
          ? { lineNumber: location.lineNumber }
          : {}),
        at: Date.now(),
      });
    });

    page.on("pageerror", (err) => {
      this.consoleEntries.push({
        level: "error",
        text: `Uncaught: ${err.message}`,
        at: Date.now(),
      });
    });

    page.on("response", (response) => {
      const status = response.status();
      if (status >= 400) {
        this.networkErrors.push({
          url: response.url(),
          method: response.request().method(),
          status,
          statusText: response.statusText(),
          resourceType: response.request().resourceType(),
          at: Date.now(),
        });
      }
    });

    page.on("requestfailed", (request) => {
      this.networkErrors.push({
        url: request.url(),
        method: request.method(),
        status: 0,
        statusText: request.failure()?.errorText ?? "request_failed",
        resourceType: request.resourceType(),
        at: Date.now(),
      });
    });
  }

  /**
   * Wait for the page to look stable, then disable animations.
   * - networkidle (no inflight requests for 500ms)
   * - inject CSS to kill animations and transitions
   * - take two screenshots ~250ms apart and compare; retry up to 3x.
   *
   * Returns true if the page settled cleanly, false if it remained unstable
   * across retries (caller may downgrade confidence on derived findings).
   */
  async settle(): Promise<{ stable: boolean }> {
    const page = this.requirePage();
    try {
      await page.waitForLoadState("networkidle", { timeout: 8000 });
    } catch {
      // Some sites keep long-lived connections (analytics websockets); fall through.
    }
    await page.addStyleTag({
      content: `*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }`,
    });

    let stable = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const a = await page.screenshot({ fullPage: false, type: "png" });
      await page.waitForTimeout(250);
      const b = await page.screenshot({ fullPage: false, type: "png" });
      if (buffersEqual(a, b)) {
        stable = true;
        break;
      }
    }
    return { stable };
  }

  requirePage(): Page {
    if (!this.page) throw new Error("BrowserSession.start() not called");
    return this.page;
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.context = null;
    this.browser = null;
    this.page = null;
  }
}

function normalizeConsoleLevel(t: string): ConsoleEntry["level"] {
  switch (t) {
    case "log":
    case "info":
    case "warning":
    case "error":
    case "debug":
      return t;
    default:
      return "other";
  }
}

function buffersEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return a.equals(b);
}
