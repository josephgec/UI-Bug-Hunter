import { AxeBuilder } from "@axe-core/playwright";
import type { BrowserSession } from "../browser.js";

export interface AxeFinding {
  id: string;
  impact: "minor" | "moderate" | "serious" | "critical" | "unknown";
  nodes: number;
  help: string;
  helpUrl: string;
}

export async function runAxe(session: BrowserSession): Promise<{ violations: AxeFinding[] }> {
  const page = session.requirePage();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  return {
    violations: result.violations.map((v) => ({
      id: v.id,
      impact: (v.impact ?? "unknown") as AxeFinding["impact"],
      nodes: v.nodes.length,
      help: v.help,
      helpUrl: v.helpUrl,
    })),
  };
}
