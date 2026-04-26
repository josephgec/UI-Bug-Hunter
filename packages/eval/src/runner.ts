import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type BugCategory } from "@ubh/shared";
import { runAgentLoop } from "@ubh/worker/src/agent/loop.js";
import { createProvider } from "@ubh/worker/src/agent/providers/index.js";
import {
  SCAN_INITIAL_USER_MESSAGE,
  SCAN_SYSTEM_PROMPT,
} from "@ubh/worker/src/agent/prompts.js";
import { BrowserSession } from "@ubh/worker/src/browser.js";
import {
  formatDeterministicForPrompt,
  runDeterministicChecks,
} from "@ubh/worker/src/deterministic/index.js";
import { buildToolRegistry } from "@ubh/worker/src/tools/index.js";
import { SEED_CASES } from "./dataset.js";
import { formatReport, score, type CaseRun } from "./scoring.js";

const FIXTURE_BASE = process.env.EVAL_BASE_URL ?? "http://localhost:4173";
const OUT_DIR = resolve(".eval-output");
const CONFIDENCE_THRESHOLD = 0.6;

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  const runs: CaseRun[] = [];
  for (const c of SEED_CASES) {
    const url = `${FIXTURE_BASE}/${c.fixture}`;
    process.stdout.write(`▸ ${c.id}  ${c.fixture}\n`);
    try {
      const reported = await runOne(url);
      const filtered = new Set<BugCategory>();
      for (const r of reported) {
        if (r.confidence >= CONFIDENCE_THRESHOLD) filtered.add(r.category);
      }
      runs.push({ case: c, reportedCategories: filtered });
      process.stdout.write(
        `  → ${reported.length} findings, ${filtered.size} above threshold (${[...filtered].join(", ") || "none"})\n`,
      );
    } catch (err) {
      console.error(`  ✗ ${c.id} crashed:`, err);
      runs.push({ case: c, reportedCategories: new Set() });
    }
  }

  const report = score(runs);
  const text = formatReport(report);
  console.log("\n" + text);
  await writeFile(resolve(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(resolve(OUT_DIR, "report.txt"), text);
  console.log(`\nReport written to ${OUT_DIR}/report.{json,txt}`);
}

async function runOne(
  url: string,
): Promise<{ category: BugCategory; confidence: number }[]> {
  const session = new BrowserSession("desktop");
  try {
    const page = await session.start();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await session.settle();
    const deterministic = await runDeterministicChecks(session);
    const initialPng = await page.screenshot({ fullPage: false, type: "png" });

    const tools = buildToolRegistry(session);
    const provider = createProvider();

    await runAgentLoop({
      provider,
      tools,
      systemPrompt: SCAN_SYSTEM_PROMPT,
      initialUserMessage: [
        {
          type: "text",
          text: SCAN_INITIAL_USER_MESSAGE({
            url,
            viewport: "desktop",
            deterministic: formatDeterministicForPrompt(deterministic),
          }),
        },
        { type: "image", mediaType: "image/png", data: initialPng.toString("base64") },
      ],
      budget: { maxToolCalls: 20, maxWallTimeMs: 60000 },
    });
    return session.reportedBugs.map((b) => ({
      category: b.category as BugCategory,
      confidence: b.confidence,
    }));
  } finally {
    await session.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
