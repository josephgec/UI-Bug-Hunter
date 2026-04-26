import { CrawlQueue, ScanQueue } from "@ubh/shared";

let scanQueue: ScanQueue | null = null;
let crawlQueue: CrawlQueue | null = null;

function url(): string {
  const u = process.env.REDIS_URL;
  if (!u) throw new Error("REDIS_URL is not set");
  return u;
}

export function getQueue(): ScanQueue {
  if (scanQueue) return scanQueue;
  scanQueue = ScanQueue.fromUrl(url());
  return scanQueue;
}

export function getCrawlQueue(): CrawlQueue {
  if (crawlQueue) return crawlQueue;
  crawlQueue = CrawlQueue.fromUrl(url());
  return crawlQueue;
}
