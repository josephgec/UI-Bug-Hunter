import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@ubh/db";

export const dynamic = "force-dynamic";

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export default async function ScanPage({ params }: { params: { id: string } }) {
  const scan = await prisma.scan.findUnique({
    where: { id: params.id },
    include: {
      project: true,
      findings: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!scan) notFound();

  const visible = scan.findings
    .filter((f) => f.confidence >= 0.6)
    .sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99),
    );
  const collapsed = scan.findings.filter((f) => f.confidence < 0.6);

  return (
    <main style={{ maxWidth: 920, margin: "40px auto", padding: "0 24px" }}>
      <Link href={`/projects/${scan.projectId}`} style={{ color: "#8ab4f8" }}>
        ← {scan.project.name}
      </Link>
      <h1 style={{ marginBottom: 4, wordBreak: "break-all" }}>{scan.targetUrl}</h1>
      <p style={{ color: "#9aa0a6", marginTop: 0 }}>
        Status: <strong>{scan.status}</strong> · Viewport: {scan.viewport} · Tool
        calls: {scan.toolCalls}
        {scan.errorMessage && (
          <span style={{ color: "#f28b82", marginLeft: 12 }}>
            error: {scan.errorMessage}
          </span>
        )}
      </p>

      <h2 style={{ marginTop: 32 }}>
        Findings ({visible.length} shown, {collapsed.length} below confidence threshold)
      </h2>
      {visible.length === 0 ? (
        <p style={{ color: "#9aa0a6" }}>No findings above 0.6 confidence.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {visible.map((f) => (
            <li
              key={f.id}
              style={{
                padding: 16,
                border: "1px solid #2a2f36",
                borderRadius: 8,
                marginBottom: 12,
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: severityBg(f.severity),
                    color: "#0b0d10",
                    fontWeight: 700,
                    textTransform: "uppercase",
                  }}
                >
                  {f.severity}
                </span>
                <span style={{ fontSize: 12, color: "#9aa0a6" }}>{f.category}</span>
                <span style={{ fontSize: 12, color: "#9aa0a6" }}>
                  conf {f.confidence.toFixed(2)}
                </span>
              </div>
              <h3 style={{ margin: "8px 0 4px" }}>{f.title}</h3>
              <p style={{ margin: 0, color: "#cdd1d6" }}>{f.description}</p>
              {f.screenshotUrl && (
                <div style={{ marginTop: 12 }}>
                  <img
                    src={f.screenshotUrl}
                    alt=""
                    style={{ maxWidth: "100%", borderRadius: 6, border: "1px solid #2a2f36" }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function severityBg(severity: string): string {
  switch (severity) {
    case "critical":
      return "#f28b82";
    case "high":
      return "#fbbc04";
    case "medium":
      return "#fdd663";
    default:
      return "#9aa0a6";
  }
}
