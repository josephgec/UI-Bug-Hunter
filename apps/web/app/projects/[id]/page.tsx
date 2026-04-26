import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@ubh/db";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: { id: string };
}) {
  const project = await prisma.project.findUnique({
    where: { id: params.id },
    include: {
      scans: {
        orderBy: { createdAt: "desc" },
        take: 25,
        include: { _count: { select: { findings: true } } },
      },
    },
  });
  if (!project) notFound();

  return (
    <main style={{ maxWidth: 920, margin: "40px auto", padding: "0 24px" }}>
      <Link href="/" style={{ color: "#8ab4f8" }}>
        ← Projects
      </Link>
      <h1 style={{ marginBottom: 4 }}>{project.name}</h1>
      <p style={{ color: "#9aa0a6", marginTop: 0 }}>{project.baseUrl}</p>

      <h2 style={{ marginTop: 32 }}>Recent scans</h2>
      {project.scans.length === 0 ? (
        <p style={{ color: "#9aa0a6" }}>No scans yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#9aa0a6", fontSize: 13 }}>
              <th style={{ padding: 8 }}>URL</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Findings</th>
              <th style={{ padding: 8 }}>Started</th>
            </tr>
          </thead>
          <tbody>
            {project.scans.map((s) => (
              <tr key={s.id} style={{ borderTop: "1px solid #2a2f36" }}>
                <td style={{ padding: 8 }}>
                  <Link href={`/scans/${s.id}`} style={{ color: "#8ab4f8" }}>
                    {s.targetUrl}
                  </Link>
                </td>
                <td style={{ padding: 8 }}>{s.status}</td>
                <td style={{ padding: 8 }}>{s._count.findings}</td>
                <td style={{ padding: 8, color: "#9aa0a6" }}>
                  {s.startedAt?.toISOString() ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
