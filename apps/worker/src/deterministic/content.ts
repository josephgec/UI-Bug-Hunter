import type { BrowserSession } from "../browser.js";

export interface ContentFinding {
  kind: "lorem_ipsum" | "broken_templating" | "placeholder_string";
  excerpt: string;
  selector?: string;
}

const LOREM_RE = /\blorem ipsum\b|\bdolor sit amet\b|\bconsectetur adipiscing\b/i;
// Two flavors of unrendered template tokens we see in the wild:
// {{name}}, ${{name}}, {%name%}, ${name}, {ng-bind:name} — but lots of legit
// JS shows ${...}, so we restrict to the unambiguous {{...}} and {%...%}.
const HANDLEBARS_RE = /\{\{\s*[a-zA-Z_][a-zA-Z0-9_.]*\s*\}\}/;
const ERB_RE = /\{%\s*[a-zA-Z_][a-zA-Z0-9_.]*\s*%\}/;
// Common explicit "TODO" / placeholder copy. Tight to avoid catching code
// snippets in /docs.
const PLACEHOLDER_RE = /\b(TBD|TODO|FIXME|coming soon — placeholder|placeholder text)\b/;

/**
 * Walk the rendered DOM's text content and flag content-category bugs:
 * lorem ipsum, unrendered {{template}} / {%template%}, and obvious placeholder
 * strings. Skips <code>, <pre>, <script>, <style> blocks where these tokens
 * are legitimate.
 */
export async function detectContentIssues(session: BrowserSession): Promise<ContentFinding[]> {
  const page = session.requirePage();
  const items = await page.evaluate(() => {
    const skip = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "NOSCRIPT", "TEMPLATE"]);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const out: { text: string; selector: string }[] = [];
    let node: Node | null = walker.nextNode();
    while (node) {
      const parent = (node as Text).parentElement;
      if (parent && !skip.has(parent.tagName)) {
        const text = (node.nodeValue ?? "").trim();
        if (text.length > 0) {
          const selector = ((): string => {
            const tag = parent.tagName.toLowerCase();
            const id = parent.id ? `#${parent.id}` : "";
            const cls = parent.classList.length
              ? `.${Array.from(parent.classList).slice(0, 1).join(".")}`
              : "";
            return `${tag}${id}${cls}`;
          })();
          out.push({ text, selector });
        }
      }
      node = walker.nextNode();
    }
    return out;
  });

  const findings: ContentFinding[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const checks: Array<{ re: RegExp; kind: ContentFinding["kind"] }> = [
      { re: LOREM_RE, kind: "lorem_ipsum" },
      { re: HANDLEBARS_RE, kind: "broken_templating" },
      { re: ERB_RE, kind: "broken_templating" },
      { re: PLACEHOLDER_RE, kind: "placeholder_string" },
    ];
    for (const c of checks) {
      const m = c.re.exec(item.text);
      if (!m) continue;
      const dedup = `${c.kind}:${item.selector}:${m[0]}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      const start = Math.max(0, m.index - 20);
      const end = Math.min(item.text.length, m.index + m[0].length + 40);
      findings.push({
        kind: c.kind,
        excerpt: item.text.slice(start, end),
        selector: item.selector,
      });
    }
  }
  return findings;
}
