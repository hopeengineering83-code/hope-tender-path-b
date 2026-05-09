// G10 — Tender Command Center.
//
// Single dashboard per tender that surfaces every state the engine has
// computed: readiness, bid/no-bid, blockers, current best team / projects,
// generated docs status, evaluator score, Copilot actions, export gate
// status — and a "Next best action" at the top.
//
// Lives at /dashboard/tenders/[id]/command-center so the existing detail
// page stays untouched. Linked from the tender detail navigation.

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { checkExportReadiness, checkTenderLevelExportBlockers } from "../../../../../lib/engine/export-readiness";

export const dynamic = "force-dynamic";

export default async function TenderCommandCenter({ params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const { id } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id, userId },
    include: {
      requirements: true,
      complianceGaps: true,
      expertMatches: { where: { isSelected: true }, include: { expert: { select: { id: true, fullName: true, title: true } } }, orderBy: { score: "desc" } },
      projectMatches: { where: { isSelected: true }, include: { project: { select: { id: true, name: true, clientName: true } } }, orderBy: { score: "desc" } },
      generatedDocuments: { where: { generationStatus: { not: "SUPERSEDED" } } },
    },
  });
  if (!tender) notFound();

  // ─── Readiness, blockers, evaluator state ───────────────────────────
  const docReadiness = checkExportReadiness(tender.generatedDocuments);
  const tenderBlockers = await checkTenderLevelExportBlockers(id);

  const objections = await prisma.evaluatorObjection.findMany({
    where: { tenderId: id },
    orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
    take: 25,
  });
  const openHigh = objections.filter((o) => o.status === "OPEN" && o.severity === "HIGH");
  const openMedium = objections.filter((o) => o.status === "OPEN" && o.severity === "MEDIUM");

  const proposalVersions = await prisma.proposalVersion.findMany({
    where: { tenderId: id },
    orderBy: { version: "desc" },
    take: 5,
    select: { id: true, version: true, qualityScore: true, winProbabilityScore: true, mode: true, createdAt: true },
  });
  const latestVersion = proposalVersions[0];

  const workbook = await prisma.pricingWorkbook.findUnique({
    where: { tenderId: id },
    include: { lines: true },
  });

  const recentJobs = await prisma.aiJob.findMany({
    where: { OR: [{ tenderId: id }, { userId }] },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { id: true, jobType: true, status: true, createdAt: true, finishedAt: true },
  });

  // ─── Next best action heuristic ─────────────────────────────────────
  let nextAction: { title: string; href?: string; rationale: string };
  if (tenderBlockers.length > 0) {
    nextAction = {
      title: "Resolve tender-level export blockers",
      href: `#blockers`,
      rationale: `${tenderBlockers.length} unresolved tender-level blocker(s) — export gate is closed.`,
    };
  } else if (docReadiness.failures.length > 0) {
    nextAction = {
      title: "Bring documents to READY_FOR_EXPORT",
      href: `/dashboard/tenders/${id}#documents`,
      rationale: `${docReadiness.failures.length} document(s) still need review/validation.`,
    };
  } else if (openHigh.length > 0) {
    nextAction = {
      title: "Close HIGH-severity evaluator objections",
      href: `#evaluator`,
      rationale: `${openHigh.length} HIGH objection(s) open from the last evaluator simulation.`,
    };
  } else if (tender.expertMatches.length === 0) {
    nextAction = {
      title: "Select experts for this tender",
      href: `/dashboard/tenders/${id}#matching`,
      rationale: "No experts are selected yet — the engine will not generate a meaningful proposal.",
    };
  } else if (tender.projectMatches.length === 0) {
    nextAction = {
      title: "Select reference projects for this tender",
      href: `/dashboard/tenders/${id}#matching`,
      rationale: "No projects are selected yet — the proposal needs comparable evidence.",
    };
  } else if (!latestVersion) {
    nextAction = {
      title: "Generate the technical proposal",
      href: `/dashboard/tenders/${id}#generate`,
      rationale: "Selections are in place. Run the proposal engine.",
    };
  } else {
    nextAction = {
      title: "Run evaluator simulation on the latest version",
      href: `/dashboard/tenders/${id}#evaluator`,
      rationale: "Last engine run produced a proposal; red-team it before final review.",
    };
  }

  return (
    <div style={{ padding: "1.5rem 2rem", maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <Link href={`/dashboard/tenders/${id}`} style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>← Tender detail</Link>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 8 }}>{tender.title}</h1>
          <p style={{ color: "#6b7280", fontSize: 13 }}>Command Center — single view of readiness, blockers, and next best action.</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, color: "#6b7280" }}>Status / Stage</div>
          <div style={{ fontWeight: 600 }}>{tender.status} / {tender.stage}</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Readiness: {Math.round(tender.readinessScore ?? 0)}/100</div>
        </div>
      </div>

      {/* Next best action — top of page */}
      <section style={{ background: "#1d4ed8", color: "white", padding: 20, borderRadius: 8, marginBottom: 24 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, opacity: 0.85 }}>Next best action</div>
        <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{nextAction.title}</div>
        <div style={{ fontSize: 13, marginTop: 6, opacity: 0.9 }}>{nextAction.rationale}</div>
        {nextAction.href && (
          <a href={nextAction.href} style={{ display: "inline-block", marginTop: 12, padding: "6px 12px", background: "white", color: "#1d4ed8", borderRadius: 4, fontWeight: 600, fontSize: 13, textDecoration: "none" }}>
            Take action →
          </a>
        )}
      </section>

      {/* 4-column status grid */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <Card title="Selected experts" value={tender.expertMatches.length} caption={tender.expertMatches.slice(0, 2).map((m) => m.expert.fullName).join(" • ") || "None"} />
        <Card title="Selected projects" value={tender.projectMatches.length} caption={tender.projectMatches.slice(0, 2).map((m) => m.project.name).join(" • ") || "None"} />
        <Card title="Documents" value={tender.generatedDocuments.length} caption={`${docReadiness.failures.length} not yet ready`} />
        <Card title="Open HIGH objections" value={openHigh.length} caption={openHigh.length > 0 ? "Export gate is closed" : "Export gate clear"} highlight={openHigh.length > 0} />
      </section>

      {/* Tender-level blockers */}
      <section id="blockers" style={{ marginBottom: 24 }}>
        <h2 style={sectionH2}>Export gate</h2>
        {docReadiness.ok && tenderBlockers.length === 0 ? (
          <div style={successBox}>✓ Export gate is open. All documents READY_FOR_EXPORT and no tender-level blockers.</div>
        ) : (
          <>
            {tenderBlockers.length > 0 && (
              <div style={errorBox}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Tender-level blockers ({tenderBlockers.length})</div>
                {tenderBlockers.map((b, i) => (
                  <div key={i} style={{ marginBottom: 6, fontSize: 13 }}>
                    <span style={{ fontWeight: 600 }}>[{b.severity}]</span> {b.title}
                    {b.recommendedAction && <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 2 }}>Action: {b.recommendedAction}</div>}
                  </div>
                ))}
              </div>
            )}
            {docReadiness.failures.length > 0 && (
              <div style={{ ...errorBox, marginTop: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Documents not ready ({docReadiness.failures.length})</div>
                {docReadiness.failures.slice(0, 6).map((f) => (
                  <div key={f.documentId} style={{ marginBottom: 4, fontSize: 13 }}>• {f.fileName} — {f.reasons.join("; ")}</div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* Evaluator objections */}
      <section id="evaluator" style={{ marginBottom: 24 }}>
        <h2 style={sectionH2}>Evaluator objections</h2>
        {objections.length === 0 ? (
          <div style={mutedBox}>No evaluator simulation has been run yet for this tender.</div>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr><th style={th}>Severity</th><th style={th}>Title</th><th style={th}>Status</th><th style={th}>Section</th></tr>
            </thead>
            <tbody>
              {objections.slice(0, 15).map((o) => (
                <tr key={o.id}>
                  <td style={td}>{o.severity}</td>
                  <td style={td}>{o.title}</td>
                  <td style={td}>{o.status}</td>
                  <td style={td}>{o.sectionRef ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {openMedium.length > 0 && (
          <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>{openMedium.length} MEDIUM objection(s) open — non-blocking but worth closing before submission.</p>
        )}
      </section>

      {/* Proposal version history */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={sectionH2}>Recent proposal versions</h2>
        {proposalVersions.length === 0 ? (
          <div style={mutedBox}>No proposal versions saved yet. Run the engine to create the first version.</div>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr><th style={th}>Version</th><th style={th}>Quality</th><th style={th}>Win Prob.</th><th style={th}>Mode</th><th style={th}>Created</th></tr>
            </thead>
            <tbody>
              {proposalVersions.map((v) => (
                <tr key={v.id}>
                  <td style={td}>v{v.version}</td>
                  <td style={td}>{v.qualityScore ?? "—"}</td>
                  <td style={td}>{v.winProbabilityScore ?? "—"}</td>
                  <td style={td}>{v.mode ?? "—"}</td>
                  <td style={td}>{new Date(v.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Pricing workbook */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={sectionH2}>Pricing workbook</h2>
        {!workbook ? (
          <div style={mutedBox}>No pricing workbook created yet.</div>
        ) : (
          <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 6, padding: 16, fontSize: 13 }}>
            <div>Currency: <strong>{workbook.currency}</strong> • Validity: {workbook.validityDays} days • Scenario: <strong>{workbook.scenario}</strong></div>
            <div style={{ marginTop: 6 }}>VAT {workbook.vatPercent}% • Withholding {workbook.withholdingPct}% • Contingency {workbook.contingencyPct}%</div>
            <div style={{ marginTop: 6 }}>Cost lines: <strong>{workbook.lines.length}</strong></div>
            <div style={{ marginTop: 6 }}>Price leakage check: {workbook.noPriceLeakage ? <span style={{ color: "#059669" }}>✓ clear</span> : <span style={{ color: "#b91c1c", fontWeight: 600 }}>✗ flagged — export blocked</span>}</div>
          </div>
        )}
      </section>

      {/* Recent AI jobs */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={sectionH2}>Recent background AI jobs</h2>
        {recentJobs.length === 0 ? (
          <div style={mutedBox}>No background AI jobs have been queued yet.</div>
        ) : (
          <table style={tableStyle}>
            <thead><tr><th style={th}>Job type</th><th style={th}>Status</th><th style={th}>Created</th><th style={th}>Finished</th></tr></thead>
            <tbody>
              {recentJobs.map((j) => (
                <tr key={j.id}>
                  <td style={td}>{j.jobType}</td>
                  <td style={td}>{j.status}</td>
                  <td style={td}>{new Date(j.createdAt).toLocaleString()}</td>
                  <td style={td}>{j.finishedAt ? new Date(j.finishedAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// ─── inline styles ───
const sectionH2: React.CSSProperties = { fontSize: 15, fontWeight: 600, marginBottom: 8, color: "#111827" };
const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", fontSize: 12, color: "#6b7280", borderBottom: "1px solid #e5e7eb" };
const td: React.CSSProperties = { padding: "6px 8px", fontSize: 13, borderBottom: "1px solid #f3f4f6" };
const tableStyle: React.CSSProperties = { width: "100%", background: "white", border: "1px solid #e5e7eb", borderRadius: 6, borderCollapse: "collapse" };
const mutedBox: React.CSSProperties = { padding: 12, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 13, color: "#6b7280" };
const successBox: React.CSSProperties = { padding: 12, background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 6, fontSize: 13, color: "#065f46" };
const errorBox: React.CSSProperties = { padding: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, fontSize: 13, color: "#991b1b" };

function Card({ title, value, caption, highlight }: { title: string; value: number | string; caption?: string; highlight?: boolean }) {
  return (
    <div style={{ background: highlight ? "#fef2f2" : "white", border: `1px solid ${highlight ? "#fecaca" : "#e5e7eb"}`, borderRadius: 6, padding: 12 }}>
      <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: highlight ? "#991b1b" : "#111827" }}>{value}</div>
      {caption && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>{caption}</div>}
    </div>
  );
}
