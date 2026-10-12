import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import JSZip from "jszip";
import { prisma } from "../lib/prisma";
import { prepareCompanyVaultForEngine } from "../lib/engine/prepare-company-vault";
import { buildTenderAnalysisContent, computeAnalysisContentHash } from "../lib/engine/tender-analysis-content";
import { enqueueEngineJobForCurrentSources } from "../lib/engine/enqueue-engine-job";
import { claimJobForCaller } from "../lib/job-claim-policy";
import { completeJob } from "../lib/ai-jobs";
import { runTenderEngine } from "../lib/engine/run-tender-engine";
import { buildAndVerifyBuildPlan } from "../lib/engine/automatic-build-plan";
import { generateTenderDocuments } from "../lib/engine/generate-elite";
import { runAutoFinalizeAfterGeneration } from "../lib/ai-jobs/auto-finalize-continuation-service";
import { isFinalExportCandidateDocument } from "../lib/engine/document-output-state";
import { buildFinalZipEntries } from "../lib/engine/final-zip-scope";
import { assembleFinalSubmissionZip } from "../lib/engine/final-zip-assembly";
import { cleanupTender, cleanupUser } from "./helpers/db-acceptance-harness";

test("manual AI Analyze and Run Engine once continue automatically to a real final ZIP", {
  skip: process.env.RUN_DB_INTEGRATION !== "true",
  timeout: 120_000,
}, async () => {
  const nonce = randomUUID();
  const user = await prisma.user.create({ data: { email: `owner-flow-${nonce}@test.local`, passwordHash: "unused", role: "PROPOSAL_MANAGER" } });
  let tenderId: string | null = null;
  try {
    const company = await prisma.company.create({ data: {
      userId: user.id, name: "Source Verified Engineering", legalName: "Source Verified Engineering Ltd",
      country: "ET", address: "1 Evidence Way", email: "bids@example.test", sectors: JSON.stringify(["Water"]),
    } });
    const vaultText = [
      "OWNED COMPANY EXPERIENCE REGISTER", "Expert: Hana Tesfaye", "Title: Senior Water Engineer",
      "Years Experience: 15", "Discipline: Water Engineering", "Sector: Water",
      "Project: Regional Water Supply Design", "Client: Ministry of Water", "Country: Ethiopia",
      "Service Area: Water Supply Design", "This register is the company's retained source evidence.",
    ].join("\n");
    await prisma.companyDocument.create({ data: {
      companyId: company.id, fileName: "owned-register.txt", originalFileName: "owned-register.txt",
      mimeType: "text/plain", size: Buffer.byteLength(vaultText), storagePath: "", extractedText: vaultText,
      contentSha256: createHash("sha256").update(vaultText).digest("hex"), contentByteLength: Buffer.byteLength(vaultText),
      integrityStatus: "VERIFIED", category: "COMPANY_PROFILE",
    } });
    await prisma.expert.create({ data: {
      companyId: company.id, fullName: "Hana Tesfaye", title: "Senior Water Engineer", yearsExperience: 15,
      disciplines: JSON.stringify(["Water Engineering"]), sectors: JSON.stringify(["Water"]), trustLevel: "AI_DRAFT",
    } });
    await prisma.project.create({ data: {
      companyId: company.id, name: "Regional Water Supply Design", clientName: "Ministry of Water", country: "Ethiopia",
      sector: "Water", serviceAreas: JSON.stringify(["Water Supply Design"]), trustLevel: "AI_DRAFT",
    } });
    await prisma.expert.create({ data: { companyId: company.id, fullName: "No Source Expert", trustLevel: "AI_DRAFT" } });

    const tenderText = [
      "[Page 1] REQUEST FOR PROPOSALS RFP-2026-001 — WATER SUPPLY DESIGN for Ministry of Water",
      "The bidder shall submit Technical-Proposal.docx and Technical-Proposal.pdf.",
      "The Senior Water Engineer shall have at least fifteen years of water engineering experience.",
      "The bidder shall demonstrate a regional water supply design project for a public client.",
      "Submission is by email to procurement@example.test before 30 September 2026.",
    ].join("\n");
    const tender = await prisma.tender.create({ data: {
      userId: user.id, title: "Regional Water Supply Design RFP", clientName: "Ministry of Water",
      reference: "RFP-2026-001", deadline: new Date("2026-09-30T12:00:00Z"), submissionMethod: "EMAIL",
      submissionEmails: "procurement@example.test", exactFileNaming: JSON.stringify(["Technical-Proposal.docx", "Technical-Proposal.pdf"]),
      exactFileOrder: JSON.stringify(["Technical-Proposal.docx", "Technical-Proposal.pdf"]),
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED", analysisSummary: "Current promoted AI analysis.", status: "AI_ANALYZED",
    } });
    tenderId = tender.id;
    const source = await prisma.tenderFile.create({ data: {
      tenderId: tender.id, fileName: "rfp.pdf", originalFileName: "rfp.pdf", mimeType: "application/pdf",
      size: Buffer.byteLength(tenderText), extractedText: tenderText, totalPages: 1, extractedPages: 1, failedPages: 0,
      extractionScore: 100, extractionMethod: "text", integrityStatus: "VERIFIED",
      contentSha256: createHash("sha256").update(tenderText).digest("hex"), contentByteLength: Buffer.byteLength(tenderText),
    } });
    await prisma.tender.update({ where: { id: tender.id }, data: {
      clientNameSourceFileId: source.id, clientNameSourcePage: 1, clientNameSourceQuote: "Ministry of Water",
      submissionMethodSourceFileId: source.id, submissionMethodSourcePage: 1, submissionMethodSourceQuote: "Submission is by email",
      submissionEmailSourceFileId: source.id, submissionEmailSourcePage: 1, submissionEmailSourceQuote: "procurement@example.test",
      deadlineSourceFileId: source.id, deadlineSourcePage: 1, deadlineSourceQuote: "30 September 2026",
      titleSourceFileId: source.id, titleSourcePage: 1, titleSourceQuote: "WATER SUPPLY DESIGN",
      referenceSourceFileId: source.id, referenceSourcePage: 1, referenceSourceQuote: "RFP-2026-001",
    } });
    for (const requirement of [
      { title: "Senior Water Engineer", type: "EXPERT", quote: "The Senior Water Engineer shall have at least fifteen years of water engineering experience." },
      { title: "Regional water supply project", type: "PROJECT_EXPERIENCE", quote: "The bidder shall demonstrate a regional water supply design project for a public client." },
    ]) await prisma.tenderRequirement.create({ data: {
      tenderId: tender.id, title: requirement.title, description: requirement.quote, requirementType: requirement.type,
      priority: "MANDATORY", requiredQuantity: 1, sourceTenderFileId: source.id, sourcePageNumber: 1,
      sourceExactQuote: requirement.quote, sourceConfidence: 1,
    } });

    const preflight = await prepareCompanyVaultForEngine(user.id);
    assert.ok(preflight);
    assert.equal(preflight.sourceVerification.expertsVerified, 1);
    assert.equal(preflight.sourceVerification.projectsVerified, 1);
    assert.equal((await prisma.expert.findFirstOrThrow({ where: { companyId: company.id, fullName: "No Source Expert" } })).trustLevel, "AI_DRAFT");

    const hash = computeAnalysisContentHash(buildTenderAnalysisContent({
      title: tender.title, description: null, intakeSummary: null,
      files: [{ ...source, createdAt: source.createdAt }],
    }));
    await prisma.aiJob.create({ data: {
      userId: user.id, tenderId: tender.id, jobType: "AI_ANALYZE", status: "SUCCEEDED", analysisInputHash: hash,
      promotedAt: new Date(), promotedBy: user.id, finishedAt: new Date(), output: JSON.stringify({ analysisSource: "AI" }), input: "{}",
    } });

    const first = await enqueueEngineJobForCurrentSources(prisma, { userId: user.id, tenderId: tender.id, companyId: company.id, manualRequested: true });
    const retry = await enqueueEngineJobForCurrentSources(prisma, { userId: user.id, tenderId: tender.id, companyId: company.id, manualRequested: true });
    assert.ok(first && retry);
    assert.equal(retry.job.id, first.job.id);
    const claimed = await claimJobForCaller({ jobType: "ENGINE_RUN", tenderId: tender.id, userId: user.id, global: false });
    assert.equal(claimed?.id, first.job.id);
    await runTenderEngine(tender.id, user.id, undefined, { safe: true, skipAiRematch: true });
    await completeJob(first.job.id, { ok: true });

    assert.equal(await prisma.tenderExpertMatch.count({ where: { tenderId: tender.id, isSelected: true } }), 1);
    assert.equal(await prisma.tenderProjectMatch.count({ where: { tenderId: tender.id, isSelected: true } }), 1);
    const plan = await buildAndVerifyBuildPlan(prisma, tender.id, user.id, { reuseCurrent: false });
    assert.equal(plan.ok, true, plan.ok ? undefined : `${plan.code}: ${plan.message}`);
    await generateTenderDocuments(tender.id, user.id);

    const finalizeJob = await prisma.aiJob.create({ data: { userId: user.id, tenderId: tender.id, jobType: "AUTO_FINALIZE", status: "RUNNING", input: "{}" } });
    const finalized = await runAutoFinalizeAfterGeneration(tender.id, user.id, finalizeJob.id);
    const finalizedAgain = await runAutoFinalizeAfterGeneration(tender.id, user.id, finalizeJob.id);
    // Every stage of the automatic continuation must finish clean.
    //
    // `ok` is no longer asserted bare. Convergence now consults the canonical
    // export gate — the same getFinalSubmissionReadiness().ok the ZIP download
    // enforces — and this fixture never confirms a Build Plan, so that gate
    // legitimately refuses the package with FILE_NAMING, FILE_ORDER and
    // SUBMISSION_INSTRUCTIONS_NOT_EXTRACTED. Asserting ok:true here previously
    // passed only because convergence never asked the gate, which is exactly
    // the false success being removed: the job reported the pipeline finished
    // while the download would have answered 409.
    //
    // What this test proves is unchanged and still asserted below: the ZIP is
    // assembled from real bytes and reopens with the expected entries.
    const stageBlockers = finalized.blockers.filter(
      (blocker: string) => !blocker.includes("export readiness check refuses this package"),
    );
    assert.deepEqual(stageBlockers, [], `unexpected auto-finalize stage blocker: ${stageBlockers.join("; ")}`);
    assert.equal(
      finalized.finalReadiness.evaluated,
      true,
      "convergence must consult the same gate the ZIP download enforces",
    );
    assert.equal(finalizedAgain.pdfFinalization.finalized, 0);

    await prisma.generatedDocument.createMany({ data: [
      { tenderId: tender.id, name: "Planned", documentType: "TECHNICAL", exactFileName: "planned.docx", generationStatus: "PLANNED", validationStatus: "PENDING", integrityStatus: "UNKNOWN" },
      { tenderId: tender.id, name: "Failed", documentType: "TECHNICAL", exactFileName: "failed.docx", generationStatus: "FAILED", validationStatus: "FAILED", integrityStatus: "UNKNOWN" },
      { tenderId: tender.id, name: "Superseded", documentType: "TECHNICAL", exactFileName: "old.docx", generationStatus: "SUPERSEDED", validationStatus: "SUPERSEDED", integrityStatus: "VERIFIED" },
    ] });
    const allDocs = await prisma.generatedDocument.findMany({ where: { tenderId: tender.id } });
    const eligible = allDocs.filter((doc) => isFinalExportCandidateDocument(doc)
      && doc.generationStatus === "GENERATED" && doc.validationStatus === "VALIDATED"
      && doc.integrityStatus === "VERIFIED" && Boolean(doc.fileContent));
    const tenderForScope = await prisma.tender.findUniqueOrThrow({ where: { id: tender.id }, include: { requirements: { select: { exactFileName: true } } } });
    const scope = buildFinalZipEntries({ tender: tenderForScope, generatedDocs: eligible });
    const zip = await assembleFinalSubmissionZip(scope.entries, eligible.map((doc) => ({ generatedDocId: doc.id, bytes: Buffer.from(doc.fileContent!, "base64") })));
    const reopened = await JSZip.loadAsync(zip.buffer);
    assert.deepEqual(Object.keys(reopened.files).sort(), zip.fileList.sort());
    assert.equal(allDocs.filter((doc) => doc.format === "PDF" && doc.generationStatus !== "SUPERSEDED").length, 1, JSON.stringify({ tender: { exactFileNaming: tenderForScope.exactFileNaming, exactFileOrder: tenderForScope.exactFileOrder }, docs: allDocs.map((doc) => ({ name: doc.exactFileName, format: doc.format, status: doc.generationStatus })) }));
    assert.equal(await prisma.aiJob.count({ where: { tenderId: tender.id, jobType: "ENGINE_RUN" } }), 1);
    assert.equal(await prisma.expert.count({ where: { companyId: company.id } }), 2);
    assert.equal(await prisma.project.count({ where: { companyId: company.id } }), 1);
  } finally {
    if (tenderId) await cleanupTender(prisma, tenderId);
    await cleanupUser(prisma, user.id);
  }
});
