import Link from "next/link";
import { prisma } from "@ubh/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { _count: { select: { scans: true } } },
  });

  return (
    <main style={{ maxWidth: 920, margin: "40px auto", padding: "0 24px" }}>
      <h1 style={{ marginBottom: 4 }}>UI Bug Hunter</h1>
      <p style={{ color: "#9aa0a6", marginTop: 0 }}>
        Phase 1 alpha. Submit a scan via <code>POST /api/v1/scans</code>.
      </p>

      <h2 style={{ marginTop: 32 }}>Projects</h2>
      {projects.length === 0 ? (
        <p style={{ color: "#9aa0a6" }}>
          No projects yet. Create one with the seed script or via the API.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {projects.map((p) => (
            <li
              key={p.id}
              style={{
                padding: "12px 16px",
                border: "1px solid #2a2f36",
                borderRadius: 8,
                marginBottom: 8,
              }}
            >
              <Link
                href={`/projects/${p.id}`}
                style={{ color: "#8ab4f8", fontWeight: 600, textDecoration: "none" }}
              >
                {p.name}
              </Link>
              <div style={{ color: "#9aa0a6", fontSize: 13 }}>
                {p.baseUrl} · {p._count.scans} scans
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
