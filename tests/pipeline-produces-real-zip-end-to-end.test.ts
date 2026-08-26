/**
 * End-to-end pipeline acceptance: a real ZIP, or this test fails.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The suite could not tell a working product from a broken one, and said so
 * with a straight face. tests/golden-tender-acceptance.test.ts imports only
 * node builtins, so it cannot execute a line of product code: it declares ten
 * tender fixtures, never feeds one to an extractor, and asserts that its own
 * string literals are non-empty. Its pipeline cases are readFileSync +
 * `src.includes("SOME_IDENTIFIER")` greps, which pass for exactly as long as an
 * identifier is still spelled the same way — replacing lib/engine/final-zip-scope.ts
 * with a function that throws, keeping only the identifiers in a comment, left
 * its "correct ZIP contents" case green. The two Playwright specs that touch
 * the pipeline accept a FAILED AI Analyze as a terminal state, run Run Engine
 * only `if (status === "SUCCEEDED")`, and finish on
 * `expect(typeof readiness.ready).toBe("boolean")`; the CI step that runs them
 * blanks every provider key, so analysis always fails, the engine branch is
 * never entered, and nothing downstream of it is ever asserted.
 *
 * So the whole tail of the product could be broken at once — and was — while
 * 10,000+ tests stayed green: the confirmed plan's second file was never given
 * a document row, Authority Review judged documents by a metadata string
 * instead of their bytes, and the support-document classifier could not
 * recognise the hyphenated file name the tender itself mandates.
 *
 * This test asserts the one thing that cannot be faked: that driving the real
 * routes, in the owner's order, with only the two manual clicks the contract
 * allows, yields an archive with real entries holding real bytes. It fails when
 * no ZIP is produced.
 *
 * THE MODEL IS LOCAL, THE PRODUCT IS NOT.
 * There is no provider key in CI and no offline mode in the app. Stubbing the
 * app's own functions would fake the code under test, so instead this starts a
 * local OpenAI-compatible server and points GROQ_BASE_URL at it. The app's real
 * provider client makes a real HTTP request, and its own parsing, sanitisation,
 * grounding checks and persistence all run normally. Only the model's answer is
 * local — the one thing that cannot be bought without a key.
 *
 * Run: RUN_DB_INTEGRATION=true DATABASE_URL=postgresql://... npm test
 */

import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createHmac, randomBytes, createHash } from "node:crypto";
import JSZip from "jszip";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const dbDescribe = RUN_DB ? describe : describe.skip;

const SESSION_COOKIE = "hope_session";
let COOKIES: Record<string, string> = {};

if (RUN_DB) {
  const nextHeadersMock = {
    cookies: async () => ({
      get: (n: string) => (COOKIES[n] ? { name: n, value: COOKIES[n] } : undefined),
      set: (n: string, v: string) => { COOKIES[n] = v; },
      delete: (n: string) => { delete COOKIES[n]; },
      getAll: () => Object.entries(COOKIES).map(([name, value]) => ({ name, value })),
    }),
  };
  const Module = require("module");
  const originalResolve = (Module as any)._resolveFilename;
  const mockPath = "__pipeline_zip_next_headers_mock__";
  require.cache[mockPath] = { id: mockPath, filename: mockPath, loaded: true, exports: nextHeadersMock, paths: [], children: [], parent: null } as any;
  (Module as any)._resolveFilename = function (request: string, ...args: any[]) {
    if (request === "next/headers") return mockPath;
    return originalResolve.call(this, request, ...args);
  };
}

// ── Fixture: one tender, one vault, both consistent with each other ─────────

const TENDER_FILE_NAME = "MWE-RFP-2026-0114.txt";
const PLAN_FILES = ["01-Technical-Proposal.docx", "02-Company-Profile.docx"];

const TENDER_TEXT = `[Page 1]
Ministry of Water and Energy
Procuring Entity: Ministry of Water and Energy
Country: Ethiopia
Contact Person: Ato Girma Tesfaye
Contact Email: girma.tesfaye@mwe.gov.et

REQUEST FOR PROPOSAL
Consultancy Services for Detailed Design and Construction Supervision of Rural Water Supply Schemes
Reference: MWE/RFP/2026/0114
Submission Deadline: 30 November 2026 at 14:00 local time.
Submission Method: Email
Submission Email: procurement@mwe.gov.et

[Page 2]
SECTION II - SUBMISSION INSTRUCTIONS
The technical proposal and the financial proposal must be submitted as two
separate sealed envelopes. The technical envelope must not contain any
financial information.
Files must be named and ordered exactly as follows:
1. 01-Technical-Proposal.docx
2. 02-Company-Profile.docx

[Page 3]
SECTION III - MANDATORY ELIGIBILITY REQUIREMENTS
The Consultant shall present a technical approach and methodology for the scope of services.
The Consultant shall submit a company profile describing its organisation, staffing and relevant experience.

[Page 4]
SECTION IV - EVALUATION CRITERIA
Technical approach and methodology: 35 points.
Relevant company experience: 25 points.
`;

const VAULT_EXPERT = { fullName: "Selamawit Bekele", title: "Team Leader / Water Resources Engineer", yearsExperience: 18 };
const VAULT_PROJECT = { name: "Rural Water Supply Scheme Detailed Design", clientName: "Oromia Water Works Enterprise", country: "Ethiopia", sector: "Water Supply" };
const VAULT_TEXT = `Hope Urban Planning Architectural and Engineering Consultancy is a multidisciplinary
consulting firm registered in Addis Ababa, providing water supply, sanitation, urban
planning and architectural engineering services to public and donor-funded clients.

KEY PERSONNEL
${VAULT_EXPERT.fullName} - ${VAULT_EXPERT.title}, ${VAULT_EXPERT.yearsExperience} years of professional experience
in water supply engineering, hydraulic design and construction supervision.

SELECTED PROJECT REFERENCE
${VAULT_PROJECT.name}
Client: ${VAULT_PROJECT.clientName}
Country: ${VAULT_PROJECT.country}
Sector: ${VAULT_PROJECT.sector}
`;

// ── The local model ─────────────────────────────────────────────────────────

function analysisAnswer(prompt: string) {
  // The prompt states the SOURCE FILE RULE using a literal placeholder marker
  // "[FILE_ID:<id>|FILE_NAME:<name>]" before the real per-file markers appear,
  // so match a UUID: copying the syntax example instead of the id above the
  // quote is what a weak model does, and the grounding gate rightly rejects it.
  const m = /\[FILE_ID:([0-9a-fA-F-]{36})\|FILE_NAME:([^\]]*)\]/.exec(prompt);
  const FILE_ID = m ? m[1] : null;
  const requirement = (title: string, description: string, type: string, file: string, quote: string) => ({
    title, description, requirementType: type, priority: "MANDATORY",
    exactFileName: file, requiredQuantity: null, pageLimit: null, restrictions: null,
    sectionReference: "Section III", sourcePage: 3, sourceQuote: quote,
    sourceFileToken: FILE_ID, sourceTenderFileId: FILE_ID, sourceFileName: TENDER_FILE_NAME,
    sourceSectionHeading: "SECTION III - MANDATORY ELIGIBILITY REQUIREMENTS",
  });
  return {
    summary: "The Ministry of Water and Energy invites proposals for consultancy services for the detailed design and construction supervision of rural water supply schemes under reference MWE/RFP/2026/0114. The assignment covers hydrogeological source assessment, detailed engineering design, preparation of tender documents and construction supervision. Evaluation is quality and cost based with a seventy percent technical weighting. The two-envelope rule governs packaging: the technical envelope must carry no financial information.",
    tenderTitle: "Consultancy Services for Detailed Design and Construction Supervision of Rural Water Supply Schemes",
    tenderTitleSourcePage: 1,
    tenderTitleSourceQuote: "Consultancy Services for Detailed Design and Construction Supervision of Rural Water Supply Schemes",
    deadline: "2026-11-30",
    deadlineSourcePage: 1,
    deadlineSourceQuote: "Submission Deadline: 30 November 2026 at 14:00 local time.",
    requirements: [
      requirement("Technical approach and methodology", "The proposal must present a technical approach and methodology covering source assessment, detailed engineering design, preparation of tender documents and construction supervision.", "METHODOLOGY", PLAN_FILES[0], "The Consultant shall present a technical approach and methodology for the scope of services."),
      requirement("Company profile", "The proposal must include a company profile describing the firm's organisation, staffing and relevant experience in water supply engineering.", "COMPANY_PROFILE", PLAN_FILES[1], "The Consultant shall submit a company profile describing its organisation, staffing and relevant experience."),
    ],
    exactFileNaming: PLAN_FILES,
    exactFileOrder: PLAN_FILES,
    tenderCategory: "WATER_SUPPLY",
    envelopeMode: "TWO_ENVELOPE",
    clientType: "GOVERNMENT",
    submissionFormat: "GOVERNMENT_RFP",
    evaluationMethodology: "Quality and Cost Based Selection with a technical weighting of seventy percent. Technical approach and methodology carries 35 points and relevant company experience carries 25 points.",
    submissionNotes: "Proposals must be submitted by email to procurement@mwe.gov.et no later than 30 November 2026 at 14:00 local time. The technical and financial proposals must be submitted as two separate sealed envelopes. Files must be named and ordered exactly as 01-Technical-Proposal.docx followed by 02-Company-Profile.docx.",
    procuringEntityName: "Ministry of Water and Energy",
    country: "Ethiopia",
    clientContactName: "Ato Girma Tesfaye",
    clientContactEmail: "girma.tesfaye@mwe.gov.et",
    procurementReferenceNumber: "MWE/RFP/2026/0114",
    submissionMethod: "Email",
    submissionEmails: "procurement@mwe.gov.et",
    clientNameSourcePage: 1,
    clientNameSourceQuote: "Procuring Entity: Ministry of Water and Energy",
    submissionEmailSourcePage: 1,
    submissionEmailSourceQuote: "Submission Email: procurement@mwe.gov.et",
    submissionMethodSourcePage: 1,
    submissionMethodSourceQuote: "Submission Method: Email",
    contactDetailsSource: {
      country: { page: 1, quote: "Country: Ethiopia" },
      clientContactName: { page: 1, quote: "Contact Person: Ato Girma Tesfaye" },
      clientContactEmail: { page: 1, quote: "Contact Email: girma.tesfaye@mwe.gov.et" },
      procurementReferenceNumber: { page: 1, quote: "Reference: MWE/RFP/2026/0114" },
      submissionMethod: { page: 1, quote: "Submission Method: Email" },
    },
  };
}

// Real narrative. The quality gate refuses documents that are short or
// placeholder-filled — correctly — so the stand-in writes genuine prose.
function proseAnswer(prompt: string): string {
  const section = (h: string, t: string) => `## ${h}\n\n${t}\n`;
  if (/company profile/i.test(prompt)) {
    return [
      section("Organisation", "Hope Urban Planning Architectural and Engineering Consultancy is a multidisciplinary consulting firm registered in Addis Ababa, providing water supply, sanitation, urban planning and architectural engineering services to public sector and donor-funded clients. The firm operates from a permanent office with in-house survey, design and drafting capability and maintains its own field testing equipment, so investigation programmes do not depend on subcontracted mobilisation."),
      section("Services", "The firm provides feasibility studies, hydrogeological assessment, detailed engineering design, preparation of tender documents, procurement support and construction supervision. Complementary services include topographic survey, environmental and social safeguards screening, and institutional support for the operation and maintenance arrangements that follow commissioning."),
      section("Staffing", "Permanent staff comprise civil, water resources, structural, electromechanical and environmental engineers, supported by surveyors, hydrogeologists and CAD technicians. Senior staff hold professional registration, and team leaders are drawn from the permanent establishment rather than assembled from associates at bid stage, so the team proposed is the team that performs."),
      section("Experience", "The firm has delivered feasibility studies, detailed designs and construction supervision assignments for rural water supply schemes, covering source assessment, transmission and distribution design, reservoir and public water point design, and supervision through to commissioning, for regional water works enterprises and donor-financed programmes."),
    ].join("\n");
  }
  return [
    section("Executive Summary", "Hope Urban Planning Architectural and Engineering Consultancy submits this technical proposal for consultancy services for the detailed design and construction supervision of rural water supply schemes for the Ministry of Water and Energy. The assignment covers hydrogeological source assessment, detailed engineering design, preparation of tender documents and construction supervision for community water supply systems serving dispersed rural settlements. We propose a phased delivery model that front-loads field data collection and holds design decisions open until the hydrogeological evidence supports them."),
    section("Understanding of the Assignment", "The Ministry requires a technically defensible water supply solution for communities dependent on unprotected sources, with emphasis on year-round yield, affordability of operation and community ownership. The critical constraints are seasonal variability of groundwater levels, distance between source and demand centres, limited grid electricity in the target woredas, and designs that local artisans can maintain. We read the terms of reference as requiring a documented basis of design the Ministry can defend during appraisal."),
    section("Technical Approach and Methodology", "The methodology proceeds from evidence to design rather than from design to justification. Source assessment begins with constant-rate pump testing and recovery analysis to establish sustainable yield at the end of the dry season. Demand is projected using the Ministry's design horizon and service-level standard, disaggregated by domestic, institutional and livestock demand. Hydraulic design is carried out in a calibrated network model, with residual head checked at the least favourable node under peak-hour demand. Every design decision is recorded in a basis-of-design register citing the field data supporting it."),
    section("Work Plan and Schedule", "The work plan is organised into four phases. Inception runs for four weeks and closes with an inception report confirming the methodology and the survey programme. Field investigation runs for ten weeks with parallel teams. Detailed design runs for twelve weeks and includes a draft design review workshop at the midpoint. Tender documentation runs for six weeks. Each phase has a defined start condition, so design does not begin before source yield is confirmed."),
    section("Team Composition", "The team is led by a Team Leader and Water Resources Engineer with eighteen years of professional experience in water supply engineering, hydraulic design and construction supervision, supported by a senior hydrogeologist, a civil and structural engineer, an electromechanical engineer, a surveyor, and an environmental and social specialist. Named staff are not substituted without the Ministry's written agreement."),
    section("Deliverables", "Deliverables comprise the inception report, the field investigation and survey report including all raw pump test data, the draft and final detailed design reports with drawings and hydraulic model, the tender documents with technical specifications and bills of quantities, and periodic supervision reports during construction. Drawings are issued with a revision register so superseded sheets cannot be used in error on site."),
    section("Quality Assurance", "Every calculation set is checked by an engineer who did not prepare it, against a checklist covering input data provenance, code compliance, unit consistency and boundary conditions. Drawings receive a separate coordination check. Field data are verified against original field sheets before entering the design. No document leaves the office without a signed check record, and nonconformities are logged, closed out and re-verified."),
    section("Risk Management", "The principal risks are lower than expected borehole yield, access difficulty during the rainy season, and delay in obtaining land access for reservoir sites. For each we record likelihood, impact, mitigation and owner. Yield risk is mitigated by testing before design commitment and carrying an alternative source option through the first phase. Access risk is mitigated by scheduling field work outside the peak rainy months."),
  ].join("\n");
}

let modelServer: Server | null = null;
let modelCalls = 0;

async function startLocalModel(): Promise<string> {
  modelServer = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let parsed: any = {};
      try { parsed = JSON.parse(body); } catch { /* fall through */ }
      const prompt = (parsed.messages ?? []).map((m: any) => m.content ?? "").join("\n");
      const isAnalysis = /100-person senior tender board/.test(prompt) || /JSON structure required/.test(prompt);
      modelCalls += 1;
      const content = isAnalysis ? JSON.stringify(analysisAnswer(prompt)) : proseAnswer(prompt);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-local", object: "chat.completion", created: Math.floor(Date.now() / 1000),
        model: parsed.model ?? "local", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
  });
  await new Promise<void>((resolve) => modelServer!.listen(0, "127.0.0.1", resolve));
  const port = (modelServer!.address() as { port: number }).port;
  return `http://127.0.0.1:${port}/v1`;
}

// ── Pipeline ────────────────────────────────────────────────────────────────

let prisma: any;
let userId = "";
let tenderId = "";
let zipBytes: Buffer | null = null;
let zipEntries: Array<{ name: string; size: number; text: string }> = [];
let planItemCount = 0;
let generatedDocNames: string[] = [];

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

async function docxVisibleText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")!.async("string");
  // One decoding pass, not a chain of replaces. Decoding &amp; before &apos;
  // turns a literal "&amp;apos;" -- the correct encoding of the text "&apos;"
  // -- into an apostrophe, so a document that genuinely contains that string
  // would be scanned as something it does not say.
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|apos);/g, (_match, name: string) => XML_ENTITIES[name])
    .replace(/\s+/g, " ")
    .trim();
}

before(async () => {
  if (!RUN_DB) return;

  const baseUrl = await startLocalModel();
  // Route the app's REAL provider client at the local model. Groq is the
  // provider whose base URL is overridable; no other key is set, so the
  // canonical chain selects it.
  process.env.GROQ_API_KEY = "local-model-key-not-a-real-secret";
  process.env.GROQ_BASE_URL = baseUrl;
  process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1", "localhost"].filter(Boolean).join(",");
  process.env.no_proxy = process.env.NO_PROXY;

  const prismaModule = require("../lib/prisma");
  prisma = prismaModule.prisma;
  await prismaModule.prismaReady;

  const user = await prisma.user.create({
    data: {
      name: "Pipeline ZIP", email: `pipeline-zip+${Date.now()}@example.test`,
      passwordHash: "not-used", role: "ADMIN",
      company: { create: { name: "Hope Urban Planning Architectural and Engineering Consultancy" } },
    },
    include: { company: true },
  });
  userId = user.id;

  const secret = process.env.SESSION_SECRET || process.env.AUTH_SECRET || "test-session-secret-at-least-32-characters-long";
  const payload = { userId, exp: Math.floor((Date.now() + 14 * 86_400_000) / 1000), nonce: randomBytes(16).toString("base64url") };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const token = `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
  await prisma.session.create({ data: { token: createHash("sha256").update(token).digest("hex"), userId, expiresAt: new Date(Date.now() + 14 * 86_400_000) } });
  COOKIES[SESSION_COOKIE] = token;

  // Company Vault: a real source document, then expert/project through the
  // app's own POST routes so trust level is EARNED from that source rather
  // than written straight to the table.
  const { verifiedIntegrityDataFromBase64 } = require("../lib/engine/persisted-byte-integrity");
  const vaultB64 = Buffer.from(VAULT_TEXT, "utf8").toString("base64");
  const vaultDoc = await prisma.companyDocument.create({
    data: {
      companyId: user.company.id, fileName: "company-profile.txt", originalFileName: "company-profile.txt",
      mimeType: "text/plain", size: VAULT_TEXT.length, fileContent: vaultB64,
      ...verifiedIntegrityDataFromBase64({ fileContent: vaultB64, filename: "company-profile.txt", claimedMimeType: "text/plain" }),
      category: "COMPANY_PROFILE", extractedText: VAULT_TEXT, aiExtractionStatus: "EXTRACTED", aiExtractedAt: new Date(),
    },
  });
  const expertsRoute = require("../app/api/company/experts/route");
  const projectsRoute = require("../app/api/company/projects/route");
  const expertRes = await expertsRoute.POST(new Request("http://localhost/api/company/experts", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...VAULT_EXPERT, sourceDocumentId: vaultDoc.id }),
  }));
  assert.ok(expertRes.status < 300, `vault expert create failed: ${expertRes.status} ${await expertRes.text()}`);
  const projectRes = await projectsRoute.POST(new Request("http://localhost/api/company/projects", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...VAULT_PROJECT, sourceDocumentId: vaultDoc.id }),
  }));
  assert.ok(projectRes.status < 300, `vault project create failed: ${projectRes.status} ${await projectRes.text()}`);

  // ── Intake ───────────────────────────────────────────────────────────────
  const uploadFirst = require("../app/api/tenders/upload-first/route");
  const form = new FormData();
  form.append("title", "Consultancy Services for Rural Water Supply Schemes");
  form.append("reference", "MWE/RFP/2026/0114");
  form.append("file", new Blob([TENDER_TEXT], { type: "text/plain" }), TENDER_FILE_NAME);
  const intake = await uploadFirst.POST(new Request("http://localhost/api/tenders/upload-first", { method: "POST", body: form }));
  const intakeBody = await intake.clone().text();
  assert.equal(intake.status, 201, `tender intake failed: ${intake.status} ${intakeBody}`);
  tenderId = JSON.parse(intakeBody).tenderId;

  const runNext = require("../app/api/ai-jobs/run-next/route");
  const wake = (qs: string) => runNext.POST(new Request(`http://localhost/api/ai-jobs/run-next?${qs}`, { method: "POST" })).then((r: Response) => r.text());

  // ── Extraction (automatic, durable) ──────────────────────────────────────
  for (let i = 0; i < 12; i++) {
    await wake(`jobType=EXTRACT_TEXT&tenderId=${encodeURIComponent(tenderId)}`);
    const files = await prisma.tenderFile.findMany({ where: { tenderId }, select: { extractedText: true } });
    if (files.length > 0 && files.every((f: any) => (f.extractedText?.length ?? 0) > 0)) break;
    assert.ok(i < 11, "durable extraction never produced text for the uploaded tender file");
  }

  // ── MANUAL click 1: AI Analyze ───────────────────────────────────────────
  const manualAnalyze = require("../app/api/tenders/[id]/manual-ai-analyze/route");
  const queued = await manualAnalyze.POST(new Request(`http://localhost/api/tenders/${tenderId}/manual-ai-analyze`, { method: "POST" }), { params: Promise.resolve({ id: tenderId }) });
  const queuedBody = await queued.text();
  assert.equal(queued.status, 202, `manual AI Analyze was not accepted: ${queued.status} ${queuedBody}`);
  const analyzeJobId = JSON.parse(queuedBody).jobId;

  let analyzeStatus = "";
  for (let i = 0; i < 20; i++) {
    await wake(`jobType=AI_ANALYZE&tenderId=${encodeURIComponent(tenderId)}`);
    const job = await prisma.aiJob.findUnique({ where: { id: analyzeJobId }, select: { status: true, errorMessage: true } });
    analyzeStatus = job?.status ?? "GONE";
    if (["SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELED"].includes(analyzeStatus)) {
      assert.equal(analyzeStatus, "SUCCEEDED", `AI Analyze ended ${analyzeStatus}: ${job?.errorMessage}`);
      break;
    }
    assert.ok(i < 19, `AI Analyze never reached a terminal state (last: ${analyzeStatus})`);
  }

  // ── MANUAL click 2: Run Engine ───────────────────────────────────────────
  const engineRoute = require("../app/api/tenders/[id]/engine/route");
  const engine = await engineRoute.POST(new Request(`http://localhost/api/tenders/${tenderId}/engine`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manualRequested: true }),
  }), { params: Promise.resolve({ id: tenderId }) });
  assert.ok(engine.status < 400, `Run Engine failed: ${engine.status} ${await engine.text()}`);
  for (let round = 0; round < 40; round++) {
    await wake("take=1");
    if (await prisma.aiJob.count({ where: { tenderId, status: { in: ["QUEUED", "RUNNING"] } } }) === 0) break;
  }

  // ── Everything below here must be AUTOMATIC ──────────────────────────────
  const planRoute = require("../app/api/tenders/[id]/build-plan/route");
  const plan = await planRoute.POST(new Request(`http://localhost/api/tenders/${tenderId}/build-plan`, { method: "POST" }), { params: Promise.resolve({ id: tenderId }) });
  const planBody = await plan.text();
  assert.ok(plan.status < 400, `Build Plan failed: ${plan.status} ${planBody}`);
  planItemCount = (JSON.parse(planBody).items ?? []).length;

  const confirmRoute = require("../app/api/tenders/[id]/build-plan/confirm/route");
  const confirmed = await confirmRoute.POST(new Request(`http://localhost/api/tenders/${tenderId}/build-plan/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), { params: Promise.resolve({ id: tenderId }) });
  assert.ok(confirmed.status < 400, `Build Plan confirm failed: ${confirmed.status} ${await confirmed.text()}`);

  const generateRoute = require("../app/api/tenders/[id]/generate/route");
  const generated = await generateRoute.POST(new Request(`http://localhost/api/tenders/${tenderId}/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), { params: Promise.resolve({ id: tenderId }) });
  assert.ok(generated.status < 400, `Generate failed: ${generated.status} ${await generated.text()}`);
  for (let round = 0; round < 40; round++) {
    await wake("take=1");
    if (await prisma.aiJob.count({ where: { tenderId, status: { in: ["QUEUED", "RUNNING"] } } }) === 0) break;
  }

  // NOTE: POST /generate-missing-plan-files is deliberately NOT called. It is a
  // manual recovery click, and the owner automation contract forbids requiring
  // one on the normal path. If the confirmed plan's second file only appears
  // after that call, this test must fail.
  generatedDocNames = (await prisma.generatedDocument.findMany({
    where: { tenderId, generationStatus: { not: "SUPERSEDED" } }, select: { exactFileName: true, name: true },
  })).map((d: any) => (d.exactFileName ?? d.name ?? "").trim()).filter(Boolean);

  // AUTO_FINALIZE: validation, PDF finalization, package reconciliation. A
  // durable, retried job in production, so give it the same retries here.
  const { runAutoFinalizeAfterGeneration } = require("../lib/ai-jobs/auto-finalize-continuation-service");
  const finalizeJob = await prisma.aiJob.findFirst({ where: { tenderId, jobType: "AUTO_FINALIZE" }, select: { id: true } });
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await runAutoFinalizeAfterGeneration(tenderId, userId, finalizeJob?.id ?? "pipeline-zip-test");
    if (result.ok === true) break;
    assert.ok(attempt < 2, `AUTO_FINALIZE never converged: ${JSON.stringify(result.blockers)}`);
  }

  // ── The archive ──────────────────────────────────────────────────────────
  const downloadRoute = require("../app/api/tenders/[id]/download/route");
  let response = await downloadRoute.GET(new Request(`http://localhost/api/tenders/${tenderId}/download?type=zip`), { params: Promise.resolve({ id: tenderId }) });
  if (response.status === 409 && (await response.clone().text()).includes("SEPARATE_ENVELOPE_REQUIRED")) {
    // Correct behaviour on a two-envelope tender: one mixed ZIP is refused and
    // the per-envelope requests are named. Follow the app's own instruction.
    response = await downloadRoute.GET(new Request(`http://localhost/api/tenders/${tenderId}/download?type=zip&envelope=technical`), { params: Promise.resolve({ id: tenderId }) });
  }
  // Read the body for the failure message only on failure: an assertion
  // message argument is evaluated eagerly, and consuming it here would leave
  // nothing for arrayBuffer() below.
  if (response.status !== 200) {
    assert.fail(`final ZIP was not produced: HTTP ${response.status} ${(await response.text()).slice(0, 1500)}`);
  }
  assert.equal(response.headers.get("content-type"), "application/zip", "the download route returned 200 but not an archive");

  zipBytes = Buffer.from(await response.arrayBuffer());
  const loaded = await JSZip.loadAsync(zipBytes);
  for (const name of Object.keys(loaded.files)) {
    if (loaded.files[name].dir) continue;
    const buffer = await loaded.file(name)!.async("nodebuffer");
    zipEntries.push({ name, size: buffer.length, text: await docxVisibleText(buffer) });
  }
});

after(async () => {
  if (!RUN_DB) return;
  try { if (tenderId) await prisma?.tender?.delete({ where: { id: tenderId } }); } catch { /* best effort */ }
  try { if (userId) await prisma?.user?.delete({ where: { id: userId } }); } catch { /* best effort */ }
  await prisma?.$disconnect?.().catch(() => {});
  await new Promise<void>((resolve) => { modelServer ? modelServer.close(() => resolve()) : resolve(); });
});

dbDescribe("the pipeline produces a real, downloadable ZIP", () => {
  it("reached the provider through the app's own client", () => {
    assert.ok(modelCalls > 0, "no provider call was made — the pipeline never actually ran AI Analyze");
  });

  it("produced an archive with bytes in it", () => {
    assert.ok(zipBytes && zipBytes.length > 0, "no ZIP was produced");
    // PK\x03\x04 — a real archive container, not a JSON error body.
    assert.equal(zipBytes![0], 0x50);
    assert.equal(zipBytes![1], 0x4b);
  });

  it("generated every file the confirmed plan requires, with no manual recovery click", () => {
    assert.equal(planItemCount, PLAN_FILES.length, `the confirmed plan should carry ${PLAN_FILES.length} files, got ${planItemCount}`);
    for (const planFile of PLAN_FILES) {
      assert.ok(
        generatedDocNames.some((n) => n.toLowerCase() === planFile.toLowerCase()),
        `the confirmed plan required "${planFile}" but generation produced no document row for it (rows: ${generatedDocNames.join(", ") || "none"}). ` +
        "This is the defect where a planned file is only created by the manual generate-missing-plan-files click.",
      );
    }
  });

  it("packages the confirmed plan's technical-envelope files", () => {
    assert.deepEqual(
      zipEntries.map((e) => e.name).sort(),
      [...PLAN_FILES].sort(),
      "the archive's entries do not match the confirmed plan",
    );
  });

  it("every entry is a real DOCX carrying real content, not a stub", () => {
    for (const entry of zipEntries) {
      assert.ok(entry.size > 4_000, `${entry.name} is ${entry.size} bytes — too small to be a real document`);
      assert.ok(entry.text.length > 500, `${entry.name} has only ${entry.text.length} characters of visible text`);
      assert.match(entry.text, /\S/, `${entry.name} has no visible text`);
    }
  });

  it("ships no placeholder, stub, or internal note to the client", () => {
    const forbidden = [
      /to be confirmed/i, /bid[-\s]?team/i, /\bTBD\b/i, /lorem ipsum/i,
      /MISSING_SOURCE/i, /PLACEHOLDER FOR TENDER-ISSUED/i, /attach the tender-issued/i,
      /\[insert/i, /\bas an AI\b/i,
    ];
    for (const entry of zipEntries) {
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(entry.text), `${entry.name} ships forbidden content matching ${pattern}`);
      }
    }
  });

  it("writes the tender's own facts into the proposal", () => {
    const proposal = zipEntries.find((e) => /technical-proposal/i.test(e.name));
    assert.ok(proposal, "the technical proposal is missing from the archive");
    assert.match(proposal!.text, /MWE\/RFP\/2026\/0114/, "the proposal does not carry the tender reference");
    assert.match(proposal!.text, /Ministry of Water and Energy/i, "the proposal does not name the procuring entity");
  });
});
