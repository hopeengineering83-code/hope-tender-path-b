/**
 * Pharo golden benchmark — real product code, real inputs.
 *
 * Imports the real Company Vault JSON through POST /api/company/plan-b-import,
 * uploads the real Pharo tender DOCX through POST /api/tenders/upload-first,
 * then drives extraction, the two manual gates, build plan, generation,
 * auto-finalize and download exactly as the app does. Writes every artifact and
 * every provider prompt to disk so the OUTPUT can be inspected rather than
 * inferred.
 *
 * Not a test: a measurement instrument. The durable assertions live in tests/.
 */
import { createServer, type Server } from "node:http";
import { createHmac, randomBytes, createHash } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";

const OUT = process.env.BENCH_OUT || "/tmp/pharo-bench";
mkdirSync(OUT, { recursive: true });
mkdirSync(`${OUT}/prompts`, { recursive: true });

const COOKIES: Record<string, string> = {};
const nextHeadersMock = {
  cookies: async () => ({
    get: (n: string) => (COOKIES[n] ? { name: n, value: COOKIES[n] } : undefined),
    set: (n: string, v: string) => { COOKIES[n] = v; },
    delete: (n: string) => { delete COOKIES[n]; },
    getAll: () => Object.entries(COOKIES).map(([name, value]) => ({ name, value })),
  }),
};
{
  const Module = require("module");
  const orig = (Module as any)._resolveFilename;
  const p = "__bench_next_headers__";
  require.cache[p] = { id: p, filename: p, loaded: true, exports: nextHeadersMock, paths: [], children: [], parent: null } as any;
  (Module as any)._resolveFilename = function (r: string, ...a: any[]) { return r === "next/headers" ? p : orig.call(this, r, ...a); };
}

// ─── local model: grounded in the REAL Pharo tender ────────────────────────
let promptIndex = 0;
const promptLog: Array<{ kind: string; chars: number; file: string }> = [];

function pharoAnalysis(prompt: string) {
  const m = /\[FILE_ID:([0-9a-fA-F-]{36})\|FILE_NAME:([^\]]*)\]/.exec(prompt);
  const FILE_ID = m ? m[1] : null;
  const FILE_NAME = m ? m[2] : "pharo-tender.docx";
  const req = (title: string, description: string, type: string, quote: string, page: number) => ({
    title, description, requirementType: type, priority: "MANDATORY",
    exactFileName: "Technical Proposal.pdf", requiredQuantity: null, pageLimit: null, restrictions: null,
    sectionReference: null, sourcePage: page, sourceQuote: quote,
    sourceFileToken: FILE_ID, sourceTenderFileId: FILE_ID, sourceFileName: FILE_NAME, sourceSectionHeading: null,
  });
  return {
    summary: "Pharo Ventures invites technical proposals for architectural consultancy services for the Pharo Health Ethiopia Specialty Medical Center in Addis Ababa. The assignment spans facility identification and technical assessment, conceptual and detailed architectural design to Ethiopian healthcare standards, engineering coordination across MEP and medical gas, regulatory compliance and approvals, renovation planning with implementation oversight, and project close-out support. Only a technical proposal is required at this stage; no financial proposal is to be submitted. Evaluation is on healthcare experience, portfolio quality, facility design understanding, team strength and submission compliance, with no weights published.",
    tenderTitle: "Architectural Consultancy Services for Pharo Health Ethiopia Specialty Medical Center",
    tenderTitleSourcePage: 1,
    tenderTitleSourceQuote: "Architectural Consultancy Services for Pharo Health Ethiopia Specialty Medical Center",
    deadline: "2026-08-25",
    deadlineSourcePage: 3,
    deadlineSourceQuote: "Submission Deadline: August 25, 2026, 5:00 PM Addis Ababa Time",
    requirements: [
      req("Cover Letter", "The technical proposal must include a cover letter.", "FORMAT", "Cover Letter", 4),
      req("Company Profile", "The technical proposal must include a company profile.", "COMPANY_PROFILE", "Company Profile", 4),
      req("Relevant Healthcare Project Experience", "The proposal must present relevant healthcare project experience.", "PROJECT_EXPERIENCE", "Relevant Healthcare Project Experience", 4),
      req("Technical Approach and Methodology", "The proposal must set out the technical approach and methodology for the scope of services.", "METHODOLOGY", "Technical Approach and Methodology", 4),
      req("Proposed Professional Team", "The proposal must present the proposed professional team.", "EXPERT", "Proposed Professional Team", 4),
      req("Healthcare Compliance and Workflow Planning Approach", "The proposal must describe the healthcare compliance and workflow planning approach.", "TECHNICAL", "Healthcare Compliance and Workflow Planning Approach", 4),
      req("Additional Information / Certifications", "The proposal must include additional information and certifications.", "DECLARATION", "Additional Information / Certifications", 4),
      req("Annexes / Supporting Documents", "The proposal must include annexes and supporting documents.", "ANNEX", "Annexes / Supporting Documents", 4),
    ],
    exactFileNaming: ["Technical Proposal.pdf"],
    exactFileOrder: ["Technical Proposal.pdf"],
    tenderCategory: "HEALTHCARE",
    envelopeMode: "SINGLE",
    clientType: "PRIVATE",
    submissionFormat: "GOVERNMENT_RFP",
    evaluationMethodology: "Five evaluation criteria are listed and no percentage weights are provided: relevant healthcare project experience; quality and relevance of portfolio; technical understanding of healthcare facility design; strength of professional team; compliance with submission requirements. Weights are not stated in the tender and must not be invented.",
    submissionNotes: "Email submission only, in PDF. Deadline 25 August 2026 at 17:00 Addis Ababa time. Submission addresses edessalegn@pharoventures.com and fgetachewdesta@pharoventures.com. Required email subject: \"Technical Proposal for Pharo Ventures\". Required document: Technical Proposal.pdf. No financial proposal is required at this stage. Bid bond, pre-bid meeting, proposal validity and page limit are not mentioned in the notice.",
    procuringEntityName: "Pharo Ventures",
    legalClientName: "Pharo Ventures",
    donorAgency: null,
    implementingAgency: null,
    country: "Ethiopia",
    clientCity: "Addis Ababa",
    clientAddress: null,
    clientContactName: null,
    clientContactEmail: null,
    clientContactPhone: null,
    submissionAddress: null,
    clientWebsite: null,
    submissionEmailSubject: "Technical Proposal for Pharo Ventures",
    preBidChannel: null, preBidMeetingDate: null, preBidMeetingLocation: null,
    clientRepresentative: null,
    procurementReferenceNumber: null,
    submissionMethod: "Email",
    submissionEmails: "edessalegn@pharoventures.com, fgetachewdesta@pharoventures.com",
    clientNameSourcePage: 2,
    clientNameSourceQuote: "Procuring Entity / Client Name: Pharo Ventures",
    submissionEmailSourcePage: 3,
    submissionEmailSourceQuote: "Submission Email(s): edessalegn@pharoventures.com; fgetachewdesta@pharoventures.com",
    submissionMethodSourcePage: 3,
    submissionMethodSourceQuote: "Submission Method: Email submission only",
    contactDetailsSource: {
      country: { page: 2, quote: "Country: Ethiopia" },
      clientCity: { page: 2, quote: "City / Location: Addis Ababa" },
      submissionEmailSubject: { page: 3, quote: "Required Email Subject: Technical Proposal for Pharo Ventures" },
      submissionMethod: { page: 3, quote: "Submission Method: Email submission only" },
    },
    evaluationCriteriaSource: [
      { criterion: "Relevant healthcare project experience", weight: null, sourcePage: 5, sourceQuote: "Relevant healthcare project experience" },
      { criterion: "Quality and relevance of portfolio", weight: null, sourcePage: 5, sourceQuote: "Quality and relevance of portfolio" },
      { criterion: "Technical understanding of healthcare facility design", weight: null, sourcePage: 5, sourceQuote: "Technical understanding of healthcare facility design" },
      { criterion: "Strength of professional team", weight: null, sourcePage: 5, sourceQuote: "Strength of professional team" },
      { criterion: "Compliance with submission requirements", weight: null, sourcePage: 5, sourceQuote: "Compliance with submission requirements" },
    ],
  };
}

// Drafting stand-in. Echoes a marker plus a digest of the context it received,
// so the ENGINE's contribution (what it asked for, with what evidence) can be
// audited even though the model's own prose cannot be judged offline.
function draftAnswer(prompt: string): string {
  const heading = /##\s*([^\n]+)/.exec(prompt)?.[1] ?? "Section";
  return [
    `## ${heading}`,
    "",
    `[LOCAL-MODEL DRAFT] This paragraph stands in for provider prose. The engine supplied ${prompt.length} characters of context for this section. `.repeat(3),
    "",
    "The consultant will carry out the described activities in accordance with the tender scope, applying the firm's verified project experience and the named professional team, with quality assurance applied to every deliverable before issue.",
  ].join("\n");
}

async function startModel(): Promise<string> {
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let parsed: any = {};
      try { parsed = JSON.parse(body); } catch { /* ignore */ }
      const prompt = (parsed.messages ?? []).map((m: any) => m.content ?? "").join("\n");
      const isAnalysis = /100-person senior tender board/.test(prompt) || /JSON structure required/.test(prompt);
      const kind = isAnalysis ? "analysis" : "draft";
      const file = `${OUT}/prompts/${String(++promptIndex).padStart(3, "0")}-${kind}.txt`;
      writeFileSync(file, prompt);
      promptLog.push({ kind, chars: prompt.length, file });
      const content = isAnalysis ? JSON.stringify(pharoAnalysis(prompt)) : draftAnswer(prompt);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-bench", object: "chat.completion", created: Math.floor(Date.now() / 1000),
        model: parsed.model ?? "local", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  (globalThis as any).__benchServer = server;
  return `http://127.0.0.1:${(server.address() as any).port}/v1`;
}

const say = (s: string) => console.log(s);

async function main() {
  const baseUrl = await startModel();
  // Cerebras is the stand-in provider: OpenAI-compatible wire format, an
  // overridable base URL, and its default gpt-oss-120b profile carries a
  // 128k window with no free-tier tokens-per-minute ceiling. Groq's
  // llama-3.1-8b profile caps at 6,000 TPM, which this tender's real prompt
  // exceeds — a genuine provider constraint, not something to work around in
  // product code.
  process.env.CEREBRAS_API_KEY = "local-bench-key-not-a-real-secret";
  process.env.CEREBRAS_BASE_URL = baseUrl;
  for (const n of ["GEMINI_API_KEY","GROQ_API_KEY","MISTRAL_API_KEY","ZAI_API_KEY","OPENROUTER_API_KEY","OPENAI_API_KEY","TOGETHER_API_KEY","DEEPSEEK_API_KEY","ANTHROPIC_API_KEY"]) delete process.env[n];

  const prismaModule = require("../lib/prisma");
  const prisma = prismaModule.prisma;
  await prismaModule.prismaReady;

  const user = await prisma.user.create({
    data: { name: "Pharo Benchmark", email: `pharo-bench+${Date.now()}@example.test`, passwordHash: "x", role: "ADMIN",
      company: { create: { name: "Hope Urban Planning Architectural and Engineering Consultancy PLC" } } },
    include: { company: true },
  });
  const userId = user.id;
  const secret = process.env.SESSION_SECRET!;
  const payload = { userId, exp: Math.floor((Date.now() + 14 * 86400_000) / 1000), nonce: randomBytes(16).toString("base64url") };
  const enc = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const token = `${enc}.${createHmac("sha256", secret).update(enc).digest("base64url")}`;
  await prisma.session.create({ data: { token: createHash("sha256").update(token).digest("hex"), userId, expiresAt: new Date(Date.now() + 14 * 86400_000) } });
  COOKIES["hope_session"] = token;
  say(`user=${userId} company=${user.company.id}`);

  // ── 1. Import the real vault through the real route ──────────────────────
  const vault = JSON.parse(readFileSync(process.env.VAULT_JSON!, "utf8"));
  const importRoute = require("../app/api/company/plan-b-import/route");
  const imp = await importRoute.POST(new Request("http://localhost/api/company/plan-b-import", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(vault),
  }));
  const impBody = await imp.text();
  say(`\n[1] plan-b-import -> HTTP ${imp.status}`);
  say(`    ${impBody.slice(0, 500)}`);
  const counts = await Promise.all([
    prisma.expert.count({ where: { companyId: user.company.id } }),
    prisma.project.count({ where: { companyId: user.company.id } }),
    prisma.companyDocument.count({ where: { companyId: user.company.id } }),
  ]);
  say(`    experts=${counts[0]} projects=${counts[1]} companyDocuments=${counts[2]}`);
  if (counts.every((count) => count === 0)) {
    say("    GENUINE_SOURCE_BLOCKED: the supplied Vault export contains no importable source-backed experts, projects, or documents; refusing to fabricate benchmark evidence.");
    return { prisma, userId };
  }

  // ── 2. Upload the real tender ────────────────────────────────────────────
  const uploadFirst = require("../app/api/tenders/upload-first/route");
  const bytes = readFileSync(process.env.TENDER_DOCX!);
  const fd = new FormData();
  fd.append("title", "Architectural Consultancy Services for Pharo Health Ethiopia Specialty Medical Center");
  fd.append("file", new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "pharo-tender.docx");
  const up = await uploadFirst.POST(new Request("http://localhost/api/tenders/upload-first", { method: "POST", body: fd }));
  const upBody = await up.text();
  say(`\n[2] upload-first -> HTTP ${up.status}`);
  if (up.status !== 201) { say(upBody.slice(0, 800)); return { prisma }; }
  const tenderId = JSON.parse(upBody).tenderId;
  say(`    tenderId=${tenderId}`);

  const runNext = require("../app/api/ai-jobs/run-next/route");
  const wake = (qs: string) => runNext.POST(new Request(`http://localhost/api/ai-jobs/run-next?${qs}`, { method: "POST" })).then((r: Response) => r.text());

  // ── 3. Extraction ────────────────────────────────────────────────────────
  for (let i = 0; i < 15; i++) {
    await wake(`jobType=EXTRACT_TEXT&tenderId=${encodeURIComponent(tenderId)}`);
    const files = await prisma.tenderFile.findMany({ where: { tenderId }, select: { extractedText: true, totalPages: true, extractedPages: true, extractionScore: true } });
    if (files.length && files.every((f: any) => (f.extractedText?.length ?? 0) > 0)) {
      say(`\n[3] extraction -> chars=${files[0].extractedText.length} pages=${files[0].extractedPages}/${files[0].totalPages} score=${files[0].extractionScore}`);
      break;
    }
    if (i === 14) { say("\n[3] extraction FAILED"); return { prisma }; }
  }

  // ── 4/5. The two manual gates ────────────────────────────────────────────
  const manual = require("../app/api/tenders/[id]/manual-ai-analyze/route");
  const q = await manual.POST(new Request(`http://localhost/api/tenders/${tenderId}/manual-ai-analyze`, { method: "POST" }), { params: Promise.resolve({ id: tenderId }) });
  const jobId = JSON.parse(await q.text()).jobId;
  let st = "";
  for (let i = 0; i < 25; i++) {
    await wake(`jobType=AI_ANALYZE&tenderId=${encodeURIComponent(tenderId)}`);
    const j = await prisma.aiJob.findUnique({ where: { id: jobId }, select: { status: true, errorMessage: true } });
    st = j?.status ?? "GONE";
    if (["SUCCEEDED","PARTIAL_SUCCESS","FAILED","CANCELED"].includes(st)) { if (st !== "SUCCEEDED") say(`    analyze error: ${j?.errorMessage}`); break; }
  }
  const t = await prisma.tender.findUnique({ where: { id: tenderId }, select: { clientName: true, procuringEntityName: true, deadline: true, submissionMethod: true, submissionEmails: true, submissionEmailSubject: true, analysisExtractionStatus: true } });
  const reqCount = await prisma.tenderRequirement.count({ where: { tenderId } });
  say(`\n[4] AI Analyze -> ${st}`);
  say(`    client=${t?.procuringEntityName ?? t?.clientName} deadline=${t?.deadline?.toISOString?.().slice(0,10)} method=${t?.submissionMethod}`);
  say(`    emails=${t?.submissionEmails}`);
  say(`    subject=${t?.submissionEmailSubject}`);
  say(`    requirements=${reqCount} extractionStatus=${t?.analysisExtractionStatus}`);
  if (st !== "SUCCEEDED") return { prisma, tenderId, userId };

  const engine = require("../app/api/tenders/[id]/engine/route");
  const e = await engine.POST(new Request(`http://localhost/api/tenders/${tenderId}/engine`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manualRequested: true }) }), { params: Promise.resolve({ id: tenderId }) });
  say(`\n[5] Run Engine -> HTTP ${e.status}`);
  for (let r = 0; r < 60; r++) { await wake("take=1"); if (await prisma.aiJob.count({ where: { tenderId, status: { in: ["QUEUED","RUNNING"] } } }) === 0) break; }

  const selE = await prisma.tenderExpertMatch.count({ where: { tenderId, isSelected: true } });
  const selP = await prisma.tenderProjectMatch.count({ where: { tenderId, isSelected: true } });
  say(`    selected experts=${selE} selected projects=${selP}`);

  // ── 6/7. Plan + generation ───────────────────────────────────────────────
  const plan = require("../app/api/tenders/[id]/build-plan/route");
  const bp = await plan.POST(new Request(`http://localhost/api/tenders/${tenderId}/build-plan`, { method: "POST" }), { params: Promise.resolve({ id: tenderId }) });
  const bpBody = await bp.text();
  const items = (JSON.parse(bpBody).items ?? []) as any[];
  say(`\n[6] Build Plan -> HTTP ${bp.status} items=${items.length}`);
  for (const i of items) say(`      ${i.exactFileName} (${i.documentType}, envelope=${i.envelope}, required=${i.required})`);
  const confirm = require("../app/api/tenders/[id]/build-plan/confirm/route");
  await confirm.POST(new Request(`http://localhost/api/tenders/${tenderId}/build-plan/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), { params: Promise.resolve({ id: tenderId }) });

  const docsAfterEngine = await prisma.generatedDocument.findMany({ where: { tenderId }, select: { exactFileName: true, format: true, generationStatus: true } });
  say(`\n[6b] documents ALREADY present after Run Engine (before any explicit generate): ${docsAfterEngine.length}`);
  for (const d of docsAfterEngine) say(`      ${d.exactFileName} [${d.format}/${d.generationStatus}]`);
  const SKIP_GEN = process.env.BENCH_SKIP_EXPLICIT_GENERATE === "1";
  const gen = require("../app/api/tenders/[id]/generate/route");
  const g = SKIP_GEN ? { status: 999, text: async () => "skipped" } as any : await gen.POST(new Request(`http://localhost/api/tenders/${tenderId}/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), { params: Promise.resolve({ id: tenderId }) });
  say(`\n[7] Generate -> HTTP ${g.status}`);
  if (g.status >= 400) say(`    ${(await g.text()).slice(0, 700)}`);
  for (let r = 0; r < 60; r++) { await wake("take=1"); if (await prisma.aiJob.count({ where: { tenderId, status: { in: ["QUEUED","RUNNING"] } } }) === 0) break; }

  const { runAutoFinalizeAfterGeneration } = require("../lib/ai-jobs/auto-finalize-continuation-service");
  const afJob = await prisma.aiJob.findFirst({ where: { tenderId, jobType: "AUTO_FINALIZE" }, select: { id: true } });
  if (!afJob) {
    say("\n[8] AUTO_FINALIZE not queued because an upstream canonical blocker remains; stopping without manufacturing a job identity.");
    return { prisma, tenderId, userId };
  }
  let af: any = null;
  for (let a = 0; a < 3; a++) {
    af = await runAutoFinalizeAfterGeneration(tenderId, userId, afJob.id);
    say(`\n[8.${a + 1}] AUTO_FINALIZE ok=${af?.ok}`);
    say(`      exportRepair=${JSON.stringify(af?.exportRepair)}`);
    say(`      validation=${JSON.stringify(af?.validation?.validated)}/${JSON.stringify(af?.validation?.failed)} pdfFinalization=${JSON.stringify(af?.pdfFinalization)} pdfValidation=${JSON.stringify(af?.pdfValidation?.validated)}/${JSON.stringify(af?.pdfValidation?.failed)}`);
    say(`      coverage=${JSON.stringify(af?.coverageReconciliation)} reconciliation=${JSON.stringify(af?.packageReconciliation)}`);
    say(`      blockers=${JSON.stringify(af?.blockers)}`);
    const snap = await prisma.generatedDocument.findMany({ where: { tenderId }, select: { exactFileName: true, format: true, generationStatus: true, validationStatus: true } });
    say(`      rows: ${snap.map((d: any) => `${d.exactFileName}[${d.format}/${d.generationStatus}/${d.validationStatus}]`).join(", ")}`);
    if (af.ok) break;
  }

  const docs = await prisma.generatedDocument.findMany({ where: { tenderId, generationStatus: { not: "SUPERSEDED" } }, select: { name: true, exactFileName: true, documentType: true, format: true, generationStatus: true, validationStatus: true, contentByteLength: true, fileContent: true } });
  say(`\n[9] documents (${docs.length}):`);
  for (const d of docs) say(`      ${d.exactFileName ?? d.name} type=${d.documentType} fmt=${d.format} gen=${d.generationStatus} val=${d.validationStatus} bytes=${d.contentByteLength}`);

  // ── 9b. Reconciliation diagnostics ───────────────────────────────────────
  {
    const { getCurrentConfirmedBuildPlan } = require("../lib/engine/build-plan");
    const { findMissingGeneratedDocuments, findExtraGeneratedDocuments } = require("../lib/engine/submission-plan");
    const confirmed = await getCurrentConfirmedBuildPlan(prisma, tenderId).catch((e: any) => ({ ok: false, error: String(e) }));
    say(`\n[9b] confirmed plan ok=${(confirmed as any)?.ok} items=${((confirmed as any)?.items ?? []).length}`);
    for (const it of ((confirmed as any)?.items ?? [])) say(`      plan: ${it.exactFileName} (${it.documentType}, required=${it.required})`);
    const plan = { files: ((confirmed as any)?.items ?? []) } as any;
    const rows = await prisma.generatedDocument.findMany({ where: { tenderId, generationStatus: { not: "SUPERSEDED" } }, select: { id: true, name: true, exactFileName: true, exactOrder: true, documentType: true, format: true, generationStatus: true } });
    say(`      missing: ${JSON.stringify(findMissingGeneratedDocuments(plan, rows).map((f: any) => f.exactFileName))}`);
    say(`      extra:   ${JSON.stringify(findExtraGeneratedDocuments(plan, rows).map((d: any) => d.exactFileName ?? d.name))}`);
    const er = require("../app/api/tenders/[id]/export-readiness/route");
    const erRes = await er.GET(new Request(`http://localhost/api/tenders/${tenderId}/export-readiness`), { params: Promise.resolve({ id: tenderId }) });
    const erBody = await erRes.text();
    say(`      export-readiness: ${erBody.slice(0, 900)}`);
  }

  // ── 10. Download ─────────────────────────────────────────────────────────
  const dl = require("../app/api/tenders/[id]/download/route");
  for (const qs of ["type=zip", "type=zip&envelope=technical"]) {
    const res = await dl.GET(new Request(`http://localhost/api/tenders/${tenderId}/download?${qs}`), { params: Promise.resolve({ id: tenderId }) });
    const ct = res.headers.get("content-type");
    say(`\n[10] download?${qs} -> HTTP ${res.status} ${ct}`);
    if (res.status === 200 && ct === "application/zip") {
      const b = Buffer.from(await res.arrayBuffer());
      writeFileSync(`${OUT}/pharo-${qs.includes("technical") ? "technical" : "all"}.zip`, b);
      say(`      wrote ${b.length} bytes`);
      break;
    } else { say(`      ${(await res.text()).slice(0, 500)}`); }
  }
  for (const d of docs) {
    if (d.fileContent) writeFileSync(`${OUT}/${(d.exactFileName ?? d.name).replace(/[^\w.\-]/g, "_")}`, Buffer.from(d.fileContent, "base64"));
  }

  say(`\n[11] provider prompts captured: ${promptLog.length}`);
  for (const p of promptLog) say(`      ${p.kind.padEnd(9)} ${String(p.chars).padStart(7)} chars  ${p.file}`);
  writeFileSync(`${OUT}/prompt-index.json`, JSON.stringify(promptLog, null, 2));
  return { prisma, tenderId, userId };
}

main()
  .then(async (r: any) => { await r?.prisma?.$disconnect?.().catch(() => {}); (globalThis as any).__benchServer?.close(); })
  .catch(async (e) => { console.error("BENCH THREW:", e?.stack || e); (globalThis as any).__benchServer?.close(); process.exitCode = 1; });
