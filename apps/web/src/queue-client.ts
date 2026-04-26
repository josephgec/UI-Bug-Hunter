import { ScanQueue } from "@ubh/shared";

let cached: ScanQueue | null = null;

export function getQueue(): ScanQueue {
  if (cached) return cached;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");
  cached = ScanQueue.fromUrl(url);
  return cached;
}
