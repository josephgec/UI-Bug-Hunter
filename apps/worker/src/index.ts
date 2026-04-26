import { hostname } from "node:os";
import { ScanQueue } from "@ubh/shared";
import { runScan } from "./runner.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const CONSUMER = `${hostname()}-${process.pid}`;
const MAX_TOOL_CALLS = Number(process.env.SCAN_MAX_TOOL_CALLS ?? "40");
const MAX_WALL_TIME_MS = Number(process.env.SCAN_MAX_WALL_TIME_MS ?? "120000");

async function main(): Promise<void> {
  const queue = ScanQueue.fromUrl(REDIS_URL);
  await queue.ensureGroup();
  console.log(`[worker ${CONSUMER}] consuming ubh:scans`);

  let shuttingDown = false;
  const onSignal = (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker ${CONSUMER}] ${sig} received, finishing in-flight scan…`);
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  while (!shuttingDown) {
    const queued = await queue.readOne(CONSUMER, 5000);
    if (!queued) continue;
    try {
      await runScan(queued.job, {
        maxToolCalls: MAX_TOOL_CALLS,
        maxWallTimeMs: MAX_WALL_TIME_MS,
      });
    } catch (err) {
      console.error(`[worker] scan ${queued.job.scanId} crashed:`, err);
    } finally {
      await queue.ack(queued.messageId);
    }
  }

  await queue.close();
  console.log(`[worker ${CONSUMER}] exit`);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
