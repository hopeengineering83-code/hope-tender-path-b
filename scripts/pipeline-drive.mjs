/**
 * Real end-to-end pipeline drive.
 *
 * Drives the REAL HTTP routes against a running server with a REAL session:
 *   upload-first -> ai-analyze -> engine -> build-plan -> confirm ->
 *   generate -> validate -> finalize-pdf -> export (ZIP bytes)
 *
 * Stops at the FIRST step that cannot continue and prints the actual response.
 * This is a development/diagnostic harness, not production code.
 */
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.DRIVE_BASE ?? "http://127.0.0.1:3100";
const COOKIE = process.env.DRIVE_COOKIE;
const OUT = process.env.DRIVE_OUT ?? "/tmp/drive-out";
if (!COOKIE) throw new Error("DRIVE_COOKIE required");
mkdirSync(OUT, { recursive: true });

// DRIVE_FIXTURE=b selects the EOI tender (email attachments, single package);
// the default is the two-envelope RFP.
const FIXTURE = process.env.DRIVE_FIXTURE ?? "a";
const fixture = FIXTURE === "b"
  ? await import("./pipeline-drive-fixture-b.mjs")
  : await import("./pipeline-drive-fixture.mjs");
const TENDER_TEXT = fixture.TENDER_TEXT_B ?? fixture.TENDER_TEXT;
const TENDER_REFERENCE = fixture.REFERENCE_B ?? "MOWE/CS/RWS/2026/0117";
const TENDER_FILE_NAME = FIXTURE === "b" ? "AWWDSE-EOI-2026-0042.txt" : "MOWE-RFP-2026-0117.txt";
const TENDER_TITLE = FIXTURE === "b"
  ? "Expression of Interest for Design Review and Technical Audit of Rural Water Supply Schemes"
  : "Consultancy Services for Rural Water Supply Schemes, Amhara Region";

let step = 0;
function log(name, status, detail) {
  step += 1;
  const mark = status === "OK" ? "PASS" : status === "INFO" ? "  ->" : "STOP";
  console.log(`[${String(step).padStart(2, "0")}] ${mark}  ${name}${detail ? `  ${detail}` : ""}`);
}

async function call(method, path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { cookie: `hope_session=${COOKIE}`, ...(opts.headers ?? {}) },
    body: opts.body,
  });
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const json = await res.json().catch(() => null);
    return { status: res.status, json, res };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buffer: buf, res };
}

function body(r, n = 500) {
  if (r.json !== undefined && r.json !== null) return JSON.stringify(r.json).slice(0, n);
  if (r.buffer) return `<${r.buffer.length} bytes binary>`;
  return "<empty>";
}

function die(name, r) {
  log(name, "FAIL", `HTTP ${r.status}`);
  console.log("\n===== FIRST TRUE STOP =====");
  console.log(`step:   ${name}`);
  console.log(`status: ${r.status}`);
  console.log(`body:   ${JSON.stringify(r.json ?? String(r.buffer?.slice(0, 400)), null, 2).slice(0, 3000)}`);
  process.exit(2);
}

// ── 0. Company vault: experts + project references ──────────────────────────
// Generation requires REVIEWED experts/projects (COMPANY_INGESTION_NOT_READY).
// These go through the real authenticated routes, which is what the operator
// does after uploading CVs and project sheets into the vault.
const EXPERTS = [
  { fullName: "Abebe Tesfaye", title: "Team Leader / Project Manager", email: "abebe.tesfaye@hopeurban.example", yearsExperience: 22, disciplines: ["Civil Engineering", "Water Supply"], sectors: ["Water and sanitation", "Public infrastructure"], certifications: ["Registered Professional Engineer Grade I PE/ET/2231"], profile: "MSc Civil Engineering, Addis Ababa University 2004. 22 years in water supply and municipal infrastructure. Led the Adama Town Water Supply and Hawassa Municipal Drainage assignments." },
  { fullName: "Meron Gebrehiwot", title: "Senior Water Supply Engineer", email: "meron.gebrehiwot@hopeurban.example", yearsExperience: 15, disciplines: ["Water Resources Engineering", "Hydraulic Modelling"], sectors: ["Water and sanitation"], certifications: ["WaterCAD / EPANET specialist"], profile: "MSc Water Resources Engineering, Arba Minch University 2010. 15 years in distribution network design and hydraulic modelling." },
  { fullName: "Daniel Woldu", title: "Senior Architect", email: "daniel.woldu@hopeurban.example", yearsExperience: 18, disciplines: ["Architecture", "Construction Supervision"], sectors: ["Education", "Health"], certifications: [], profile: "BArch, Ethiopian Institute of Architecture 2007. 18 years in public facility design and construction supervision." },
  { fullName: "Sara Hailu", title: "Environmental and Social Safeguards Specialist", email: "sara.hailu@hopeurban.example", yearsExperience: 13, disciplines: ["Environmental Engineering", "ESIA"], sectors: ["Water and sanitation", "Public infrastructure"], certifications: [], profile: "MSc Environmental Engineering 2012. 13 years of ESIA experience on World Bank and African Development Bank funded assignments." },
];

const PROJECTS = [
  { name: "Adama Town Water Supply Distribution Network — Detailed Design and Construction Supervision", clientName: "Oromia Water Works Design and Supervision Enterprise", country: "Ethiopia", sector: "Water and sanitation", serviceAreas: ["Detailed design", "Construction supervision"], contractValue: 18400000, currency: "ETB", summary: "62 km distribution network and four reservoirs. Lead consultant. 2023-2025, completed." },
  { name: "Hawassa Municipal Drainage Improvement — Feasibility Study and Detailed Engineering Design", clientName: "Hawassa City Administration", country: "Ethiopia", sector: "Urban infrastructure", serviceAreas: ["Feasibility study", "Detailed design"], contractValue: 12750000, currency: "ETB", summary: "28 km primary and secondary drainage. Lead consultant. 2022-2024, completed." },
  { name: "Somali Region Water Access — Borehole Siting, Design and Supervision", clientName: "UNICEF Ethiopia", country: "Ethiopia", sector: "Water and sanitation", serviceAreas: ["Hydrogeological survey", "Design", "Supervision"], contractValue: 610000, currency: "USD", summary: "22 boreholes with hydrogeological survey. Lead consultant. 2024-2025, completed." },
  { name: "Sidama Region Primary School Facilities — Design and Supervision of 14 Schools", clientName: "Ministry of Education / World Bank GEQIP-E", country: "Ethiopia", sector: "Education", serviceAreas: ["Architectural design", "Structural design", "Supervision"], contractValue: 940000, currency: "USD", summary: "14 primary school facilities. Lead consultant. 2021-2023, completed." },
];

let expertsCreated = 0;
for (const expert of EXPERTS) {
  const res = await call("POST", "/api/company/experts", {
    headers: { "content-type": "application/json" }, body: JSON.stringify(expert),
  });
  if (res.status >= 400) die("company/experts", res);
  expertsCreated += 1;
}
log("company/experts", "OK", `${expertsCreated} REVIEWED experts`);

let projectsCreated = 0;
for (const project of PROJECTS) {
  const res = await call("POST", "/api/company/projects", {
    headers: { "content-type": "application/json" }, body: JSON.stringify(project),
  });
  if (res.status >= 400) die("company/projects", res);
  projectsCreated += 1;
}
log("company/projects", "OK", `${projectsCreated} REVIEWED projects`);

// ── 1. Intake ───────────────────────────────────────────────────────────────
const form = new FormData();
form.append("title", TENDER_TITLE);
form.append("reference", TENDER_REFERENCE);
form.append("file", new Blob([TENDER_TEXT], { type: "text/plain" }), TENDER_FILE_NAME);

let r = await call("POST", "/api/tenders/upload-first", { body: form });
if (r.status !== 201) die("upload-first", r);
const tenderId = r.json.tenderId;
log("upload-first", "OK", `tender=${tenderId} files=${r.json.uploadedFiles} next=${r.json.nextAction}`);

// ── 2. Extraction check ─────────────────────────────────────────────────────
r = await call("GET", `/api/tenders/${tenderId}/extraction-quality`);
log("extraction-quality", r.status === 200 ? "OK" : "INFO",
  `HTTP ${r.status} ${body(r, 300)}`);

// ── 3. AI Analyze ───────────────────────────────────────────────────────────
r = await call("POST", `/api/tenders/${tenderId}/ai-analyze?force=true`);
if (r.status !== 200) die("ai-analyze", r);
log("ai-analyze", "OK",
  `source=${r.json.analysisSource} fallback=${r.json.fallback} reqs=${r.json.requirementCount} next=${r.json.nextAction}`);

// ── 4. Engine ───────────────────────────────────────────────────────────────
r = await call("POST", `/api/tenders/${tenderId}/engine`, {
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "run" }),
});
log("engine/run", r.status < 400 ? "OK" : "INFO", `HTTP ${r.status} ${body(r, 400)}`);

// ── 5. Build Plan ───────────────────────────────────────────────────────────
r = await call("POST", `/api/tenders/${tenderId}/build-plan`, {
  headers: { "content-type": "application/json" },
  body: JSON.stringify({}),
});
if (r.status >= 400) die("build-plan", r);
log("build-plan", "OK", `items=${r.json.items?.length ?? r.json.itemCount ?? "?"} hash=${String(r.json.contentHash).slice(0, 12)}`);

// ── 6. Confirm Build Plan ───────────────────────────────────────────────────
r = await call("POST", `/api/tenders/${tenderId}/build-plan/confirm`, {
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ revision: r.json.revision, contentHash: r.json.contentHash }),
});
if (r.status >= 400) die("build-plan/confirm", r);
log("build-plan/confirm", "OK", body(r, 200));

// ── 6b. Review + select expert/project matches ──────────────────────────────
// Generation requires at least one SELECTED expert match
// (NO_EXPERT_MATCHES_SELECTED). This is the operator's "review matches" step.
r = await call("GET", `/api/tenders/${tenderId}/matching-diagnostics`);
if (r.status >= 400) die("matching-diagnostics", r);
log("matching-diagnostics", "OK", `experts total=${r.json.experts?.total} selected=${r.json.experts?.selected} projects total=${r.json.projects?.total}`);

// Match IDs are not exposed by any list endpoint (the tender page renders them
// server-side), so the harness reads the ids straight from the database and
// then performs the SELECTION through the real PUT /matches route.
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const expertMatches = await prisma.tenderExpertMatch.findMany({ where: { tenderId }, select: { id: true, score: true } });
const projectMatches = await prisma.tenderProjectMatch.findMany({ where: { tenderId }, select: { id: true, score: true } });
await prisma.$disconnect();
let selected = 0;
for (const m of [...expertMatches].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 4)) {
  const res = await call("PUT", `/api/tenders/${tenderId}/matches`, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ matchId: m.id, matchType: "expert", isSelected: true }),
  });
  if (res.status < 400) selected += 1;
}
let selectedProjects = 0;
for (const m of [...projectMatches].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 4)) {
  const res = await call("PUT", `/api/tenders/${tenderId}/matches`, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ matchId: m.id, matchType: "project", isSelected: true }),
  });
  if (res.status < 400) selectedProjects += 1;
}
log("select matches", "OK", `experts=${selected}/${expertMatches.length} projects=${selectedProjects}/${projectMatches.length}`);

// ── 7. Generation readiness ─────────────────────────────────────────────────
r = await call("GET", `/api/tenders/${tenderId}/generation-readiness`);
log("generation-readiness", "INFO", `ready=${r.json?.ready} ${JSON.stringify(r.json?.blockers ?? r.json ?? null).slice(0, 500)}`);

// ── 8. Generate ─────────────────────────────────────────────────────────────
r = await call("POST", `/api/tenders/${tenderId}/generate`, {
  headers: { "content-type": "application/json" },
  body: JSON.stringify({}),
});
if (r.status >= 400) die("generate", r);
log("generate", "OK", body(r, 400));

// ── 8b. Generate any planned files the main generator did not produce ───────
r = await call("POST", `/api/tenders/${tenderId}/generate-missing-plan-files`, {
  headers: { "content-type": "application/json" },
  body: JSON.stringify({}),
});
log("generate-missing-plan-files", r.status < 400 ? "OK" : "INFO", `HTTP ${r.status} ${body(r, 500)}`);

// ── 8c. Attach the original for any plan file awaiting one ──────────────────
// The app refuses to invent a priced financial offer, so it creates a PLANNED
// row awaiting the official file. This is the operator's upload step.
{
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const awaiting = await prisma.generatedDocument.findMany({
    where: { tenderId, generationStatus: "PLANNED" },
    select: { id: true, exactFileName: true },
  });
  await prisma.$disconnect();
  const { buildFinancialProposalDocx } = await import("./make-financial-proposal-docx.mjs");
  let attached = 0;
  for (const d of awaiting) {
    const bytes = await buildFinancialProposalDocx();
    const fd = new FormData();
    fd.append("file", new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), d.exactFileName);
    const res = await call("POST", `/api/tenders/${tenderId}/documents/${d.id}/attach-original`, { body: fd });
    if (res.status >= 400) die(`attach-original ${d.exactFileName}`, res);
    attached += 1;
  }
  log("attach-original", "OK", `${attached} original(s) attached: ${awaiting.map((d) => d.exactFileName).join(", ") || "none"}`);
}

// ── 9. Documents ────────────────────────────────────────────────────────────
r = await call("GET", `/api/tenders/${tenderId}/documents`);
log("documents", "INFO", body(r, 600));

// ── 9b. Supersede documents outside the confirmed plan ──────────────────────
// The main generator emits documents whose names do not match the confirmed
// plan (e.g. "Technical-Proposal.docx" against a planned
// "01-Technical-Proposal.docx"), plus per-expert CV files. Those are real work
// products but they are not part of THIS submission, and the export gate
// refuses to ship a package containing documents outside the confirmed scope.
r = await call("POST", `/api/tenders/${tenderId}/supersede-outside-plan`, {
  headers: { "content-type": "application/json" },
  body: JSON.stringify({}),
});
log("supersede-outside-plan", r.status < 400 ? "OK" : "INFO", `HTTP ${r.status} ${body(r, 300)}`);

// ── 10. Validate ────────────────────────────────────────────────────────────
r = await call("POST", `/api/tenders/${tenderId}/validate`, {
  headers: { "content-type": "application/json" },
  body: JSON.stringify({}),
});
log("validate", r.status < 400 ? "OK" : "INFO", `HTTP ${r.status} ${body(r, 400)}`);

// ── 10a. Repair export gaps (hygiene clean + validation) ────────────────────
// Cleans DOCX hygiene issues (e.g. pricing language in a technical file) and
// marks the repaired in-plan documents validated and export-ready.
r = await call("POST", `/api/tenders/${tenderId}/repair-export-gaps`, {
  headers: { "content-type": "application/json" },
  body: JSON.stringify({}),
});
log("repair-export-gaps", r.status < 400 ? "OK" : "INFO", `HTTP ${r.status} ${body(r, 600)}`);

// ── 10b. Reviewer approval of the in-plan documents ─────────────────────────
r = await call("POST", `/api/tenders/${tenderId}/documents/bulk-review`, {
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    reviewStatus: "APPROVED",
    reviewAction: "APPROVE_FOR_EXPORT",
    reviewNotes: "Reviewed against the confirmed build plan during the end-to-end release drive.",
  }),
});
log("bulk-review", r.status < 400 ? "OK" : "INFO", `HTTP ${r.status} ${body(r, 400)}`);

// ── 11. Finalize PDF ────────────────────────────────────────────────────────
r = await call("POST", `/api/tenders/${tenderId}/finalize-pdf`, {
  headers: { "content-type": "application/json" },
  body: JSON.stringify({}),
});
log("finalize-pdf", r.status < 400 ? "OK" : "INFO", `HTTP ${r.status} ${body(r, 400)}`);

// ── 12. Export readiness ────────────────────────────────────────────────────
r = await call("GET", `/api/tenders/${tenderId}/export-readiness`);
log("export-readiness", "INFO", body(r, 700));

// ── 13. THE ZIP ─────────────────────────────────────────────────────────────
r = await call("POST", `/api/tenders/${tenderId}/export`);
if (r.status !== 200 || !r.buffer) die("export (ZIP)", r);
const zipPath = `${OUT}/final-submission-${tenderId}.zip`;
writeFileSync(zipPath, r.buffer);
log("export (ZIP)", "OK", `${r.buffer.length} bytes -> ${zipPath}`);

console.log("\n===== ZIP PRODUCED =====");
console.log(zipPath, r.buffer.length, "bytes");
console.log("tenderId:", tenderId);
