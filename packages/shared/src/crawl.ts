// Pure-logic helpers for the crawler. The actual link extraction lives in the
// worker (it has the live page); this module handles URL normalization,
// same-origin filtering, and the BFS frontier.

export interface CrawlFrontier {
  /** URLs we've discovered but not yet scanned, with the depth we'll hit them at. */
  queue: { url: string; depth: number }[];
  /** Normalized URLs we've already enqueued — used to dedup. */
  seen: Set<string>;
  maxDepth: number;
  maxPages: number;
  /** Number of pages already scanned (or in-flight). */
  scannedCount: number;
}

export function newFrontier(opts: {
  seedUrl: string;
  maxDepth: number;
  maxPages: number;
}): CrawlFrontier {
  const seed = normalizeUrl(opts.seedUrl);
  return {
    queue: [{ url: seed, depth: 0 }],
    seen: new Set([seed]),
    maxDepth: opts.maxDepth,
    maxPages: opts.maxPages,
    scannedCount: 0,
  };
}

export function takeNext(frontier: CrawlFrontier): { url: string; depth: number } | null {
  if (frontier.scannedCount >= frontier.maxPages) return null;
  const next = frontier.queue.shift();
  if (!next) return null;
  frontier.scannedCount += 1;
  return next;
}

/**
 * Add discovered URLs to the frontier. URLs are filtered to same-origin as
 * the seed, normalized, and deduped against the seen set. Anything past
 * maxDepth is dropped.
 */
export function addDiscovered(
  frontier: CrawlFrontier,
  discovered: string[],
  fromDepth: number,
  origin: string,
): { added: number; rejected: number } {
  const nextDepth = fromDepth + 1;
  if (nextDepth > frontier.maxDepth) return { added: 0, rejected: discovered.length };
  let added = 0;
  let rejected = 0;
  for (const raw of discovered) {
    const normalized = sameOriginNormalized(raw, origin);
    if (!normalized) {
      rejected += 1;
      continue;
    }
    if (frontier.seen.has(normalized)) {
      continue;
    }
    if (frontier.seen.size >= frontier.maxPages * 4) {
      // Cap the seen-set memory; in practice maxPages is small enough that
      // this never fires, but it's a safety belt against a runaway page.
      break;
    }
    frontier.seen.add(normalized);
    frontier.queue.push({ url: normalized, depth: nextDepth });
    added += 1;
  }
  return { added, rejected };
}

/**
 * Resolve a possibly-relative href to an absolute URL, scope it to the same
 * origin as the seed, drop fragments, and normalize trailing slashes /
 * query-param order. Returns null if the URL is off-origin, mailto:, tel:, etc.
 */
export function sameOriginNormalized(raw: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const seedOrigin = new URL(origin).origin;
  if (url.origin !== seedOrigin) return null;
  return normalizeUrl(url.toString());
}

export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  url.hash = "";
  // Sort query params for stable ordering — ?a=1&b=2 and ?b=2&a=1 are the
  // same page from a crawler's perspective.
  const params = [...url.searchParams.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  url.search = "";
  for (const [k, v] of params) url.searchParams.append(k, v);
  // Collapse trailing "/" on non-root paths so /foo/ and /foo dedup.
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}
