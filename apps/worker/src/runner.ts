import { prisma, ScanStatus } from "@ubh/db";
import {
  findingDedupHash,
  scanFingerprint,
  type ScanJob,
  type Viewport,
} from "@ubh/shared";
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
import { dispatchFinding } from "./destinations/dispatcher.js";
import { executeFlow } from "./flows/executor.js";
import { loadAuthInjection } from "./security/credentials.js";
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
  const auth = await loadAuthInjection(job.credentialIds);
  const session = new BrowserSession(job.viewports as Viewport[], auth);
  const startedAt = Date.now();

  let flowFailedAt: number | null = null;
  try {
    await session.start();
    await session.gotoAll(job.url);
    await session.settleAll();

    // Phase 3: if this scan is bound to a flow, run the steps before handing
    // control to the agent. Findings produced after the flow are tagged with
    // the last attempted step index so the dashboard can show "broken on
    // step 3".
    if (job.flowId) {
      const flow = await prisma.flow.findUnique({ where: { id: job.flowId } });
      if (flow) {
        const flowResult = await executeFlow(session, { steps: flow.steps as unknown }, {
          strictAssertions: flow.strictAssertions,
        });
        flowFailedAt = flowResult.failedAt;
      }
    }

    const origin = new URL(job.url).origin;
    const deterministic = await runDeterministicChecks(session, origin);

    // One screenshot per viewport — all attached to the agent's first turn so
    // it can reason across breakpoints in a single LLM call.
    const screenshots = await session.screenshotAll();
    const initialContent: LLMUserContentBlock[] = [
      {
        type: "text",
        text: SCAN_INITIAL_USER_MESSAGE({
          url: job.url,
          viewports: job.viewports as string[],
          deterministic: formatDeterministicForPrompt(deterministic),
        }),
      },
    ];
    for (const viewport of job.viewports as Viewport[]) {
      const buf = screenshots.get(viewport);
      if (!buf) continue;
      // Persist alongside the scan for the dashboard to render.
      await artifacts.writePng(job.scanId, `initial-${viewport}`, buf);
      initialContent.push({
        type: "text",
        text: `(${viewport})`,
      });
      initialContent.push({
        type: "image",
        mediaType: "image/png",
        data: buf.toString("base64"),
      });
    }

    const tools = buildToolRegistry(session);
    const provider = createProvider();

    const result = await runAgentLoop({
      provider,
      tools,
      systemPrompt: SCAN_SYSTEM_PROMPT,
      initialUserMessage: initialContent,
      budget: {
        maxToolCalls: config.maxToolCalls,
        maxWallTimeMs: config.maxWallTimeMs,
      },
      onTrace: (e) => {
        if (process.env.WORKER_TRACE === "1") {
          console.log(JSON.stringify({ scan: job.scanId, ...e }));
        }
      },
    });

    // Crawl-level dedup: if this scan is part of a crawl, look up findings
    // already reported in sibling scans by their dedupHash and skip dupes.
    let existingHashes = new Set<string>();
    if (job.crawlId) {
      const dupes = await prisma.finding.findMany({
        where: { scan: { crawlId: job.crawlId } },
        select: { dedupHash: true },
      });
      existingHashes = new Set(dupes.map((d) => d.dedupHash).filter((h): h is string => !!h));
    }

    const findingRows = session.reportedBugs
      .map((bug) => ({
        ...bug,
        dedupHash: findingDedupHash({
          category: bug.category as never,
          title: bug.title,
          domSnippet: bug.domSnippet ?? null,
        }),
      }))
      .filter((bug) => !existingHashes.has(bug.dedupHash));

    const created = await prisma.$transaction([
      ...findingRows.map((bug) =>
        prisma.finding.create({
          data: {
            scanId: job.scanId,
            category: bug.category,
            severity: bug.severity,
            confidence: bug.confidence,
            title: bug.title,
            description: bug.description,
            screenshotUrl: bug.evidenceScreenshotPath ?? null,
            ...(bug.bbox ? { bbox: bug.bbox } : {}),
            ...(bug.domSnippet !== undefined ? { domSnippet: bug.domSnippet } : {}),
            reproductionSteps: bug.reproductionSteps,
            dedupHash: bug.dedupHash,
            ...(flowFailedAt !== null ? { flowStepIndex: flowFailedAt } : {}),
          },
        }),
      ),
      prisma.scan.update({
        where: { id: job.scanId },
        data: {
          status: ScanStatus.COMPLETED,
          finishedAt: new Date(),
          toolCalls: result.toolCalls,
          fingerprint: scanFingerprint(job.url, job.viewports),
        },
      }),
    ]);

    // Fire-and-forget dispatch to configured destinations. Failures are logged
    // and stored on DestinationDispatch but do not fail the scan.
    for (const finding of created) {
      if ("category" in finding) {
        void dispatchFinding(finding.id, job.projectId).catch((err) => {
          console.error(`[scan ${job.scanId}] dispatch failed:`, err);
        });
      }
    }

    console.log(
      `[scan ${job.scanId}] done in ${Date.now() - startedAt}ms — ${findingRows.length} findings (${session.reportedBugs.length - findingRows.length} dedup'd), ${result.toolCalls} tool calls (${result.endedReason})`,
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
