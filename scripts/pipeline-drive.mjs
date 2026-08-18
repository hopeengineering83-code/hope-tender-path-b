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

// Vault records must cite the source document they came from. A record with no
// verified source can never be generation-eligible (canUseVaultRecordSafely),
// which is the intended contract — so the harness links each expert to the CV
// document and each project to the project-references document, exactly as an
// operator does after uploading them.
const vaultDocs = await call("GET", "/api/company/documents");
const docList = vaultDocs.json?.documents ?? vaultDocs.json?.items ?? vaultDocs.json ?? [];
const findDoc = (pattern) =>
  (Array.isArray(docList) ? docList : []).find((doc) =>
    pattern.test(String(doc.originalFileName ?? doc.fileName ?? "")))?.id ?? null;
const expertSourceDocumentId = findDoc(/Key-Experts-CVs/i);
const projectSourceDocumentId = findDoc(/Project-References/i);
log("company/documents", "INFO",
  `expertSource=${expertSourceDocumentId ? "found" : "MISSING"} projectSource=${projectSourceDocumentId ? "found" : "MISSING"}`);

const expertTrust = [];
for (const expert of EXPERTS) {
  const res = await call("POST", "/api/company/experts", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...expert, sourceDocumentId: expertSourceDocumentId }),
  });
  if (res.status >= 400) die("company/experts", res);
  expertTrust.push(res.json?.trustLevel ?? "?");
}
log("company/experts", "OK", `${expertTrust.length} experts, trust=[${expertTrust.join(", ")}]`);

const projectTrust = [];
for (const project of PROJECTS) {
  const res = await call("POST", "/api/company/projects", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...project, sourceDocumentId: projectSourceDocumentId }),
  });
  if (res.status >= 400) die("company/projects", res);
  projectTrust.push(res.json?.trustLevel ?? "?");
}
log("company/projects", "OK", `${projectTrust.length} projects, trust=[${projectTrust.join(", ")}]`);

// ── 0c. Legal records (licence, tax clearance) ──────────────────────────────
// Mandatory eligibility requirements are evidenced by structured vault records,
// not just uploaded files. Without them the coverage gate reports mandatory
// requirements with no adequate evidence.
const LEGAL_RECORDS = [
  { recordType: "BUSINESS_LICENSE", title: "Business Licence", authority: "Ministry of Trade and Regional Integration", referenceNumber: "MT/AA/3/0004521/2009", status: "ACTIVE", issueDate: "2026-07-11", expiryDate: "2027-07-10", sourceDocumentId: findDoc(/Trade-License/i) },
  { recordType: "TAX_CLEARANCE", title: "Tax Clearance Certificate", authority: "Ministry of Revenues", referenceNumber: "TCC/2026/44192", status: "ACTIVE", issueDate: "2026-06-30", expiryDate: "2026-12-31", sourceDocumentId: findDoc(/Tax-Clearance/i) },
];
const legalTrust = [];
for (const record of LEGAL_RECORDS) {
  const res = await call("POST", "/api/company/legal-records", {
    headers: { "content-type": "application/json" }, body: JSON.stringify(record),
  });
  if (res.status >= 400) { legalTrust.push(`HTTP ${res.status}`); continue; }
  legalTrust.push(res.json?.trustLevel ?? "created");
}
log("company/legal-records", "OK", legalTrust.join(", "));

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

// ── Async job worker ────────────────────────────────────────────────────────
// This branch runs extraction and AI Analyze as durable AiJobs instead of doing
// the work inside the request. Drain the queue for this tender the way the
// deployed worker does, then report what actually ran.
async function drainJobs(label, { maxRounds = 20 } = {}) {
  const ran = [];
  for (let round = 0; round < maxRounds; round += 1) {
    const res = await call("POST", `/api/ai-jobs/run-next?tenderId=${tenderId}`);
    if (res.status >= 400) break;
    const results = res.json?.results ?? res.json?.jobs ?? [];
    const processed = res.json?.processed ?? results.length;
    if (!processed) break;
    for (const job of results) ran.push(`${job.jobType}:${job.status}`);
  }
  log(`worker (${label})`, "INFO", ran.length ? ran.join(", ") : "no queued jobs");
  return ran;
}

// ── 2b. Wait for source extraction ──────────────────────────────────────────
await drainJobs("extraction");
for (let attempt = 0; attempt < 30; attempt += 1) {
  r = await call("GET", `/api/tenders/${tenderId}/extraction-quality`);
  if (r.json?.readyForAnalysis) break;
  await drainJobs(`extraction retry ${attempt + 1}`, { maxRounds: 3 });
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
log("extraction ready", r.json?.readyForAnalysis ? "OK" : "INFO",
  `readyForAnalysis=${r.json?.readyForAnalysis} pages=${r.json?.summary?.totalPages} extracted=${r.json?.summary?.extractedPages}`);

// ── 3. AI Analyze (manual, job-based on this branch) ────────────────────────
r = await call("POST", `/api/tenders/${tenderId}/manual-ai-analyze`, {
  headers: { "content-type": "application/json" },
  body: JSON.stringify({}),
});
if (r.status >= 400) die("manual-ai-analyze", r);
const analyzeJobId = r.json?.jobId;
log("manual-ai-analyze", "OK", `job=${analyzeJobId} status=${r.json?.status} next=${r.json?.nextAction}`);

await drainJobs("ai-analyze");
for (let attempt = 0; attempt < 30 && analyzeJobId; attempt += 1) {
  r = await call("GET", `/api/ai-jobs/${analyzeJobId}`);
  const st = r.json?.job?.status ?? r.json?.status;
  if (st && !["QUEUED", "RUNNING", "PENDING"].includes(st)) break;
  await drainJobs(`ai-analyze retry ${attempt + 1}`, { maxRounds: 3 });
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
log("ai-analyze job", "INFO", body(r, 400));

// ── 4. Engine ───────────────────────────────────────────────────────────────
r = await call("POST", `/api/tenders/${tenderId}/engine`, {
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "run" }),
});
log("engine/run", r.status < 400 ? "OK" : "INFO", `HTTP ${r.status} ${body(r, 400)}`);

// Run Engine is job-based on this branch (202 + jobId); drain it before the
// Build Plan reads its output.
if (r.status === 202 && r.json?.jobId) {
  const engineJobId = r.json.jobId;
  await drainJobs("engine");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const st = await call("GET", `/api/ai-jobs/${engineJobId}`);
    const status = st.json?.job?.status ?? st.json?.status;
    if (status && !["QUEUED", "RUNNING", "PENDING"].includes(status)) {
      log("engine job", status === "SUCCEEDED" ? "OK" : "INFO", `status=${status} ${st.json?.job?.errorMessage ?? ""}`);
      break;
    }
    await drainJobs(`engine retry ${attempt + 1}`, { maxRounds: 3 });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

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
log("matching-diagnostics", r.status === 404 ? "INFO" : r.status < 400 ? "OK" : "INFO",
  r.status === 404
    ? "route not present on this branch — reading match state from the database"
    : `experts total=${r.json?.experts?.total} selected=${r.json?.experts?.selected}`);

// Match IDs are not exposed by any list endpoint (the tender page renders them
// server-side), so the harness reads the ids straight from the database and
// then performs the SELECTION through the real PUT /matches route.
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const expertMatches = await prisma.tenderExpertMatch.findMany({ where: { tenderId }, select: { id: true, score: true } });
const projectMatches = await prisma.tenderProjectMatch.findMany({ where: { tenderId }, select: { id: true, score: true } });
await prisma.$disconnect();
let selected = 0;
let selectFailure = null;
for (const m of [...expertMatches].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 4)) {
  const res = await call("PUT", `/api/tenders/${tenderId}/matches`, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ matchId: m.id, matchType: "expert", isSelected: true }),
  });
  if (res.status < 400) selected += 1;
  else if (!selectFailure) selectFailure = `expert PUT /matches HTTP ${res.status} ${body(res, 300)}`;
}
let selectedProjects = 0;
for (const m of [...projectMatches].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 4)) {
  const res = await call("PUT", `/api/tenders/${tenderId}/matches`, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ matchId: m.id, matchType: "project", isSelected: true }),
  });
  if (res.status < 400) selectedProjects += 1;
  else if (!selectFailure) selectFailure = `project PUT /matches HTTP ${res.status} ${body(res, 300)}`;
}
log("select matches", selected > 0 || expertMatches.length === 0 ? "OK" : "INFO", `experts=${selected}/${expertMatches.length} projects=${selectedProjects}/${projectMatches.length}${selectFailure ? ` | first failure: ${selectFailure}` : ""}`);

// ── 6b2. Re-run Run Engine against the CONFIRMED Build Plan ─────────────────
// Requirement coverage is computed by the engine, and BUILD_PLAN_ITEM evidence
// candidates only exist once a confirmed plan does. The first engine run
// therefore cannot mark requirements whose evidence is a file this workflow
// will generate (evidenceSource AUTO_PLANNED_ARTIFACT), so those requirements
// stay PARTIAL and the coverage gate blocks. Running the engine again now that
// the plan is confirmed is what produces those rows.
r = await call("POST", `/api/tenders/${tenderId}/engine`, {
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "run" }),
});
if (r.status === 202 && r.json?.jobId) {
  const reEngineJobId = r.json.jobId;
  await drainJobs("engine rerun");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const st = await call("GET", `/api/ai-jobs/${reEngineJobId}`);
    const status = st.json?.job?.status ?? st.json?.status;
    if (status && !["QUEUED", "RUNNING", "PENDING"].includes(status)) {
      log("engine rerun", status === "SUCCEEDED" ? "OK" : "INFO", `status=${status}`);
      break;
    }
    await drainJobs(`engine rerun retry ${attempt + 1}`, { maxRounds: 3 });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
} else {
  log("engine rerun", "INFO", `HTTP ${r.status} ${body(r, 200)}`);
}

// ── 6c. Link Vault evidence to requirements ─────────────────────────────────
// The readiness gate reports mandatory requirements without FULL/SUBSTANTIAL
// coverage and points at LINK_VAULT_EVIDENCE. This is the operator's step:
// attach eligible, source-backed vault records as evidence for them.
r = await call("POST", `/api/tenders/${tenderId}/link-vault-evidence-auto`, {
  headers: { "content-type": "application/json" },
  body: JSON.stringify({}),
});
log("link-vault-evidence-auto", r.status < 400 ? "OK" : "INFO", `HTTP ${r.status} ${body(r, 500)}`);

// ── 7. Generation readiness ─────────────────────────────────────────────────
r = await call("GET", `/api/tenders/${tenderId}/generation-readiness`);
log("generation-readiness", "INFO", `ready=${r.json?.ready} ${JSON.stringify(r.json?.blockers ?? r.json ?? null).slice(0, 500)}`);

// ── 8. Generate ─────────────────────────────────────────────────────────────
// The generator refuses while any mandatory requirement is untraced and names
// repair-source-grounding as the recovery. Call it once and retry, so the run
// reports the next real stop rather than this one. Whether that click should be
// mandatory at all is a separate question about the automation contract.
async function generateOnce() {
  return call("POST", `/api/tenders/${tenderId}/generate`, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}
r = await generateOnce();
if (r.status >= 400 && r.json?.code === "UNTRACED_MANDATORY_REQUIREMENTS") {
  const untraced = r.json?.requirements?.length ?? 0;
  const repair = await call("POST", `/api/tenders/${tenderId}/repair-source-grounding`, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  log("repair-source-grounding", repair.status < 400 ? "OK" : "INFO", `HTTP ${repair.status} untraced=${untraced} ${body(repair, 400)}`);
  r = await generateOnce();
}
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
