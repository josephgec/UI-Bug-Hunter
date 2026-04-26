import { chromium } from "playwright";
import { addDiscovered, newFrontier, takeNext, type Viewport } from "@ubh/shared";
import { prisma, CrawlStatus, ScanStatus } from "@ubh/db";
import { ScanQueue } from "@ubh/shared";
import type { CrawlJob } from "@ubh/shared";

export interface CrawlerConfig {
  redisUrl: string;
}

/**
 * Drive a crawl: discover same-origin links from the seed page, enqueue per-
 * page Scan jobs (each multi-viewport), and update the Crawl row's progress.
 *
 * The crawler runs a *separate* browser from the per-page workers so we don't
 * spin up a full multi-viewport browser just to extract <a hrefs>.
 */
export async function runCrawl(job: CrawlJob, config: CrawlerConfig): Promise<void> {
  await prisma.crawl.update({
    where: { id: job.crawlId },
    data: { status: CrawlStatus.RUNNING, startedAt: new Date() },
  });

  const queue = ScanQueue.fromUrl(config.redisUrl);
  await queue.ensureGroup();

  const frontier = newFrontier({
    seedUrl: job.seedUrl,
    maxDepth: job.maxDepth,
    maxPages: job.maxPages,
  });
  const origin = new URL(job.seedUrl).origin;

  const browser = await chromium.launch({ headless: true });
  try {
    while (true) {
      const next = takeNext(frontier);
      if (!next) break;

      const links = await extractLinks(browser, next.url).catch((err) => {
        console.error(`[crawl ${job.crawlId}] link extraction failed for ${next.url}:`, err);
        return [];
      });

      addDiscovered(frontier, links, next.depth, origin);

      // Enqueue a Scan for this page.
      const scan = await prisma.scan.create({
        data: {
          projectId: job.projectId,
          crawlId: job.crawlId,
          targetUrl: next.url,
          viewports: job.viewports,
          depth: next.depth,
          status: ScanStatus.QUEUED,
        },
      });

      await queue.enqueue({
        scanId: scan.id,
        projectId: job.projectId,
        url: next.url,
        viewports: job.viewports as Viewport[],
        crawlId: job.crawlId,
        depth: next.depth,
        credentialIds: job.credentialIds,
      });

      await prisma.crawl.update({
        where: { id: job.crawlId },
        data: { pagesScanned: { increment: 1 } },
      });
    }

    await prisma.crawl.update({
      where: { id: job.crawlId },
      data: { status: CrawlStatus.COMPLETED, finishedAt: new Date() },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.crawl.update({
      where: { id: job.crawlId },
      data: { status: CrawlStatus.FAILED, finishedAt: new Date(), errorMessage: message },
    });
    throw err;
  } finally {
    await browser.close().catch(() => {});
    await queue.close().catch(() => {});
  }
}

async function extractLinks(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  url: string,
): Promise<string[]> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    try {
      await page.waitForLoadState("networkidle", { timeout: 4000 });
    } catch {
      /* fine */
    }
    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]"))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => typeof h === "string" && h.length > 0),
    );
    return hrefs;
  } finally {
    await context.close().catch(() => {});
  }
}
