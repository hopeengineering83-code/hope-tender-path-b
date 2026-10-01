// A blocker about a file that does not exist must not condemn the files that do.
//
// WHY THIS FILE EXISTS
// --------------------
// validateTender() counted every BLOCK issue into one tender-wide status and
// wrote it onto all documents. On a real owner run the tender required
// "Technical Proposal.pdf", nothing had rendered it yet, and
// MISSING_REQUIRED_FILES therefore stamped validationStatus FAILED on a
// 98/100 source DOCX whose only finding was MEDIUM. finalize-pdf then refused
// to render the PDF — "no machine-validated source" — because the source it
// needed had just been failed by a blocker about the PDF's own absence.
// Neither route could move, and the owner was told to "run Validate", which is
// exactly what produced the state.
//
// Attribution decides the stamp. An issue carrying a documentId is about that
// document's bytes; an unattributed BLOCK is about the PACKAGE and is not
// evidence that an existing document is bad. Export is NOT relaxed: `passed`
// still requires zero BLOCK issues of any kind and every tender-level blocker
// is still returned — the assertions below pin both halves.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { Document, Packer, Paragraph } from "docx";

const RUN = process.env.RUN_DB_INTEGRATION === "true";
const EXPERT_NAME = "Alem Tesfaye Bekele";
const PROJECT_NAME = "Regional Referral Hospital Design and Supervision";

async function makeCleanTechnicalDocx(): Promise<Buffer> {
  // Long enough and varied enough to clear the narrative-quality rubric on its
  // own merits. A thin fixture fails with an ATTRIBUTED quality issue, which
  // would pass this test for the wrong reason — the point is a document with
  // nothing wrong with it.
  const topics = [
    "site investigation and survey control",
    "architectural design development",
    "structural analysis and detailing",
    "mechanical and electrical coordination",
    "environmental and social safeguards",
    "construction supervision and site instruction",
    "programme control and progress reporting",
    "stakeholder consultation and approvals",
    "handover, defects liability and close-out",
    "document control and record keeping",
  ];
  const children = [
    new Paragraph("Technical Proposal"),
    new Paragraph("Submitted to: Test Procuring Entity"),
    new Paragraph("Executive Summary"),
    new Paragraph("This proposal sets out our understanding of the assignment, the methodology we will apply, the work plan and deliverables, the quality assurance regime, and the risk controls that govern delivery from mobilisation through close-out."),
    new Paragraph("Methodology"),
  ];
  for (const [index, topic] of topics.entries()) {
    children.push(new Paragraph(`Activity ${index + 1}: ${topic}`));
    children.push(new Paragraph(
      `Our approach to ${topic} begins with a documented baseline agreed with the client representative, so that every subsequent decision can be traced to a recorded starting position rather than to recollection. `
      + `We assign a named lead and a named reviewer, and neither role may sign off its own output, which keeps the review independent of the work being reviewed. `
      + `Interim outputs for ${topic} are issued for comment at defined gates, and comments are closed out in a register that records who raised each point, how it was resolved, and on what date. `
      + `Measurements, drawings and calculations produced under ${topic} are filed against the same reference structure used for the deliverables register, so an auditor can move from a finding to its evidence without asking us where to look. `
      + `Where ${topic} depends on information the client holds, we state the dependency, the date we need it, and the effect on the programme if it arrives late, rather than absorbing the delay silently and reporting a slipped date later.`,
    ));
  }
  children.push(new Paragraph("Scope of Services"));
  children.push(new Paragraph("The scope covers facility assessment, design development, regulatory compliance review, construction supervision and project close-out support for the whole of the assignment."));
  children.push(new Paragraph("Team Composition"));
  children.push(new Paragraph(`The team is led by ${EXPERT_NAME}, who carries the design authority for the assignment, and draws on our delivery of ${PROJECT_NAME} as the closest comparable reference on our record.`));
  children.push(new Paragraph("QA and Quality Assurance Regime"));
  children.push(new Paragraph("Work Plan and Deliverables"));
  children.push(new Paragraph("Mobilisation, survey, design development, review gates, supervision and close-out are sequenced across the assignment with named hold points, and each deliverable carries an owner, a review date and an issue date recorded in the deliverables register."));
  children.push(new Paragraph("Quality Assurance"));
  children.push(new Paragraph("A hold-point register, an inspection and test plan, a progress reporting cycle and a client coordination process are maintained throughout delivery, with named reviewers at each gate and a documented route for raising and closing non-conformances."));
  children.push(new Paragraph("Risk Management"));
  children.push(new Paragraph("Risks are registered with an owner, a likelihood, an impact and a mitigation, and are reviewed at each reporting cycle against the agreed programme, so that a risk which has begun to materialise is escalated while options remain open rather than after they have closed."));
  children.push(new Paragraph("No pricing, rates or commercial terms appear in this technical envelope; the financial offer is submitted separately."));
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

/**
 * Give the tender one reviewed expert and one reviewed project, selected.
 * The narrative-quality rubric requires a technical proposal to cite the
 * evidence that was chosen for it, so a fixture with none fails on its own
 * merits and would pass this test for the wrong reason.
 */
async function selectReviewedEvidence(prisma: any, userId: string, tenderId: string): Promise<void> {
  const company = await prisma.company.findFirstOrThrow({ where: { userId }, select: { id: true } });
  const expert = await prisma.expert.create({
    data: { companyId: company.id, fullName: EXPERT_NAME, title: "Principal Architect", trustLevel: "REVIEWED" },
  });
  const project = await prisma.project.create({
    data: { companyId: company.id, name: PROJECT_NAME, clientName: "Regional Health Bureau", trustLevel: "REVIEWED" },
  });
  await prisma.tenderExpertMatch.create({ data: { tenderId, expertId: expert.id, isSelected: true, score: 1 } });
  await prisma.tenderProjectMatch.create({ data: { tenderId, projectId: project.id, isSelected: true, score: 1 } });
}

describe("validate stamps each document with its own outcome — real PostgreSQL", { skip: !RUN }, () => {
  it("leaves a clean DOCX validated when the blocker is a required PDF that does not exist yet", async () => {
    const { prisma } = await import("../lib/prisma");
    const { verifiedIntegrityDataFromBase64 } = await import("../lib/engine/persisted-byte-integrity");
    const { validateTender } = await import("../lib/engine/validate");

    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await prisma.user.create({
      data: { email: `per-doc-validate-${nonce}@example.test`, passwordHash: "unused", name: "Per Doc Validate Owner", role: "PROPOSAL_MANAGER" },
    });

    try {
      await prisma.company.create({ data: { userId: user.id, name: "Hope Engineering Test", address: "1 Test Way", email: "bids@example.test" } });

      const tender = await prisma.tender.create({
        data: {
          userId: user.id,
          title: `Per-document validate tender ${nonce}`,
          clientName: "Test Procuring Entity",
          reference: `PD-${nonce}`,
          // Two files are required; only the DOCX exists, so the PDF is
          // reported missing at tender level.
          exactFileNaming: JSON.stringify(["Technical-Proposal.docx", "Technical-Proposal.pdf"]),
        },
      });

      const docxContent = (await makeCleanTechnicalDocx()).toString("base64");
      const clean = await prisma.generatedDocument.create({
        data: {
          tenderId: tender.id,
          name: "Technical Proposal",
          exactFileName: "Technical-Proposal.docx",
          exactOrder: 1,
          documentType: "TECHNICAL_PROPOSAL",
          format: "DOCX",
          generationStatus: "GENERATED",
          validationStatus: "PENDING",
          fileContent: docxContent,
          ...verifiedIntegrityDataFromBase64({
            fileContent: docxContent,
            filename: "Technical-Proposal.docx",
            claimedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          }),
        },
      });

      await selectReviewedEvidence(prisma, user.id, tender.id);

      const report = await validateTender(tender.id);

      // The package blocker is still raised, and validation still fails.
      assert.equal(report.passed, false, "a missing required file must still block");
      const missing = report.issues.find((issue) => issue.code === "MISSING_REQUIRED_FILES");
      assert.ok(missing, `expected MISSING_REQUIRED_FILES, got ${report.issues.map((i) => i.code).join(", ")}`);
      assert.equal(missing.severity, "BLOCK");
      assert.equal(missing.documentId, undefined, "a missing file belongs to no document");

      // …but the document that exists and is clean is not condemned by it.
      const stamped = await prisma.generatedDocument.findUniqueOrThrow({
        where: { id: clean.id },
        select: { validationStatus: true },
      });
      assert.equal(
        stamped.validationStatus,
        "PASSED",
        "a clean document must not be failed by a blocker about a different, missing file",
      );
    } finally {
      await prisma.tender.deleteMany({ where: { userId: user.id } }).catch(() => {});
      await prisma.company.deleteMany({ where: { userId: user.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("still fails the document that is actually bad", async () => {
    const { prisma } = await import("../lib/prisma");
    const { verifiedIntegrityDataFromBase64 } = await import("../lib/engine/persisted-byte-integrity");
    const { validateTender } = await import("../lib/engine/validate");

    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await prisma.user.create({
      data: { email: `per-doc-validate-bad-${nonce}@example.test`, passwordHash: "unused", name: "Per Doc Validate Owner", role: "PROPOSAL_MANAGER" },
    });

    try {
      await prisma.company.create({ data: { userId: user.id, name: "Hope Engineering Test", address: "1 Test Way", email: "bids@example.test" } });
      const tender = await prisma.tender.create({
        data: {
          userId: user.id,
          title: `Per-document validate bad tender ${nonce}`,
          clientName: "Test Procuring Entity",
          reference: `PDB-${nonce}`,
          exactFileNaming: JSON.stringify(["Technical-Proposal.docx", "Cover-Letter.docx"]),
        },
      });

      const cleanContent = (await makeCleanTechnicalDocx()).toString("base64");
      const clean = await prisma.generatedDocument.create({
        data: {
          tenderId: tender.id, name: "Technical Proposal", exactFileName: "Technical-Proposal.docx", exactOrder: 1,
          documentType: "TECHNICAL_PROPOSAL", format: "DOCX", generationStatus: "GENERATED", validationStatus: "PENDING",
          fileContent: cleanContent,
          ...verifiedIntegrityDataFromBase64({ fileContent: cleanContent, filename: "Technical-Proposal.docx", claimedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
        },
      });

      const dirtyBytes = await Packer.toBuffer(new Document({
        sections: [{ children: [new Paragraph("Cover Letter"), new Paragraph("Dear [INSERT CLIENT NAME], we are pleased to submit this cover letter.")] }],
      }));
      const dirtyContent = dirtyBytes.toString("base64");
      const dirty = await prisma.generatedDocument.create({
        data: {
          tenderId: tender.id, name: "Cover Letter", exactFileName: "Cover-Letter.docx", exactOrder: 2,
          documentType: "COVER_LETTER", format: "DOCX", generationStatus: "GENERATED", validationStatus: "PENDING",
          fileContent: dirtyContent,
          ...verifiedIntegrityDataFromBase64({ fileContent: dirtyContent, filename: "Cover-Letter.docx", claimedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
        },
      });

      const report = await validateTender(tender.id);
      assert.equal(report.passed, false);

      const rows = await prisma.generatedDocument.findMany({
        where: { id: { in: [clean.id, dirty.id] } },
        select: { id: true, validationStatus: true },
      });
      const byId = new Map(rows.map((row) => [row.id, row.validationStatus]));
      assert.equal(byId.get(dirty.id), "FAILED", "the document carrying the placeholder must fail");
      assert.equal(byId.get(clean.id), "PASSED", "its neighbour must not be failed by association");
    } finally {
      await prisma.tender.deleteMany({ where: { userId: user.id } }).catch(() => {});
      await prisma.company.deleteMany({ where: { userId: user.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });
});
