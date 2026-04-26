import type { BrowserSession } from "../browser.js";

// Filter the session's console buffer to errors + warnings the user would
// plausibly care about. Browser-injected DevTools / extension noise is dropped.
export function collectConsoleErrors(session: BrowserSession): { level: string; text: string }[] {
  const NOISE = [
    /^Failed to load resource: net::ERR_BLOCKED_BY_CLIENT/i, // ad blockers in dev
    /^\[HMR\]/, // dev-only hot module reload
    /^Download the React DevTools/,
  ];
  return session.consoleEntries
    .filter((e) => e.level === "error" || e.level === "warning")
    .filter((e) => !NOISE.some((re) => re.test(e.text)))
    .map((e) => ({ level: e.level, text: e.text }));
}
