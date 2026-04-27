import { prisma, DispatchStatus, type DestinationKind } from "@ubh/db";
import { getKms, type Severity } from "@ubh/shared";
import { autoDispatchAllowed } from "./routing.js";
import { JiraDestinationProvider } from "./jira.js";
import { LinearDestinationProvider } from "./linear.js";
import { SlackDestinationProvider } from "./slack.js";
import { WebhookDestinationProvider } from "./webhook.js";
import type { DestinationProvider, DispatchFinding } from "./types.js";

export { autoDispatchAllowed } from "./routing.js";

const PROVIDERS: Record<DestinationKind, DestinationProvider> = {
  SLACK: new SlackDestinationProvider(),
  LINEAR: new LinearDestinationProvider(),
  JIRA: new JiraDestinationProvider(),
  WEBHOOK: new WebhookDestinationProvider(),
};

/**
 * Send a finding to every eligible destination for the project. Eligibility:
 * - destination is enabled
 * - destination is org-wide OR scoped to this project
 * - finding's severity is at or above the destination's autoSeverity
 *
 * Each dispatch result is recorded as a DestinationDispatch row so the
 * dashboard can show "issued LIN-123" and the user can retry failures.
 */
export async function dispatchFinding(findingId: string, projectId: string): Promise<void> {
  const finding = await prisma.finding.findUnique({
    where: { id: findingId },
    include: { scan: { include: { project: { include: { org: true } } } } },
  });
  if (!finding) return;

  const orgId = finding.scan.project.orgId;
  const destinations = await prisma.destination.findMany({
    where: {
      orgId,
      enabled: true,
      OR: [{ projectId }, { projectId: null }],
    },
  });
  if (destinations.length === 0) return;

  const dashboardUrl = `${process.env.PUBLIC_DASHBOARD_URL ?? "http://localhost:3000"}/scans/${finding.scanId}`;
  const payload: DispatchFinding = {
    id: finding.id,
    category: finding.category as DispatchFinding["category"],
    severity: finding.severity as Severity,
    confidence: finding.confidence,
    title: finding.title,
    description: finding.description,
    screenshotUrl: finding.screenshotUrl ?? null,
    scanId: finding.scanId,
    projectName: finding.scan.project.name,
    targetUrl: finding.scan.targetUrl,
    dashboardUrl,
  };

  const kms = getKms();

  for (const dest of destinations) {
    if (!autoDispatchAllowed(dest.autoSeverity, payload.severity)) continue;

    const provider = PROVIDERS[dest.kind];
    if (!provider) continue;

    let config: unknown;
    try {
      const plain = await kms.decrypt({
        ciphertext: Buffer.from(dest.ciphertext as unknown as Buffer),
        iv: Buffer.from(dest.iv as unknown as Buffer),
        keyId: dest.keyId,
      });
      config = JSON.parse(plain.toString("utf8"));
    } catch (err) {
      await persistDispatch(dest.id, finding.id, {
        ok: false,
        error: err instanceof Error ? err.message : "decrypt_failed",
      });
      continue;
    }

    try {
      const result = await provider.send(config, payload);
      await persistDispatch(dest.id, finding.id, result);
    } catch (err) {
      await persistDispatch(dest.id, finding.id, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function persistDispatch(
  destinationId: string,
  findingId: string,
  result: { ok: boolean; externalId?: string; externalUrl?: string; error?: string },
): Promise<void> {
  await prisma.destinationDispatch.upsert({
    where: { destinationId_findingId: { destinationId, findingId } },
    create: {
      destinationId,
      findingId,
      status: result.ok ? DispatchStatus.SENT : DispatchStatus.FAILED,
      externalId: result.externalId ?? null,
      externalUrl: result.externalUrl ?? null,
      errorMessage: result.error ?? null,
    },
    update: {
      status: result.ok ? DispatchStatus.SENT : DispatchStatus.FAILED,
      externalId: result.externalId ?? null,
      externalUrl: result.externalUrl ?? null,
      errorMessage: result.error ?? null,
    },
  });
}
