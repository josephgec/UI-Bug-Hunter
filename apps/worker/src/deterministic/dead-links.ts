import type { BrowserSession } from "../browser.js";

export interface DeadLink {
  href: string;
  status: number | "fail";
  statusText: string;
  /** A short CSS selector pointing at the offending <a>. */
  selector?: string;
}

interface CheckOptions {
  /** Cap the number of links checked. Default 50. */
  maxLinks?: number;
  /** Per-request timeout in ms. Default 5000. */
  timeoutMs?: number;
  /** Only check same-origin links by default to keep runtime bounded. */
  sameOriginOnly?: boolean;
  /** Concurrency. Default 8. */
  concurrency?: number;
}

/**
 * Enumerate <a href> on the page and HEAD-request each. Anything that returns
 * 4xx/5xx, fails to connect, or times out is a dead-link finding.
 *
 * We deliberately don't follow links and don't render them — this is a cheap
 * deterministic check, not a sub-crawl. The agent can still investigate the
 * top results via its own tools.
 */
export async function detectDeadLinks(
  session: BrowserSession,
  origin: string,
  opts: CheckOptions = {},
): Promise<DeadLink[]> {
  const max = opts.maxLinks ?? 50;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const sameOriginOnly = opts.sameOriginOnly ?? true;
  const concurrency = opts.concurrency ?? 8;

  const page = session.requirePage();
  const candidates = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a[href]"))
      .map((a) => {
        const el = a as HTMLAnchorElement;
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : "";
        const cls = el.classList.length ? `.${Array.from(el.classList).slice(0, 1).join(".")}` : "";
        return { href: el.href, selector: `${tag}${id}${cls}` };
      })
      .filter((x) => x.href && x.href.startsWith("http"));
  });

  const seedOrigin = (() => {
    try {
      return new URL(origin).origin;
    } catch {
      return null;
    }
  })();

  const seen = new Set<string>();
  const filtered: typeof candidates = [];
  for (const c of candidates) {
    if (seen.has(c.href)) continue;
    seen.add(c.href);
    if (sameOriginOnly && seedOrigin) {
      try {
        if (new URL(c.href).origin !== seedOrigin) continue;
      } catch {
        continue;
      }
    }
    filtered.push(c);
    if (filtered.length >= max) break;
  }

  const results: DeadLink[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, filtered.length) }, async () => {
      while (cursor < filtered.length) {
        const idx = cursor++;
        const item = filtered[idx]!;
        const r = await checkOne(item.href, timeoutMs);
        if (r) {
          results.push({ ...r, selector: item.selector });
        }
      }
    }),
  );
  return results;
}

async function checkOne(
  href: string,
  timeoutMs: number,
): Promise<{ href: string; status: number | "fail"; statusText: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(href, { method: "HEAD", redirect: "follow", signal: controller.signal });
    } catch {
      // Some servers (notably certain CDNs) reject HEAD; fall back to GET with
      // a small Range header so we don't pull the whole body.
      res = await fetch(href, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { range: "bytes=0-0" },
      });
    }
    if (res.status >= 400) {
      return { href, status: res.status, statusText: res.statusText };
    }
    return null;
  } catch (err) {
    return { href, status: "fail", statusText: err instanceof Error ? err.message : "fetch_failed" };
  } finally {
    clearTimeout(timer);
  }
}
