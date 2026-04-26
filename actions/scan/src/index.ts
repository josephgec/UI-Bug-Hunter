import * as core from "@actions/core";
import * as github from "@actions/github";
import { UbhClient } from "./api";
import { findingsAtOrAbove, formatPrComment } from "./format";
import type { Finding, OverageBehavior, Severity } from "./types";
import { SEVERITY_RANK } from "./types";

async function run(): Promise<void> {
  try {
    const apiUrl = core.getInput("api-url", { required: true });
    const apiToken = core.getInput("api-token", { required: true });
    const projectId = core.getInput("project-id", { required: true });
    const urls = core
      .getInput("urls", { required: true })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const viewports = core
      .getInput("viewports")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const severityRaw = (core.getInput("severity-threshold") || "high").toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(SEVERITY_RANK, severityRaw)) {
      core.setFailed(`Unknown severity-threshold: ${severityRaw}`);
      return;
    }
    const threshold = severityRaw as Severity;
    const minConfidence = Number(core.getInput("min-confidence") || "0.6");
    const pollTimeoutSeconds = Number(core.getInput("poll-timeout-seconds") || "300");
    const commentOnPr = (core.getInput("comment-on-pr") || "true") === "true";
    const credentialIds = core
      .getInput("credential-ids")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const overageBehavior = (core.getInput("overage-behavior") || "hard-fail") as OverageBehavior;

    if (urls.length === 0) {
      core.setFailed("urls input is empty");
      return;
    }

    const client = new UbhClient(apiUrl, apiToken);
    const submitted: { scanId: string; targetUrl: string }[] = [];

    // Submit every scan up-front so they run in parallel server-side.
    for (const url of urls) {
      try {
        const { scanId } = await client.createScan({
          projectId,
          url,
          viewports: viewports.length > 0 ? viewports : ["desktop"],
          credentialIds,
        });
        submitted.push({ scanId, targetUrl: url });
        core.info(`▸ submitted scan ${scanId} for ${url}`);
      } catch (err) {
        const e = err as Error & { status?: number };
        if (e.status === 402) {
          if (overageBehavior === "hard-fail") {
            core.setFailed(`Quota exceeded for ${url}: ${e.message}`);
            return;
          } else if (overageBehavior === "soft-fail") {
            core.warning(`Quota exceeded for ${url}, skipping`);
            continue;
          } else {
            core.warning(`Quota exceeded for ${url} but overage-behavior=continue; skipping`);
            continue;
          }
        }
        throw err;
      }
    }

    if (submitted.length === 0) {
      core.warning("No scans submitted (all skipped due to overage).");
      return;
    }

    const deadline = Date.now() + pollTimeoutSeconds * 1000 * Math.max(1, submitted.length);
    const completed = new Map<string, { targetUrl: string; findings: Finding[] }>();

    while (completed.size < submitted.length) {
      if (Date.now() > deadline) {
        core.warning("Scan polling timed out; reporting on completed scans only.");
        break;
      }
      for (const s of submitted) {
        if (completed.has(s.scanId)) continue;
        const rec = await client.getScan(s.scanId);
        if (rec.status === "FAILED") {
          completed.set(s.scanId, { targetUrl: s.targetUrl, findings: [] });
          core.warning(`scan ${s.scanId} failed: ${rec.errorMessage ?? "unknown"}`);
        } else if (rec.status === "COMPLETED") {
          const { findings } = await client.getFindings(s.scanId, minConfidence);
          completed.set(s.scanId, { targetUrl: s.targetUrl, findings });
          core.info(`✓ scan ${s.scanId} (${findings.length} findings)`);
        }
      }
      if (completed.size < submitted.length) {
        await new Promise((r) => setTimeout(r, 5000));
      }
    }

    const scansForReport = submitted.map((s) => ({
      scanId: s.scanId,
      targetUrl: completed.get(s.scanId)?.targetUrl ?? s.targetUrl,
      findings: completed.get(s.scanId)?.findings ?? [],
    }));

    let totalFlagged = 0;
    for (const scan of scansForReport) {
      totalFlagged += findingsAtOrAbove(scan.findings, threshold).length;
    }

    core.setOutput("scan-ids", submitted.map((s) => s.scanId).join(","));
    core.setOutput("failed-findings", String(totalFlagged));

    if (commentOnPr && github.context.payload.pull_request) {
      const body = formatPrComment({
        apiUrl,
        scans: scansForReport,
        threshold,
        failed: totalFlagged,
      });
      const ghToken = process.env.GITHUB_TOKEN;
      if (ghToken) {
        const octokit = github.getOctokit(ghToken);
        const { owner, repo } = github.context.repo;
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: github.context.payload.pull_request.number,
          body,
        });
      } else {
        core.warning("GITHUB_TOKEN missing — cannot comment on PR; printing summary instead.");
        core.summary.addRaw(body).write();
      }
    } else {
      const body = formatPrComment({
        apiUrl,
        scans: scansForReport,
        threshold,
        failed: totalFlagged,
      });
      core.summary.addRaw(body).write();
    }

    if (totalFlagged > 0) {
      core.setFailed(`${totalFlagged} finding(s) at or above ${threshold} severity.`);
    }
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

run();
