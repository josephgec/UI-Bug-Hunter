import type { BrowserSession } from "../browser.js";
import { runAxe, type AxeFinding } from "./axe.js";
import { detectBrokenImages, type BrokenImage } from "./broken-images.js";
import { collectConsoleErrors } from "./console.js";

export interface DeterministicReport {
  axe: AxeFinding[];
  brokenImages: BrokenImage[];
  consoleErrors: { level: string; text: string }[];
  durationMs: number;
}

export async function runDeterministicChecks(
  session: BrowserSession,
): Promise<DeterministicReport> {
  const start = Date.now();
  // The console + network listeners are already wired by BrowserSession; the
  // axe + broken-image checks need the page to be in a stable state.
  const [axe, broken] = await Promise.all([
    runAxe(session).catch((err) => {
      // Don't fail the scan if axe blows up — just return zero findings and
      // log to the worker.
      return { error: err instanceof Error ? err.message : String(err), violations: [] as AxeFinding[] };
    }),
    detectBrokenImages(session).catch(() => [] as BrokenImage[]),
  ]);

  return {
    axe: "violations" in axe ? axe.violations : axe,
    brokenImages: broken,
    consoleErrors: collectConsoleErrors(session),
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
  return lines.join("\n");
}
