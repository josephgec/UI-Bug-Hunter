import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScanQueue, SCAN_GROUP, SCAN_STREAM } from "./queue.js";
import type { ScanJob } from "./types.js";

// ioredis-mock doesn't implement Redis Streams (xgroup/xreadgroup/xack), so we
// hand-roll the minimum fake needed for the consumer-group lifecycle. This is
// also sharper as a unit test: failures here mean ScanQueue regressed, not
// ioredis-mock.
class FakeStreamsRedis {
  private entries: { id: string; fields: string[] }[] = [];
  private seq = 0;
  private groups = new Map<string, { lastDelivered: string; pending: Set<string> }>();

  async xgroup(
    cmd: string,
    _stream: string,
    group: string,
    _start: string,
    _mkstream: string,
  ): Promise<string> {
    if (cmd !== "CREATE") throw new Error(`unsupported xgroup subcommand: ${cmd}`);
    if (this.groups.has(group)) {
      throw new Error("BUSYGROUP Consumer Group name already exists");
    }
    this.groups.set(group, { lastDelivered: "0-0", pending: new Set() });
    return "OK";
  }

  async xadd(
    _stream: string,
    _idArg: string,
    key: string,
    value: string,
  ): Promise<string> {
    const id = `${Date.now()}-${this.seq++}`;
    this.entries.push({ id, fields: [key, value] });
    return id;
  }

  async xreadgroup(...args: unknown[]): Promise<unknown> {
    const a = args as string[];
    const groupIdx = a.indexOf("GROUP");
    const group = a[groupIdx + 1]!;
    const g = this.groups.get(group);
    if (!g) throw new Error("NOGROUP");
    const msg = this.entries.find((e) => e.id > g.lastDelivered);
    if (!msg) return null;
    g.lastDelivered = msg.id;
    g.pending.add(msg.id);
    return [[SCAN_STREAM, [[msg.id, msg.fields]]]];
  }

  async xack(_stream: string, group: string, id: string): Promise<number> {
    const g = this.groups.get(group);
    if (!g) return 0;
    return g.pending.delete(id) ? 1 : 0;
  }

  pendingCount(group: string): number {
    return this.groups.get(group)?.pending.size ?? 0;
  }

  async quit(): Promise<void> {}
}

describe("ScanQueue", () => {
  let redis: FakeStreamsRedis;
  let queue: ScanQueue;

  beforeEach(() => {
    redis = new FakeStreamsRedis();
    queue = new ScanQueue(redis as never);
  });

  afterEach(async () => {
    await redis.quit();
  });

  it("ensureGroup creates the consumer group and is idempotent", async () => {
    await queue.ensureGroup();
    // Calling again must not throw on BUSYGROUP.
    await expect(queue.ensureGroup()).resolves.toBeUndefined();
  });

  it("ensureGroup propagates non-BUSYGROUP errors", async () => {
    const badRedis = {
      xgroup: async () => {
        throw new Error("ERR something else");
      },
    };
    const q = new ScanQueue(badRedis as never);
    await expect(q.ensureGroup()).rejects.toThrow("ERR something else");
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

  it("readOne returns null on empty stream", async () => {
    await queue.ensureGroup();
    const got = await queue.readOne("test-consumer", 50);
    expect(got).toBeNull();
  });

  it("ack removes the message from the pending set", async () => {
    await queue.ensureGroup();
    await queue.enqueue({
      scanId: "scan_2",
      projectId: "proj_2",
      url: "https://example.com",
      viewport: "desktop",
    });
    const got = await queue.readOne("test-consumer", 100);
    expect(got).not.toBeNull();
    expect(redis.pendingCount(SCAN_GROUP)).toBe(1);
    await queue.ack(got!.messageId);
    expect(redis.pendingCount(SCAN_GROUP)).toBe(0);
  });

  it("readOne tolerates malformed JSON by acking and returning null", async () => {
    await queue.ensureGroup();
    // Bypass enqueue() and write a bad payload directly.
    await redis.xadd(SCAN_STREAM, "*", "payload", "{not json");
    const got = await queue.readOne("test-consumer", 100);
    expect(got).toBeNull();
    expect(redis.pendingCount(SCAN_GROUP)).toBe(0);
  });

  it("readOne tolerates payload that doesn't match ScanJobSchema", async () => {
    await queue.ensureGroup();
    await redis.xadd(SCAN_STREAM, "*", "payload", JSON.stringify({ wrong: "shape" }));
    const got = await queue.readOne("test-consumer", 100);
    expect(got).toBeNull();
    expect(redis.pendingCount(SCAN_GROUP)).toBe(0);
  });

  it("readOne tolerates an entry without a payload field", async () => {
    await queue.ensureGroup();
    await redis.xadd(SCAN_STREAM, "*", "junk", "no-payload-key");
    const got = await queue.readOne("test-consumer", 100);
    expect(got).toBeNull();
  });
});
