// Real-bytes final-ZIP acceptance test.
//
// WHY THIS FILE EXISTS
// --------------------
// The suite around it could not tell a working product from a broken one. Of
// 560 test files, none produced an archive. The "golden tender" acceptance
// suite declares tender fixtures and then asserts that its OWN string literals
// are non-empty; a large share of the pipeline cases are readFileSync +
// `src.includes("SOME_CONSTANT")` greps over source files, which pass for as
// long as an identifier is still spelled the same way. The e2e specs that touch
// the pipeline are gated behind env flags unset in a normal run, and
// tests/zip-finalization.test.ts — the one file named after this exact step —
// asserts that the ZIP is REFUSED, and calls that correct.
//
// So every gate below could be, and was, broken at once while the suite stayed
// green: plan items and generated documents were matched on a key the two sides
// computed differently, the authority review derived its required sections from
// the tender title instead of the manifest, export readiness skipped byte
// checks the download route depended on, final-submission readiness judged byte
// integrity from columns it never selected, and the main-proposal slot matcher
// did not recognise an Expression of Interest, so the one document the tender
// actually required was planned and never generated.
//
// This test asserts the only thing that cannot be faked: that a real archive
// comes out of the real route, with real entries, holding real bytes. It fails
// when no ZIP is produced. It calls GET /api/tenders/[id]/download?type=zip —
// the handler the browser calls — against a real PostgreSQL database, with no
// mock prisma, because a mock prisma cannot satisfy the release gate and a test
// built on one can only ever assert that the gate said no.
//
// Run: RUN_DB_INTEGRATION=true DATABASE_URL=postgresql://... npm test

import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, createHash, randomUUID } from "node:crypto";
import JSZip from "jszip";
import { Document, HeadingLevel, Packer, Paragraph } from "docx";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const dbDescribe = RUN_DB ? describe : describe.skip;
const SESSION_COOKIE = "hope_session";
let __TEST_COOKIE_STORE: Record<string, string> = {};

if (RUN_DB) {
  const nextHeadersMock = {
    cookies: async () => ({
      get: (name: string) => __TEST_COOKIE_STORE[name] ? { name, value: __TEST_COOKIE_STORE[name] } : undefined,
      set: (name: string, value: string) => { __TEST_COOKIE_STORE[name] = value; },
      delete: (name: string) => { delete __TEST_COOKIE_STORE[name]; },
      getAll: () => Object.entries(__TEST_COOKIE_STORE).map(([name, value]) => ({ name, value })),
    }),
  };
  const Module = require("module");
  const originalResolve = (Module as any)._resolveFilename;
  (Module as any)._resolveFilename = function (request: string, ...args: any[]) {
    if (request === "next/headers") return (require.resolve as any).__final_zip_next_headers_mock_path || "";
    return originalResolve.call(this, request, ...args);
  };
  const mockModulePath = "__final_zip_next_headers_mock__";
  require.cache[mockModulePath] = { id: mockModulePath, filename: mockModulePath, loaded: true, exports: nextHeadersMock, paths: [], children: [], parent: null } as any;
  (require.resolve as any).__final_zip_next_headers_mock_path = mockModulePath;
}

function secret(): string {
  return process.env.SESSION_SECRET || process.env.AUTH_SECRET || "test-session-secret-at-least-32-characters-long";
}

async function setAuthCookie(prisma: any, userId: string) {
  const expiresAt = new Date(Date.now() + 14 * 86400 * 1000);
  const payload = { userId, exp: Math.floor(expiresAt.getTime() / 1000), nonce: randomBytes(16).toString("base64url") };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const token = `${encoded}.${createHmac("sha256", secret()).update(encoded).digest("base64url")}`;
  await prisma.session.create({ data: { token: createHash("sha256").update(token).digest("hex"), userId, expiresAt } });
  __TEST_COOKIE_STORE[SESSION_COOKIE] = token;
}

const PLAN_FILES = [
  { exactFileName: "01-Technical-Proposal.docx", documentType: "TECHNICAL_PROPOSAL", exactOrder: 1 },
  { exactFileName: "02-Company-Profile.docx", documentType: "COMPANY_PROFILE", exactOrder: 2 },
];

const SOURCE_TEXT = `[Page 1]
Ministry of Water and Energy
Reference: ZIPTEST/RFP/2026/0001
Procuring Entity: Ministry of Water and Energy
Submission Deadline: 30 November 2026 at 14:00 local time.
Submission Method: Email
Submission Email: procurement@example.test

[Page 2]
SECTION II - SUBMISSION INSTRUCTIONS
Files must be named and ordered exactly as follows:
1. 01-Technical-Proposal.docx
2. 02-Company-Profile.docx

[Page 3]
SECTION III - MANDATORY ELIGIBILITY REQUIREMENTS
The Consultant shall submit a company profile describing its organisation,
staffing and relevant experience.
The Consultant shall present a technical approach and methodology for the
scope of services.
`;

const VAULT_EXPERT = { fullName: "Selamawit Bekele", title: "Team Leader / Water Resources Engineer", yearsExperience: 18 };
const VAULT_PROJECT = { name: "Rural Water Supply Scheme Detailed Design", clientName: "Oromia Water Works Enterprise", country: "Ethiopia", sector: "Water Supply" };

// The provenance ladder verifies each record field against this text, so every
// value seeded through the create routes below appears here verbatim.
const VAULT_PROFILE_TEXT = `Hope Urban Planning Architectural and Engineering Consultancy is a multidisciplinary
consulting firm registered in Addis Ababa, providing water supply, sanitation,
urban planning and architectural engineering services to public and donor-funded
clients. The firm maintains a permanent staff of civil, water resources and
environmental engineers and has delivered feasibility studies, detailed designs
and construction supervision assignments for rural water supply schemes.

KEY PERSONNEL
${VAULT_EXPERT.fullName} - ${VAULT_EXPERT.title}, ${VAULT_EXPERT.yearsExperience} years of professional experience
in water supply engineering, hydraulic design and construction supervision.

SELECTED PROJECT REFERENCE
${VAULT_PROJECT.name}
Client: ${VAULT_PROJECT.clientName}
Country: ${VAULT_PROJECT.country}
Sector: ${VAULT_PROJECT.sector}
`;

// Real narrative bodies. The quality gate refuses documents that are short,
// placeholder-filled, or missing the sections a proposal of this kind must
// contain - correctly, so the fixture carries genuine content rather than a
// heading and a sentence.
const TECHNICAL_PROPOSAL_BODY: Array<[string, string]> = [
  ["Executive Summary", "Hope Urban Planning Architectural and Engineering Consultancy submits this technical proposal for consultancy services for rural water supply schemes. The assignment covers hydrological assessment, source selection, detailed engineering design, preparation of tender documents and construction supervision for community water supply systems serving dispersed rural settlements. Our proposal responds directly to the terms of reference and sets out the technical approach, staffing, work plan, deliverables, quality assurance arrangements and risk controls we will apply. The firm has completed comparable assignments for regional water bureaux and donor-funded programmes, and brings a permanent multidisciplinary team of civil, water resources and environmental engineers supported by surveyors, hydrogeologists and CAD technicians. We propose a phased delivery model that front-loads field data collection, resolves source viability early, and holds design decisions open until the hydrogeological evidence supports them."],
  ["Understanding of the Assignment", "Our understanding is that the client requires a technically defensible water supply solution for communities currently dependent on unprotected sources, with an emphasis on year-round yield, affordability of operation and community ownership. The critical constraints are seasonal variability of groundwater levels, distance between source and demand centres, limited grid electricity in the target woredas, and the need for designs that local artisans can maintain. We read the terms of reference as requiring not only a design output but a documented basis of design that the client can defend during appraisal. Accordingly our methodology treats source verification, demand projection and level-of-service selection as decisions requiring recorded justification rather than assumptions carried forward from earlier studies."],
  ["Scope of Services", "The scope comprises four components. First, inception and desk review, including collation of existing hydrogeological records, previous borehole logs, population statistics and any prior feasibility work. Second, field investigation covering topographic survey of pipeline corridors and reservoir sites, water quality sampling, pump testing of existing boreholes, and socio-economic assessment of willingness and ability to pay. Third, detailed engineering design of the abstraction works, transmission mains, storage reservoirs, distribution network and public water points, together with structural design of civil works and specification of electromechanical equipment. Fourth, preparation of tender documents, bills of quantities and engineer's estimate, followed by construction supervision services during implementation."],
  ["Technical Approach and Methodology", "The methodology proceeds from evidence to design rather than from design to justification. Source assessment begins with constant-rate pump testing and recovery analysis to establish sustainable yield at the end of the dry season, not at the time of test. Demand is projected using the client's design horizon and service-level standard, disaggregated by domestic, institutional and livestock demand. Hydraulic design is carried out in a calibrated network model, with pressure and residual head checked at the least favourable node under peak-hour demand and under fire-flow conditions where the standard requires it. Structural elements are designed to the governing national code, with foundation design tied to the geotechnical findings for each specific site rather than to a generic bearing assumption. Every design decision is recorded in a basis-of-design register that cites the field data supporting it, so that the client's reviewers can trace any dimension back to its evidence."],
  ["Work Plan and Schedule", "The work plan is organised into four phases across the contract duration. Phase one, inception, runs for four weeks and closes with an inception report setting out the confirmed methodology, the survey programme and the data gaps identified. Phase two, field investigation and survey, runs for ten weeks with parallel teams so that topographic survey and hydrogeological testing proceed concurrently. Phase three, detailed design, runs for twelve weeks and includes a draft design review workshop with the client at the midpoint. Phase four, tender documentation, runs for six weeks. Each phase has a defined start condition, so that design does not begin before the source yield is confirmed and tender documents are not prepared against an unapproved design."],
  ["Team Composition and Staffing", "The team is led by a Team Leader and Water Resources Engineer with eighteen years of professional experience in water supply engineering, hydraulic design and construction supervision, who holds overall technical responsibility and is the client's single point of contact. The team leader is supported by a senior hydrogeologist responsible for source assessment and pump test interpretation, a civil and structural engineer responsible for reservoirs and civil works, an electromechanical engineer responsible for pumping plant and controls, a surveyor responsible for topographic and corridor survey, and an environmental and social specialist responsible for safeguards screening and community consultation. Roles and responsibilities are fixed at contract award and named staff are not substituted without the client's written agreement."],
  ["Deliverables", "Deliverables comprise the inception report, the field investigation and survey report including all raw pump test and water quality data, the draft detailed design report with drawings and hydraulic model, the final detailed design report incorporating client comments, the tender documents with technical specifications and bills of quantities, the engineer's cost estimate, and periodic supervision reports during construction. All deliverables are submitted in editable and portable formats, and design drawings are issued with a revision register so that superseded sheets cannot be used in error on site."],
  ["Quality Assurance and QA/QC Arrangements", "Quality assurance is applied through independent checking by a second engineer before any deliverable is issued. Every calculation set is checked by an engineer who did not prepare it, and the check is recorded against a checklist covering input data provenance, code compliance, unit consistency and boundary conditions. Drawings are subject to a separate drafting check for coordination between disciplines. Field data are verified against the original field sheets before entering the design. Review responsibility and frequency are defined for each deliverable class, and no document leaves the office without a signed check record. Nonconformities identified during review are logged, closed out and re-verified rather than corrected silently."],
  ["Risk Management", "The principal risks to the assignment are lower than expected borehole yield, access difficulty during the rainy season, delay in obtaining land access for reservoir sites, and price volatility affecting the engineer's estimate. For each risk we record likelihood, impact, the mitigation measure and the owner responsible. Yield risk is mitigated by testing before design commitment and by carrying an alternative source option through the first phase. Access risk is mitigated by scheduling field work outside the peak rainy months. Land access risk is mitigated by initiating the client's consultation process during inception rather than at design stage. Cost risk is mitigated by pricing the estimate at a stated base date and stating the escalation basis explicitly."],
];

const COMPANY_PROFILE_BODY: Array<[string, string]> = [
  ["Organisation", "Hope Urban Planning Architectural and Engineering Consultancy is a multidisciplinary consulting firm registered in Addis Ababa, providing water supply, sanitation, urban planning and architectural engineering services to public sector and donor-funded clients. The firm operates from a permanent office with in-house survey, design and drafting capability, and maintains its own vehicles and field testing equipment so that investigation programmes are not dependent on subcontracted mobilisation."],
  ["Services", "The firm provides feasibility studies, hydrogeological and hydrological assessment, detailed engineering design, preparation of tender documents, procurement support and construction supervision. Complementary services include topographic and cadastral survey, environmental and social safeguards screening, and institutional support for the operation and maintenance arrangements that follow commissioning."],
  ["Staffing", "The permanent staff comprises civil, water resources, structural, electromechanical and environmental engineers, supported by surveyors, hydrogeologists, CAD technicians and administrative personnel. Senior staff hold professional registration and the firm maintains continuing development records for its technical staff. Team leaders for individual assignments are drawn from the permanent establishment rather than assembled from associates at bid stage."],
  ["Experience", "The firm has delivered feasibility studies, detailed designs and construction supervision assignments for rural water supply schemes, including source assessment, transmission and distribution design, reservoir and public water point design, and supervision through to commissioning. Assignments have been carried out for regional water works enterprises and for programmes financed by development partners, under both national and international procurement rules."],
];

const DOCUMENT_BODIES: Record<string, Array<[string, string]>> = {
  "01-Technical-Proposal.docx": TECHNICAL_PROPOSAL_BODY,
  "02-Company-Profile.docx": COMPANY_PROFILE_BODY,
};

/**
 * A real, openable DOCX carrying real narrative content.
 *
 * The export format policy validates the file signature, and the document
 * quality gate reads the visible text: a two-line stub is refused for being
 * too short and for missing the sections a proposal of this kind must carry.
 * Both refusals are correct, so the fixture supplies genuine prose rather than
 * loosening the gate to accept a placeholder.
 */
async function realDocxBase64(exactFileName: string): Promise<string> {
  const body = DOCUMENT_BODIES[exactFileName];
  assert.ok(body, `no fixture body defined for ${exactFileName}`);
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: exactFileName.replace(/^\d+-|\.docx$/gi, "").replace(/-/g, " "), heading: HeadingLevel.HEADING_1 }),
        ...body.flatMap(([heading, text]) => [
          new Paragraph({ text: heading, heading: HeadingLevel.HEADING_2 }),
          new Paragraph(text),
        ]),
      ],
    }],
  });
  return (await Packer.toBuffer(doc)).toString("base64");
}

let prisma: any;
let downloadRoute: any;
let userId = "";
let tenderId = "";

before(async () => {
  if (!RUN_DB) return;
  const prismaModule = require("../lib/prisma");
  prisma = prismaModule.prisma;
  await prismaModule.prismaReady;
  downloadRoute = require("../app/api/tenders/[id]/download/route");

  const { computePersistedTenderAnalysisHash } = require("../lib/engine/tender-analysis-content");
  const { computeTenderBuildPlanHash } = require("../lib/engine/build-plan");
  const { buildSubmissionPlan, plannedSubmissionTargetFiles } = require("../lib/engine/submission-plan");
  const { verifiedIntegrityDataFromBase64 } = require("../lib/engine/persisted-byte-integrity");

  const user = await prisma.user.create({
    data: {
      name: "Final ZIP Bytes",
      email: `final-zip-bytes+${Date.now()}@example.test`,
      passwordHash: "not-used-by-this-test",
      role: "ADMIN",
      company: { create: { name: "Hope Urban Planning Architectural and Engineering Consultancy" } },
    },
    include: { company: true },
  });
  userId = user.id;

  // A real Company Vault source. The download route runs company ingestion
  // readiness before it packages anything, so a tender fixture alone cannot
  // reach the archive - and must not, because the proposal has to be written
  // from vault evidence rather than from nothing. Byte integrity is recorded
  // because the vault record is only usable when its persisted bytes verify.
  const vaultContent = Buffer.from(VAULT_PROFILE_TEXT, "utf8").toString("base64");
  const vaultDocument = await prisma.companyDocument.create({
    data: {
      companyId: user.company!.id,
      fileName: "company-profile.txt",
      originalFileName: "company-profile.txt",
      mimeType: "text/plain",
      size: VAULT_PROFILE_TEXT.length,
      fileContent: vaultContent,
      ...verifiedIntegrityDataFromBase64({ fileContent: vaultContent, filename: "company-profile.txt", claimedMimeType: "text/plain" }),
      category: "COMPANY_PROFILE",
      extractedText: VAULT_PROFILE_TEXT,
      aiExtractionStatus: "EXTRACTED",
      aiExtractedAt: new Date(),
    },
  });

  // Expert and project records are created through the app's own POST routes
  // rather than written straight to the table. Generation readiness requires
  // "verified, source-backed" experts and projects, and that state is EARNED
  // from the source document by the provenance ladder - a fixture that writes
  // trustLevel: "REVIEWED" directly proves nothing, which is exactly the bug
  // that let the vault list records as reviewed while generation reported none
  // were available.
  await setAuthCookie(prisma, userId);
  const expertsRoute = require("../app/api/company/experts/route");
  const projectsRoute = require("../app/api/company/projects/route");

  const expertResponse = await expertsRoute.POST(new Request("http://localhost/api/company/experts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...VAULT_EXPERT, sourceDocumentId: vaultDocument.id }),
  }));
  assert.ok(expertResponse.status < 300, `expert create failed: ${expertResponse.status} ${await expertResponse.text()}`);

  const projectResponse = await projectsRoute.POST(new Request("http://localhost/api/company/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...VAULT_PROJECT, sourceDocumentId: vaultDocument.id }),
  }));
  assert.ok(projectResponse.status < 300, `project create failed: ${projectResponse.status} ${await projectResponse.text()}`);

  // Assert the RUNTIME predicate, not the stored label. The defect this guards
  // was a create route writing trustLevel: "REVIEWED" with a free-text note:
  // the label said reviewed, canUseVaultRecordSafely said no, and generation
  // reported "No verified, source-backed experts are available" for records the
  // vault listed as reviewed. Checking the label alone would pass on the broken
  // code, so the check has to be the one the gate itself makes.
  const { canUseVaultRecordSafely } = require("../lib/vault-runtime-authority");
  const { VAULT_REVIEW_CONSUMER_SELECT } = require("../lib/vault-review-provenance");
  for (const [label, model, select] of [
    ["expert", prisma.expert, VAULT_REVIEW_CONSUMER_SELECT.EXPERT],
    ["project", prisma.project, VAULT_REVIEW_CONSUMER_SELECT.PROJECT],
  ] as const) {
    const record = await model.findFirstOrThrow({ where: { companyId: user.company!.id }, select });
    assert.ok(
      canUseVaultRecordSafely(record, "GENERATION"),
      `the ${label} create route produced a record the generation gate rejects (stored trustLevel=${record.trustLevel})`,
    );
  }

  const tender = await prisma.tender.create({
    data: {
      userId,
      title: "Consultancy Services for Rural Water Supply Schemes",
      reference: "ZIPTEST/RFP/2026/0001",
      clientName: "Ministry of Water and Energy",
      procuringEntityName: "Ministry of Water and Energy",
      deadline: new Date("2026-11-30T14:00:00.000Z"),
      submissionMethod: "Email",
      submissionEmails: "procurement@example.test",
      exactFileNaming: JSON.stringify(PLAN_FILES.map((f) => f.exactFileName)),
      exactFileOrder: JSON.stringify(PLAN_FILES.map((f) => f.exactFileName)),
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      // The post-engine state. Export readiness refuses a tender still sitting
      // at DRAFT/TENDER_INTAKE with zero workflow progress, which is right:
      // a package cannot be final before the engine has run.
      status: "PROPOSAL_READY",
      stage: "FINAL_REVIEW",
      readinessScore: 90,
    },
  });
  tenderId = tender.id;

  const file = await prisma.tenderFile.create({
    data: {
      tenderId,
      originalFileName: "ZIPTEST-RFP-2026-0001.txt",
      fileName: "ZIPTEST-RFP-2026-0001.txt",
      mimeType: "text/plain",
      size: SOURCE_TEXT.length,
      extractedText: SOURCE_TEXT,
      extractionScore: 100,
      totalPages: 3,
      extractedPages: 3,
      deletionStatus: "ACTIVE",
    },
  });

  // Source evidence for the critical fields, grounded in the file above.
  await prisma.tender.update({
    where: { id: tenderId },
    data: {
      titleSourceFileId: file.id, titleSourcePage: 1, titleSourceQuote: "Reference: ZIPTEST/RFP/2026/0001",
      referenceSourceFileId: file.id, referenceSourcePage: 1, referenceSourceQuote: "Reference: ZIPTEST/RFP/2026/0001",
      clientNameSourceFileId: file.id, clientNameSourcePage: 1, clientNameSourceQuote: "Procuring Entity: Ministry of Water and Energy",
      deadlineSourceFileId: file.id, deadlineSourcePage: 1, deadlineSourceQuote: "Submission Deadline: 30 November 2026 at 14:00 local time.",
      submissionMethodSourceFileId: file.id, submissionMethodSourcePage: 1, submissionMethodSourceQuote: "Submission Method: Email",
      submissionEmailSourceFileId: file.id, submissionEmailSourcePage: 1, submissionEmailSourceQuote: "Submission Email: procurement@example.test",
    },
  });

  // Mandatory requirements, each with a VERBATIM quote from the source file.
  const requirementSeeds = [
    {
      title: "Company profile",
      quote: "The Consultant shall submit a company profile describing its organisation,\nstaffing and relevant experience.",
      exactFileName: "02-Company-Profile.docx",
      exactOrder: 2,
    },
    {
      title: "Technical approach and methodology",
      quote: "The Consultant shall present a technical approach and methodology for the\nscope of services.",
      exactFileName: "01-Technical-Proposal.docx",
      exactOrder: 1,
    },
  ];
  for (const seed of requirementSeeds) {
    assert.ok(SOURCE_TEXT.includes(seed.quote), `test fixture is wrong: quote for "${seed.title}" is not verbatim in the source text`);
    await prisma.tenderRequirement.create({
      data: {
        tenderId,
        title: seed.title,
        description: seed.title,
        requirementType: "TECHNICAL",
        priority: "MANDATORY",
        exactFileName: seed.exactFileName,
        exactOrder: seed.exactOrder,
        sourceTenderFileId: file.id,
        sourcePageNumber: 3,
        sourceExactQuote: seed.quote,
        sourceConfidence: 0.9,
      },
    });
  }

  // The requirement-linked evidence rows Run Engine writes. Export readiness
  // refuses an empty compliance/evidence matrix, so a fixture without these is
  // asserting on a tender the engine never processed.
  for (const requirement of await prisma.tenderRequirement.findMany({ where: { tenderId }, select: { id: true, exactFileName: true, title: true } })) {
    await prisma.complianceMatrix.create({
      data: {
        tenderId,
        requirementId: requirement.id,
        evidenceType: "GENERATED_DOCUMENT",
        evidenceSource: "AUTO_PLANNED_ARTIFACT",
        evidenceReference: requirement.exactFileName,
        supportLevel: "FULL",
        notes: `Addressed by ${requirement.exactFileName}.`,
      },
    });
  }

  // A SUCCEEDED analysis bound to the CURRENT content hash, computed with the
  // shared helper so that if the hash inputs ever drift again this test fails
  // here rather than silently exercising a stale-analysis path.
  const contentHash = await computePersistedTenderAnalysisHash(prisma, tenderId, userId);
  assert.ok(contentHash, "computePersistedTenderAnalysisHash returned null - the tender fixture is not readable by the app's own hash builder");

  const job = await prisma.aiJob.create({
    data: {
      tenderId, userId, jobType: "AI_ANALYZE", status: "SUCCEEDED",
      analysisInputHash: contentHash,
      startedAt: new Date(), finishedAt: new Date(), promotedAt: new Date(),
    },
  });
  await prisma.aiAnalyzeChunk.create({
    data: { tenderId, userId, contentHash, chunkIndex: 0, totalChunks: 1, status: "SUCCEEDED", provider: "test", jobId: job.id },
  });

  // Documents: real DOCX bytes, validated, approved, with integrity recorded.
  for (const planFile of PLAN_FILES) {
    const fileContent = await realDocxBase64(planFile.exactFileName);
    await prisma.generatedDocument.create({
      data: {
        tenderId,
        name: planFile.exactFileName.replace(/\.docx$/i, ""),
        documentType: planFile.documentType,
        format: "DOCX",
        exactFileName: planFile.exactFileName,
        exactOrder: planFile.exactOrder,
        fileContent,
        ...verifiedIntegrityDataFromBase64({
          fileContent,
          filename: planFile.exactFileName,
          claimedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
        generationStatus: "GENERATED",
        // "PASSED" on purpose: it is what POST /validate writes on success, and
        // gates that hardcoded ["VALIDATED","APPROVED","READY_FOR_EXPORT"]
        // silently treated a validated document as unvalidated.
        validationStatus: "PASSED",
        reviewStatus: "APPROVED",
      },
    });
  }

  // A CONFIRMED build plan bound to the live plan hash.
  //
  // Items are derived from the app's OWN submission plan rather than hand
  // written: the runtime validator compares each confirmed item against
  // plannedSubmissionTargetFiles(buildSubmissionPlan(tender)) and rejects
  // anything outside that scope, so a hand-rolled documentType silently fails
  // the gate. Building from the same source is also what the Build Plan route
  // does, which keeps this fixture honest.
  const tenderForPlan = await prisma.tender.findUniqueOrThrow({
    where: { id: tenderId },
    include: { files: true, requirements: true },
  });
  const items = plannedSubmissionTargetFiles(buildSubmissionPlan(tenderForPlan));
  assert.ok(items.length > 0, "the tender produced no required submission files - fixture is wrong");
  assert.deepEqual(
    items.map((item: any) => item.exactFileName).sort(),
    PLAN_FILES.map((f) => f.exactFileName).sort(),
    "the submission plan does not name the files this test expects",
  );

  const planHash = await computeTenderBuildPlanHash(prisma, tenderId, userId, items);
  assert.ok(planHash, "computeTenderBuildPlanHash returned no hash - the plan cannot be confirmed");
  await prisma.buildPlan.create({
    data: {
      id: randomUUID(),
      tenderId,
      status: "CONFIRMED",
      revision: 1,
      confirmedRevision: 1,
      contentHash: planHash,
      confirmedContentHash: planHash,
      itemsJson: JSON.stringify(items),
      confirmedAt: new Date(),
    },
  });

  await setAuthCookie(prisma, userId);
});

after(async () => {
  if (!RUN_DB || !prisma) return;
  if (tenderId) await prisma.tender.deleteMany({ where: { id: tenderId } }).catch(() => {});
  if (userId) await prisma.session.deleteMany({ where: { userId } }).catch(() => {});
  if (userId) await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
});

async function downloadZip() {
  await setAuthCookie(prisma, userId);
  return downloadRoute.GET(
    new Request(`http://localhost/api/tenders/${tenderId}/download?type=zip`),
    { params: Promise.resolve({ id: tenderId }) },
  );
}

dbDescribe("final ZIP - real bytes from the real download route", () => {
  it("produces a downloadable archive whose entries match the confirmed plan", async () => {
    const response = await downloadZip();

    // The failure that matters. A blocked release is reported with the gate's
    // own code so the next person sees WHICH gate refused, not just "no ZIP".
    if (response.status !== 200) {
      const body = await response.text();
      assert.fail(`NO ZIP PRODUCED - GET download?type=zip returned ${response.status}: ${body.slice(0, 1200)}`);
    }
    assert.equal(response.headers.get("content-type"), "application/zip", "the route returned 200 but not an archive");

    const buffer = Buffer.from(await response.arrayBuffer());
    assert.ok(buffer.length > 0, "NO ZIP PRODUCED - the route returned 200 but no bytes came back");
    assert.equal(buffer.subarray(0, 2).toString("latin1"), "PK", "the returned bytes are not a ZIP archive (missing PK signature)");

    // Reopen the archive: entries must be the confirmed plan's files, each
    // carrying real, openable bytes.
    const reopened = await JSZip.loadAsync(buffer);
    const entryNames = Object.keys(reopened.files).filter((name) => !reopened.files[name].dir);
    assert.deepEqual(
      entryNames.sort(),
      PLAN_FILES.map((f) => f.exactFileName).sort(),
      "ZIP entries do not match the confirmed build plan's required files",
    );

    for (const name of entryNames) {
      const bytes = await reopened.file(name)!.async("nodebuffer");
      assert.ok(bytes.length > 0, `${name} is present in the ZIP but empty`);
      assert.equal(bytes.subarray(0, 2).toString("latin1"), "PK", `${name} is not a valid DOCX (Office packages are ZIPs and must start with PK)`);
      const inner = await JSZip.loadAsync(bytes);
      assert.ok(inner.file("word/document.xml"), `${name} has no word/document.xml - it is not an openable Word document`);
    }
  });

  it("refuses to package a document whose stored bytes fail integrity verification", async () => {
    // Guards the opposite direction: the fixes that made the ZIP possible must
    // not have made it lenient. Corrupting the persisted hash must block.
    const doc = await prisma.generatedDocument.findFirstOrThrow({
      where: { tenderId, exactFileName: PLAN_FILES[0].exactFileName },
      select: { id: true, contentSha256: true },
    });
    await prisma.generatedDocument.update({ where: { id: doc.id }, data: { contentSha256: "0".repeat(64) } });
    try {
      const response = await downloadZip();
      assert.notEqual(response.status, 200, "a document with a mismatched content hash was packaged anyway");
    } finally {
      await prisma.generatedDocument.update({ where: { id: doc.id }, data: { contentSha256: doc.contentSha256 } });
    }
  });
});
