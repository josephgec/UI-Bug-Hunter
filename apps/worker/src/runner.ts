import { prisma, ScanStatus } from "@ubh/db";
import type { ScanJob } from "@ubh/shared";
import { runAgentLoop } from "./agent/loop.js";
import { createProvider } from "./agent/providers/index.js";
import {
  SCAN_INITIAL_USER_MESSAGE,
  SCAN_SYSTEM_PROMPT,
} from "./agent/prompts.js";
import type { LLMUserContentBlock } from "./agent/llm.js";
import { ArtifactStore } from "./artifacts.js";
import { BrowserSession } from "./browser.js";
import {
  formatDeterministicForPrompt,
  runDeterministicChecks,
} from "./deterministic/index.js";
import { buildToolRegistry } from "./tools/index.js";

interface RunnerConfig {
  maxToolCalls: number;
  maxWallTimeMs: number;
}

export async function runScan(job: ScanJob, config: RunnerConfig): Promise<void> {
  await prisma.scan.update({
    where: { id: job.scanId },
    data: { status: ScanStatus.RUNNING, startedAt: new Date() },
  });

  const artifacts = ArtifactStore.fromEnv();
  const session = new BrowserSession(job.viewport);
  const startedAt = Date.now();

  try {
    const page = await session.start();
    await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await session.settle();

    const deterministic = await runDeterministicChecks(session);

    // Initial screenshot (also fed into the agent's first turn).
    const initialPng = await page.screenshot({ fullPage: false, type: "png" });
    const initialUrl = await artifacts.writePng(job.scanId, "initial", initialPng);

    const initialUser: LLMUserContentBlock[] = [
      {
        type: "text",
        text: SCAN_INITIAL_USER_MESSAGE({
          url: job.url,
          viewport: job.viewport,
          deterministic: formatDeterministicForPrompt(deterministic),
        }),
      },
      { type: "image", mediaType: "image/png", data: initialPng.toString("base64") },
    ];

    const tools = buildToolRegistry(session);
    const provider = createProvider();

    const result = await runAgentLoop({
      provider,
      tools,
      systemPrompt: SCAN_SYSTEM_PROMPT,
      initialUserMessage: initialUser,
      budget: {
        maxToolCalls: config.maxToolCalls,
        maxWallTimeMs: config.maxWallTimeMs,
      },
      onTrace: (e) => {
        // Lightweight logging — wire to OpenTelemetry once §16 of the design
        // doc gets serious about observability.
        if (process.env.WORKER_TRACE === "1") {
          console.log(JSON.stringify({ scan: job.scanId, ...e }));
        }
      },
    });

    // Persist findings + a baseline finding for any deterministic check that
    // the agent didn't echo. The agent is supposed to use deterministic
    // results as evidence, but we still want the raw data to be visible if
    // the model decides to skip them.
    await prisma.$transaction([
      ...session.reportedBugs.map((bug) =>
        prisma.finding.create({
          data: {
            scanId: job.scanId,
            category: bug.category,
            severity: bug.severity,
            confidence: bug.confidence,
            title: bug.title,
            description: bug.description,
            screenshotUrl: bug.evidenceScreenshotPath ?? initialUrl,
            ...(bug.bbox ? { bbox: bug.bbox } : {}),
            ...(bug.domSnippet !== undefined ? { domSnippet: bug.domSnippet } : {}),
            reproductionSteps: bug.reproductionSteps,
          },
        }),
      ),
      prisma.scan.update({
        where: { id: job.scanId },
        data: {
          status: ScanStatus.COMPLETED,
          finishedAt: new Date(),
          toolCalls: result.toolCalls,
        },
      }),
    ]);

    console.log(
      `[scan ${job.scanId}] done in ${Date.now() - startedAt}ms — ${session.reportedBugs.length} findings, ${result.toolCalls} tool calls (${result.endedReason})`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.scan.update({
      where: { id: job.scanId },
      data: {
        status: ScanStatus.FAILED,
        finishedAt: new Date(),
        errorMessage: message,
      },
    });
    console.error(`[scan ${job.scanId}] failed: ${message}`);
    throw err;
  } finally {
    await session.close();
  }
}
