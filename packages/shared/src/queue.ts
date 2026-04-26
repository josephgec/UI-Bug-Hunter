import { Redis } from "ioredis";
import type { ScanJob } from "./types.js";
import { ScanJobSchema } from "./types.js";

export const SCAN_STREAM = "ubh:scans";
export const SCAN_GROUP = "workers";

export interface QueuedScan {
  messageId: string;
  job: ScanJob;
}

export class ScanQueue {
  constructor(private readonly redis: Redis) {}

  static fromUrl(url: string): ScanQueue {
    return new ScanQueue(new Redis(url, { maxRetriesPerRequest: null }));
  }

  async ensureGroup(): Promise<void> {
    try {
      await this.redis.xgroup("CREATE", SCAN_STREAM, SCAN_GROUP, "$", "MKSTREAM");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("BUSYGROUP")) throw err;
    }
  }

  async enqueue(job: ScanJob): Promise<string> {
    const id = await this.redis.xadd(
      SCAN_STREAM,
      "*",
      "payload",
      JSON.stringify(job),
    );
    if (!id) throw new Error("xadd returned null id");
    return id;
  }

  /**
   * Block-read a single job for the given consumer. Returns null on timeout.
   * Caller is responsible for calling ack() once the job is durably processed.
   */
  async readOne(consumer: string, blockMs = 5000): Promise<QueuedScan | null> {
    const result = (await this.redis.xreadgroup(
      "GROUP",
      SCAN_GROUP,
      consumer,
      "COUNT",
      1,
      "BLOCK",
      blockMs,
      "STREAMS",
      SCAN_STREAM,
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
      // Malformed entry — ack to prevent a hot loop, swallow.
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
    const job = ScanJobSchema.safeParse(parsed);
    if (!job.success) {
      await this.ack(messageId);
      return null;
    }
    return { messageId, job: job.data };
  }

  async ack(messageId: string): Promise<void> {
    await this.redis.xack(SCAN_STREAM, SCAN_GROUP, messageId);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
