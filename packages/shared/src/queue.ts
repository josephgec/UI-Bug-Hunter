import { Redis } from "ioredis";
import { z } from "zod";
import {
  CrawlJobSchema,
  ScanJobSchema,
  type CrawlJob,
  type ScanJob,
} from "./types.js";

export const SCAN_STREAM = "ubh:scans";
export const CRAWL_STREAM = "ubh:crawls";
export const SCAN_GROUP = "workers";
export const CRAWL_GROUP = "crawlers";

export interface QueuedScan {
  messageId: string;
  job: ScanJob;
}

export interface QueuedCrawl {
  messageId: string;
  job: CrawlJob;
}

// Generic streams queue that all of our worker queues compose with.
class StreamQueue<T> {
  constructor(
    protected readonly redis: Redis,
    private readonly stream: string,
    private readonly group: string,
    private readonly schema: z.ZodType<T>,
  ) {}

  async ensureGroup(): Promise<void> {
    try {
      await this.redis.xgroup("CREATE", this.stream, this.group, "$", "MKSTREAM");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("BUSYGROUP")) throw err;
    }
  }

  async enqueue(job: T): Promise<string> {
    const id = await this.redis.xadd(this.stream, "*", "payload", JSON.stringify(job));
    if (!id) throw new Error("xadd returned null id");
    return id;
  }

  async readOne(consumer: string, blockMs = 5000): Promise<{ messageId: string; job: T } | null> {
    const result = (await this.redis.xreadgroup(
      "GROUP",
      this.group,
      consumer,
      "COUNT",
      1,
      "BLOCK",
      blockMs,
      "STREAMS",
      this.stream,
      ">",
    )) as [string, [string, string[]][]][] | null;

    if (!result || result.length === 0) return null;
    const stream = result[0];
    if (!stream) return null;
    const messages = stream[1];
    if (!messages || messages.length === 0) return null;
    const message = messages[0];
    if (!message) return null;
    const [messageId, fields] = message;

    const payloadIdx = fields.indexOf("payload");
    if (payloadIdx === -1 || payloadIdx === fields.length - 1) {
      await this.ack(messageId);
      return null;
    }
    const raw = fields[payloadIdx + 1];
    if (!raw) {
      await this.ack(messageId);
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await this.ack(messageId);
      return null;
    }
    const job = this.schema.safeParse(parsed);
    if (!job.success) {
      await this.ack(messageId);
      return null;
    }
    return { messageId, job: job.data };
  }

  async ack(messageId: string): Promise<void> {
    await this.redis.xack(this.stream, this.group, messageId);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

export class ScanQueue extends StreamQueue<ScanJob> {
  constructor(redis: Redis) {
    super(redis, SCAN_STREAM, SCAN_GROUP, ScanJobSchema);
  }
  static fromUrl(url: string): ScanQueue {
    return new ScanQueue(new Redis(url, { maxRetriesPerRequest: null }));
  }
}

export class CrawlQueue extends StreamQueue<CrawlJob> {
  constructor(redis: Redis) {
    super(redis, CRAWL_STREAM, CRAWL_GROUP, CrawlJobSchema);
  }
  static fromUrl(url: string): CrawlQueue {
    return new CrawlQueue(new Redis(url, { maxRetriesPerRequest: null }));
  }
}
