import { SEVERITY_RANK, type Finding, type Severity } from "./types";

const EMOJI: Record<Severity, string> = {
  critical: "🛑",
  high: "🔴",
  medium: "🟡",
  low: "⚪",
};

export function findingsAtOrAbove(findings: Finding[], threshold: Severity): Finding[] {
  const cutoff = SEVERITY_RANK[threshold];
  return findings.filter((f) => SEVERITY_RANK[f.severity] <= cutoff);
}

/**
 * Format a PR comment summarizing scan results. Top findings inline; the rest
 * collapsed in a <details> per category. We deliberately don't dump every
 * finding inline — a developer skimming a PR comment shouldn't have to
 * scroll past 60 low-severity nitpicks.
 */
export function formatPrComment(input: {
  apiUrl: string;
  scans: { scanId: string; targetUrl: string; findings: Finding[] }[];
  threshold: Severity;
  failed: number;
}): string {
  const totalFindings = input.scans.reduce((acc, s) => acc + s.findings.length, 0);
  const lines: string[] = [];

  lines.push("## UI Bug Hunter — Scan results");
  lines.push("");
  if (input.failed === 0) {
    lines.push(`✅ No findings at or above **${input.threshold}** across ${input.scans.length} scan(s).`);
  } else {
    lines.push(
      `❌ **${input.failed}** finding(s) at or above **${input.threshold}** across ${input.scans.length} scan(s).`,
    );
  }
  lines.push("");

  for (const scan of input.scans) {
    const flagged = findingsAtOrAbove(scan.findings, input.threshold);
    lines.push(`### [${scan.targetUrl}](${input.apiUrl}/scans/${scan.scanId})`);
    if (scan.findings.length === 0) {
      lines.push(`_${EMOJI.low} no findings_`);
      lines.push("");
      continue;
    }

    if (flagged.length > 0) {
      for (const f of flagged.slice(0, 5)) {
        lines.push(
          `- ${EMOJI[f.severity]} **${f.severity}** — ${f.title}  \n  _${f.category} · conf ${f.confidence.toFixed(2)}_  \n  ${truncate(f.description, 240)}`,
        );
      }
      if (flagged.length > 5) {
        lines.push(`- _…and ${flagged.length - 5} more above threshold._`);
      }
    } else {
      lines.push(`_${EMOJI.low} no findings above ${input.threshold}._`);
    }

    const below = scan.findings.filter((f) => !flagged.includes(f));
    if (below.length > 0) {
      const byCategory = groupBy(below, (f) => f.category);
      lines.push("");
      lines.push(`<details><summary>${below.length} finding(s) below ${input.threshold}</summary>`);
      lines.push("");
      for (const [cat, fs] of byCategory) {
        lines.push(`**${cat}** (${fs.length})`);
        for (const f of fs.slice(0, 8)) {
          lines.push(`- ${EMOJI[f.severity]} ${f.title} _(${f.severity})_`);
        }
        if (fs.length > 8) lines.push(`- _…and ${fs.length - 8} more._`);
      }
      lines.push("</details>");
    }
    lines.push("");
  }

  lines.push(`<sub>${totalFindings} total findings · UI Bug Hunter</sub>`);
  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function groupBy<T, K extends string>(arr: T[], keyFn: (v: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of arr) {
    const k = keyFn(item);
    const existing = out.get(k);
    if (existing) existing.push(item);
    else out.set(k, [item]);
  }
  return out;
}
