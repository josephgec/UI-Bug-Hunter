import type { BrowserSession } from "../browser.js";
import { runAxe, type AxeFinding } from "./axe.js";
import { detectBrokenImages, type BrokenImage } from "./broken-images.js";
import { collectConsoleErrors } from "./console.js";
import { detectDeadLinks, type DeadLink } from "./dead-links.js";
import { detectContentIssues, type ContentFinding } from "./content.js";

export interface DeterministicReport {
  axe: AxeFinding[];
  brokenImages: BrokenImage[];
  consoleErrors: { level: string; text: string }[];
  deadLinks: DeadLink[];
  contentIssues: ContentFinding[];
  durationMs: number;
}

export async function runDeterministicChecks(
  session: BrowserSession,
  origin: string,
): Promise<DeterministicReport> {
  const start = Date.now();
  // Run everything in parallel — none of these depend on each other and they
  // all read from a stable settled page.
  const [axe, broken, deadLinks, contentIssues] = await Promise.all([
    runAxe(session).catch((err) => ({
      error: err instanceof Error ? err.message : String(err),
      violations: [] as AxeFinding[],
    })),
    detectBrokenImages(session).catch(() => [] as BrokenImage[]),
    detectDeadLinks(session, origin).catch(() => [] as DeadLink[]),
    detectContentIssues(session).catch(() => [] as ContentFinding[]),
  ]);

  return {
    axe: "violations" in axe ? axe.violations : axe,
    brokenImages: broken,
    consoleErrors: collectConsoleErrors(session),
    deadLinks,
    contentIssues,
    durationMs: Date.now() - start,
  };
}

export function formatDeterministicForPrompt(report: DeterministicReport): string {
  const lines: string[] = [];

  if (report.axe.length === 0) {
    lines.push("axe-core: no violations");
  } else {
    lines.push(`axe-core (${report.axe.length} violations):`);
    for (const v of report.axe) {
      lines.push(`  - ${v.id} (${v.impact}, ${v.nodes} nodes): ${v.help}`);
    }
  }

  if (report.brokenImages.length === 0) {
    lines.push("broken-images: none");
  } else {
    lines.push(`broken-images (${report.brokenImages.length}):`);
    for (const b of report.brokenImages) {
      lines.push(`  - ${b.src} (${b.reason})`);
    }
  }

  if (report.consoleErrors.length === 0) {
    lines.push("console-errors: none");
  } else {
    lines.push(`console-errors (${report.consoleErrors.length}):`);
    for (const e of report.consoleErrors.slice(0, 20)) {
      lines.push(`  - [${e.level}] ${e.text.slice(0, 200)}`);
    }
  }

  if (report.deadLinks.length === 0) {
    lines.push("dead-links: none (sampled same-origin)");
  } else {
    lines.push(`dead-links (${report.deadLinks.length}):`);
    for (const d of report.deadLinks.slice(0, 20)) {
      lines.push(`  - ${d.href} → ${d.status} ${d.statusText}`);
    }
  }

  if (report.contentIssues.length === 0) {
    lines.push("content: clean");
  } else {
    lines.push(`content-issues (${report.contentIssues.length}):`);
    for (const c of report.contentIssues.slice(0, 20)) {
      lines.push(`  - [${c.kind}] "${c.excerpt}" at ${c.selector ?? "?"}`);
    }
  }
  return lines.join("\n");
}
