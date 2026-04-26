import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RedisMock from "ioredis-mock";
import { ScanQueue, SCAN_GROUP, SCAN_STREAM } from "./queue.js";
import type { ScanJob } from "./types.js";

describe("ScanQueue", () => {
  let redis: InstanceType<typeof RedisMock>;
  let queue: ScanQueue;

  beforeEach(() => {
    redis = new RedisMock();
    // ScanQueue takes ioredis Redis; ioredis-mock matches the surface we use.
    queue = new ScanQueue(redis as never);
  });

  afterEach(async () => {
    await redis.quit();
  });

  it("ensureGroup creates the consumer group and is idempotent", async () => {
    await queue.ensureGroup();
    // Calling again must not throw on BUSYGROUP.
    await queue.ensureGroup();
    const groups = await redis.xinfo("GROUPS", SCAN_STREAM);
    expect(Array.isArray(groups)).toBe(true);
  });

  it("enqueue + readOne round-trips a ScanJob", async () => {
    await queue.ensureGroup();
    const job: ScanJob = {
      scanId: "scan_1",
      projectId: "proj_1",
      url: "https://example.com",
      viewport: "desktop",
    };
    await queue.enqueue(job);
    const got = await queue.readOne("test-consumer", 100);
    expect(got).not.toBeNull();
    expect(got!.job).toEqual(job);
  });

  it("readOne returns null on empty stream within block timeout", async () => {
    await queue.ensureGroup();
    const got = await queue.readOne("test-consumer", 50);
    expect(got).toBeNull();
  });

  it("ack removes the message from the pending list", async () => {
    await queue.ensureGroup();
    await queue.enqueue({
      scanId: "scan_2",
      projectId: "proj_2",
      url: "https://example.com",
      viewport: "desktop",
    });
    const got = await queue.readOne("test-consumer", 100);
    expect(got).not.toBeNull();
    await queue.ack(got!.messageId);

    const pending = (await redis.xpending(SCAN_STREAM, SCAN_GROUP)) as unknown as [
      number,
      ...unknown[],
    ];
    expect(pending[0]).toBe(0);
  });

  it("readOne tolerates malformed JSON by acking and returning null", async () => {
    await queue.ensureGroup();
    // Put a bad payload directly.
    await redis.xadd(SCAN_STREAM, "*", "payload", "{not json");
    const got = await queue.readOne("test-consumer", 100);
    expect(got).toBeNull();
  });

  it("readOne tolerates payload that doesn't match ScanJobSchema", async () => {
    await queue.ensureGroup();
    await redis.xadd(
      SCAN_STREAM,
      "*",
      "payload",
      JSON.stringify({ wrong: "shape" }),
    );
    const got = await queue.readOne("test-consumer", 100);
    expect(got).toBeNull();
  });
});
