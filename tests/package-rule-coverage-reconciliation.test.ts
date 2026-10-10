// The reconciler must write a package-conformance link for a submission RULE,
// not a weak text-similarity link.
//
// Before this fix, "Submission in a Single PDF Technical File" and "Financial
// Proposal Omission" went through the same text-similarity selector every
// evidence requirement uses. The name of a rule never closely matches the name
// of a document, so the best score always fell under the FULL threshold and the
// row settled at PARTIAL for ever, with the panel telling the owner to
// "strengthen it with eligible source-backed evidence" — evidence that cannot
// exist for a rule about the package's own shape.
//
// These tests drive the real reconciler against a stub database and assert on
// the rows it decides to persist.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  reconcileAutomaticRequirementCoverage,
  parseAutomaticRequirementEvidence,
} from "../lib/engine/automatic-requirement-coverage";

const TENDER_ID = "tender-1";
const USER_ID = "user-1";
const FILE_ID = "file-1";
const QUOTE = "The technical proposal shall be submitted as a single consolidated PDF file.";
const FIN_QUOTE = "No financial proposal shall be included with the technical submission.";
const EXTRACTED = `Section 4. ${QUOTE} Section 5. ${FIN_QUOTE}`;

type Row = {
  id: string;
  tenderId: string;
  requirementId: string;
  evidenceType: string;
  evidenceSource: string;
  evidenceReference: string;
  supportLevel: string;
  notes: string;
};

function requirement(id: string, title: string, quote: string) {
  return {
    id,
    title,
    description: "",
    requirementType: "FORMAT",
    priority: "MANDATORY",
    restrictions: null,
    requiredQuantity: null,
    exactFileName: null,
    sourceTenderFileId: FILE_ID,
    sourcePageNumber: 4,
    sourceExactQuote: quote,
    complianceMatrixRows: [] as unknown[],
  };
}

function stubDb(generatedDocuments: Array<Record<string, unknown>>, requirements: unknown[]) {
  const created: Row[] = [];
  const deleted: string[] = [];
  const tx = {
    complianceMatrix: {
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        deleted.push(...where.id.in);
        return { count: where.id.in.length };
      },
      create: async ({ data }: { data: Omit<Row, "id"> }) => {
        created.push({ id: `row-${created.length}`, ...data });
        return created[created.length - 1];
      },
      update: async () => ({}),
    },
  };
  return {
    created,
    deleted,
    db: {
      tender: {
        findFirst: async () => ({
          id: TENDER_ID,
          userId: USER_ID,
          requirements,
          files: [{ id: FILE_ID, extractedText: EXTRACTED, totalPages: 10 }],
          generatedDocuments,
          expertMatches: [],
          projectMatches: [],
        }),
      },
      tenderRequirement: { findMany: async () => [], update: async () => ({}) },
      tenderFile: { findMany: async () => [{ id: FILE_ID, extractedText: EXTRACTED, totalPages: 10, deletionStatus: "ACTIVE" }] },
      company: { findUnique: async () => null },
      $transaction: async (fn: (t: unknown) => Promise<void>) => { await fn(tx); },
    } as unknown as Parameters<typeof reconcileAutomaticRequirementCoverage>[0],
  };
}

function validatedPdf(name: string, documentType = "TECHNICAL_PROPOSAL") {
  return {
    id: `doc-${name}`,
    name,
    exactFileName: name,
    documentType,
    format: "PDF",
    generationStatus: "GENERATED",
    validationStatus: "VALIDATED",
    reviewStatus: "APPROVED",
    fileContent: "AAAA",
    storagePath: null,
    contentSha256: "a".repeat(64),
    contentByteLength: 4,
    integrityStatus: "VERIFIED",
  };
}

test("a conforming package produces a FULL package-conformance link, not a PARTIAL similarity link", async () => {
  const requirements = [requirement("req-single", "Submission in a Single PDF Technical File", QUOTE)];
  const { db, created } = stubDb([validatedPdf("Technical Proposal.pdf")], requirements);

  const result = await reconcileAutomaticRequirementCoverage(db, TENDER_ID, USER_ID);

  assert.equal(result.ok, true);
  assert.equal(created.length, 1);
  const row = created[0]!;
  assert.equal(row.supportLevel, "FULL", "a decided rule is FULL, never PARTIAL");
  assert.equal(row.evidenceType, "PACKAGE_CONFORMANCE");
  assert.equal(row.evidenceSource, "AUTO_PACKAGE_CONFORMANCE");

  const metadata = parseAutomaticRequirementEvidence(row.notes);
  assert.ok(metadata, "the link must parse as auditable automatic evidence");
  assert.equal(metadata!.recordType, "PACKAGE_CONFORMANCE");
  assert.equal(metadata!.linkageScore, 100);
  assert.match(metadata!.linkageReasons[0]!, /^package-conformance:SINGLE_FILE_CONSOLIDATION$/);

  assert.deepEqual(result.packageRuleViolations, []);
  assert.deepEqual(result.packageRulesAwaitingPackage, []);
});

test("a package that breaks the rule writes NO link and is reported as a violation, not as an evidence gap", async () => {
  const requirements = [requirement("req-single", "Submission in a Single PDF Technical File", QUOTE)];
  const { db, created } = stubDb(
    [validatedPdf("Technical Proposal.pdf"), validatedPdf("Methodology.pdf", "METHODOLOGY")],
    requirements,
  );

  const result = await reconcileAutomaticRequirementCoverage(db, TENDER_ID, USER_ID);

  assert.equal(created.length, 0, "fail-closed: no evidence row is invented for a broken rule");
  assert.equal(result.packageRuleViolations.length, 1);
  assert.match(result.packageRuleViolations[0]!.reason, /holds 2/);
  assert.deepEqual(
    result.remainingWithoutEligibleEvidence,
    [],
    "a broken package rule is not an evidence gap and must not be reported as one",
  );
});

test("before any document exists the rule is awaiting the package, never a missing-evidence gap", async () => {
  const requirements = [requirement("req-fin", "Financial Proposal Omission", FIN_QUOTE)];
  const { db, created } = stubDb([], requirements);

  const result = await reconcileAutomaticRequirementCoverage(db, TENDER_ID, USER_ID);

  assert.equal(created.length, 0);
  assert.equal(result.packageRulesAwaitingPackage.length, 1);
  assert.match(result.packageRulesAwaitingPackage[0]!.reason, /needs no owner-supplied evidence/);
  assert.deepEqual(result.remainingWithoutEligibleEvidence, []);
});

test("financial omission is satisfied by a package carrying no financial-envelope document", async () => {
  const requirements = [requirement("req-fin", "Financial Proposal Omission", FIN_QUOTE)];
  const { db, created } = stubDb([validatedPdf("Technical Proposal.pdf")], requirements);

  await reconcileAutomaticRequirementCoverage(db, TENDER_ID, USER_ID);

  assert.equal(created.length, 1);
  assert.equal(created[0]!.supportLevel, "FULL");
  const metadata = parseAutomaticRequirementEvidence(created[0]!.notes);
  assert.match(metadata!.linkageReasons[0]!, /FINANCIAL_SEPARATION/);
});

test("an ungrounded package rule is still refused — grounding is not weakened by this path", async () => {
  const requirements = [requirement("req-single", "Submission in a Single PDF Technical File", "short")];
  const { db, created } = stubDb([validatedPdf("Technical Proposal.pdf")], requirements);

  const result = await reconcileAutomaticRequirementCoverage(db, TENDER_ID, USER_ID);

  assert.equal(created.length, 0);
  assert.equal(result.remainingUngrounded.length, 1);
});
