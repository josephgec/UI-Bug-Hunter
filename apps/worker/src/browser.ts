import { chromium, type Browser, type BrowserContext, type ConsoleMessage, type Page } from "playwright";
import { VIEWPORT_PRESETS, type Viewport } from "@ubh/shared";

export interface ConsoleEntry {
  level: "log" | "info" | "warning" | "error" | "debug" | "other";
  text: string;
  url?: string;
  lineNumber?: number;
  at: number;
  viewport?: Viewport;
}

export interface NetworkErrorEntry {
  url: string;
  method: string;
  status: number;
  statusText: string;
  resourceType: string;
  at: number;
  viewport?: Viewport;
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
  affectedViewports: Viewport[];
}

/**
 * Header / cookie injection for authenticated scans. Plaintext credentials
 * arrive here from the credential vault — the caller is responsible for
 * decrypting; BrowserSession never sees ciphertext or key material.
 */
export interface AuthInjection {
  headers?: Record<string, string>;
  cookies?: Array<{ name: string; value: string; domain?: string; path?: string }>;
  basicAuth?: { username: string; password: string };
}

// Wraps a single Playwright browser. Phase 2 supports multiple viewports per
// session — one BrowserContext + Page per viewport, all sharing the
// session's console / network / findings buffers (each entry tagged with
// the viewport it came from).
export class BrowserSession {
  private browser: Browser | null = null;
  /** keyed by viewport */
  private contexts = new Map<Viewport, { context: BrowserContext; page: Page }>();
  /** the "primary" page for tools that don't take a viewport argument */
  primaryViewport: Viewport;

  consoleEntries: ConsoleEntry[] = [];
  networkErrors: NetworkErrorEntry[] = [];
  reportedBugs: ReportedBugInternal[] = [];

  constructor(public readonly viewports: Viewport[], private readonly auth?: AuthInjection) {
    if (viewports.length === 0) throw new Error("BrowserSession: viewports must be non-empty");
    this.primaryViewport = viewports[0]!;
  }

  async start(): Promise<void> {
    this.browser = await chromium.launch({ headless: true });
    // Open a context per viewport. Auth is injected once per context.
    await Promise.all(
      this.viewports.map(async (viewport) => {
        const preset = VIEWPORT_PRESETS[viewport];
        const context = await this.browser!.newContext({
          viewport: { width: preset.width, height: preset.height },
          deviceScaleFactor: preset.deviceScaleFactor,
          isMobile: preset.isMobile,
          hasTouch: preset.hasTouch,
          ...(preset.userAgent ? { userAgent: preset.userAgent } : {}),
          ...(this.auth?.basicAuth
            ? { httpCredentials: { username: this.auth.basicAuth.username, password: this.auth.basicAuth.password } }
            : {}),
          ...(this.auth?.headers ? { extraHTTPHeaders: this.auth.headers } : {}),
        });
        if (this.auth?.cookies && this.auth.cookies.length > 0) {
          await context.addCookies(
            this.auth.cookies.map((c) => ({
              name: c.name,
              value: c.value,
              domain: c.domain ?? "",
              path: c.path ?? "/",
              ...(c.domain ? {} : { url: "" }),
            })) as Parameters<typeof context.addCookies>[0],
          );
        }
        const page = await context.newPage();
        this.wireListeners(page, viewport);
        this.contexts.set(viewport, { context, page });
      }),
    );
  }

  /** Convenience for the agent: the page in the primary viewport. */
  get page(): Page | null {
    return this.contexts.get(this.primaryViewport)?.page ?? null;
  }

  pageFor(viewport: Viewport): Page {
    const ctx = this.contexts.get(viewport);
    if (!ctx) throw new Error(`No context for viewport ${viewport}`);
    return ctx.page;
  }

  private wireListeners(page: Page, viewport: Viewport): void {
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
        viewport,
      });
    });

    page.on("pageerror", (err) => {
      this.consoleEntries.push({
        level: "error",
        text: `Uncaught: ${err.message}`,
        at: Date.now(),
        viewport,
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
          viewport,
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
        viewport,
      });
    });
  }

  async gotoAll(url: string, opts?: { timeout?: number }): Promise<void> {
    await Promise.all(
      [...this.contexts.values()].map(async ({ page }) => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts?.timeout ?? 30000 });
      }),
    );
  }

  /**
   * Wait for the page to look stable, then disable animations.
   * - networkidle (no inflight requests for 500ms)
   * - inject CSS to kill animations and transitions
   * - lazy-load handling: scroll to bottom, then back to top
   * - two-screenshot stability check (up to 3 retries)
   *
   * Operates on the primary viewport unless `viewport` is given. Returns
   * { stable } — false means the page never settled, callers should
   * downgrade confidence on derived findings.
   */
  async settle(viewport?: Viewport): Promise<{ stable: boolean }> {
    const page = viewport ? this.pageFor(viewport) : this.requirePage();
    try {
      await page.waitForLoadState("networkidle", { timeout: 8000 });
    } catch {
      // Some sites keep long-lived connections (analytics websockets); fall through.
    }
    await page.addStyleTag({
      content: `*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }`,
    });

    // Trigger lazy-loaded content by scrolling to the bottom and back to top.
    await page.evaluate(async () => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const step = window.innerHeight * 0.8;
      let lastScroll = 0;
      while (window.scrollY + window.innerHeight < document.body.scrollHeight) {
        const before = window.scrollY;
        window.scrollBy({ top: step });
        await wait(120);
        if (window.scrollY === before) break;
        if (window.scrollY === lastScroll) break;
        lastScroll = window.scrollY;
      }
      window.scrollTo({ top: 0 });
    });
    try {
      await page.waitForLoadState("networkidle", { timeout: 4000 });
    } catch {
      /* see above */
    }

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

  async settleAll(): Promise<Map<Viewport, { stable: boolean }>> {
    const out = new Map<Viewport, { stable: boolean }>();
    await Promise.all(
      [...this.contexts.keys()].map(async (viewport) => {
        out.set(viewport, await this.settle(viewport));
      }),
    );
    return out;
  }

  async screenshotAll(): Promise<Map<Viewport, Buffer>> {
    const out = new Map<Viewport, Buffer>();
    await Promise.all(
      [...this.contexts.entries()].map(async ([viewport, { page }]) => {
        out.set(viewport, await page.screenshot({ fullPage: false, type: "png" }));
      }),
    );
    return out;
  }

  requirePage(): Page {
    const page = this.page;
    if (!page) throw new Error("BrowserSession.start() not called");
    return page;
  }

  async close(): Promise<void> {
    for (const { context } of this.contexts.values()) {
      await context.close().catch(() => {});
    }
    this.contexts.clear();
    await this.browser?.close().catch(() => {});
    this.browser = null;
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
