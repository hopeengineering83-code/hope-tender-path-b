// A mandatory qualification that states a figure is checked against the
// figures on file — not met because a record of the right kind exists.
//
// 2026-10-10: a mandatory "average annual turnover of ETB 100,000,000 over the
// last three years", against a Vault holding ETB 20,000,000, 18,000,000 and
// 15,000,000, and "three similar assignments, each of not less than ETB
// 50,000,000, in the last ten years", against one ETB 2,000,000 project, were
// both printed FULLY MET in the proposal's own compliance matrix: the engine
// counted any financial record as turnover evidence and any selected project
// as the required count. The automatic coverage reconciler could then link the
// same records at FULL again.
//
// The check (lib/engine/mandatory-qualification-check.ts) returns PASS,
// CONDITIONAL_PASS or FAIL with FAILURE / EVIDENCE / MISSING / DECISION; FAIL
// only when the figures fall short under every reading of the wording, and no
// verdict at all when the wording cannot be read with certainty.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { assessMandatoryQualifications, formatQualificationAssessment } from "../lib/engine/mandatory-qualification-check";
import { buildCompliance, toCanonicalSupportLevel } from "../lib/engine/compliance";
import { buildComplianceMatrixSection } from "../lib/engine/compliance-matrix-builder";
import { parseAutomaticRequirementEvidence, reconcileAutomaticRequirementCoverage } from "../lib/engine/automatic-requirement-coverage";

const NOW = new Date(Date.UTC(2026, 9, 10));
const turnover = (fiscalYear: number, amount: number, currency = "ETB", recordType = "Annual Turnover") => ({ fiscalYear, amount, currency, recordType });
const project = (name: string, extra: Partial<{ contractValue: number; currency: string; endDate: string | null; selected: boolean }> = {}) => ({
  name, contractValue: extra.contractValue ?? null, currency: extra.currency ?? null, startDate: null, endDate: extra.endDate ?? null, selected: extra.selected ?? true,
});
const evidence = (financialRecords: any[], projects: any[] = [], foundingYear: number | null = 2012) => ({ companyName: "Northgate PLC", foundingYear, financialRecords, projects });
const req = (description: string, requirementType = "FINANCIAL", extra: Record<string, unknown> = {}) => ({ title: "Qualification", description, requirementType, priority: "MANDATORY", requiredQuantity: null, ...extra });
const verdictOf = (r: any, e: any) => assessMandatoryQualifications(r, e, NOW).map((a) => `${a.kind}:${a.verdict}`).join(",") || "none";

describe("a stated figure is read, and checked against the figures on file", () => {
  const AVERAGE_100M = req("The bidder shall have a minimum average annual turnover of ETB 100,000,000 over the last three (3) years.");
  const EACH_OR_AVERAGE = req("The bidder must have a minimum annual turnover of USD 500,000 for the last 3 fiscal years.");

  for (const [name, requirement, file, expected] of [
    ["an average below the threshold", AVERAGE_100M, evidence([turnover(2025, 20e6), turnover(2024, 18e6), turnover(2023, 15e6)]), "TURNOVER:FAIL"],
    ["an average above it", AVERAGE_100M, evidence([turnover(2025, 120e6), turnover(2024, 100e6), turnover(2023, 95e6)]), "TURNOVER:PASS"],
    ["a year missing from the average", AVERAGE_100M, evidence([turnover(2025, 120e6), turnover(2024, 100e6)]), "TURNOVER:CONDITIONAL_PASS"],
    ["turnover in another currency — no rate is assumed", EACH_OR_AVERAGE, evidence([turnover(2025, 90e6), turnover(2024, 80e6), turnover(2023, 70e6)]), "TURNOVER:CONDITIONAL_PASS"],
    ["each year or the average? passes one reading only", EACH_OR_AVERAGE, evidence([turnover(2025, 600e3, "USD"), turnover(2024, 400e3, "USD"), turnover(2023, 550e3, "USD")]), "TURNOVER:CONDITIONAL_PASS"],
    ["each year or the average? fails both", EACH_OR_AVERAGE, evidence([turnover(2025, 100e3, "USD"), turnover(2024, 400e3, "USD"), turnover(2023, 50e3, "USD")]), "TURNOVER:FAIL"],
    ["'50 million Birr in any one of the last 3 years'", req("Minimum annual turnover: 50 million Birr in any one of the last 3 years."), evidence([turnover(2024, 60e6)]), "TURNOVER:PASS"],
    ["'US$ 1.5 million' on average", req("Minimum average annual turnover of US$ 1.5 million over the past three years."), evidence([turnover(2025, 2e6, "USD"), turnover(2024, 1.6e6, "USD"), turnover(2023, 1.2e6, "USD")]), "TURNOVER:PASS"],
    ["a record that is not turnover is not turnover", AVERAGE_100M, evidence([turnover(2025, 500e6, "ETB", "Total Assets"), turnover(2024, 500e6, "ETB", "NET_PROFIT")]), "TURNOVER:CONDITIONAL_PASS"],
    ["two amounts in one sentence are not guessed between", req("Turnover of ETB 50 million and liquid assets of ETB 5 million."), evidence([turnover(2024, 60e6)]), "none"],
    ["named fiscal years are not read as a rolling window", req("Annual turnover of ETB 50 million for 2021, 2022 and 2023."), evidence([turnover(2024, 10e6)]), "none"],
    ["a relative threshold is not a figure", req("Average annual turnover of at least twice the estimated contract price."), evidence([turnover(2024, 10e6)]), "none"],
    ["three similar assignments of a stated value: one small one on file", req("The consultant shall have completed at least three (3) similar assignments, each with a contract value of not less than ETB 50,000,000, in the last ten (10) years.", "PROJECT_EXPERIENCE", { requiredQuantity: 3 }), evidence([], [project("Clinic", { contractValue: 2e6, currency: "ETB", endDate: "2022-01-01" })]), "SIMILAR_ASSIGNMENTS:FAIL"],
    ["three similar assignments in five years, all dated", req("The bidder must have completed at least 3 similar building design projects in the last 5 years.", "PROJECT_EXPERIENCE", { requiredQuantity: 3 }), evidence([], [project("A", { endDate: "2024-06-01" }), project("B", { endDate: "2022-01-01" }), project("C", { endDate: "2023-01-01" })]), "SIMILAR_ASSIGNMENTS:PASS"],
    ["one similar project undated, one not matched as similar", req("The bidder must have completed at least 3 similar building design projects in the last 5 years.", "PROJECT_EXPERIENCE", { requiredQuantity: 3 }), evidence([], [project("A", { endDate: "2024-06-01" }), project("B"), project("C", { endDate: "2023-01-01", selected: false })]), "SIMILAR_ASSIGNMENTS:CONDITIONAL_PASS"],
    ["a bare 'similar assignments' is a judgement, not a figure", req("Experience in similar assignments.", "PROJECT_EXPERIENCE"), evidence([], []), "none"],
    ["years in business below the stated minimum", req("The consultant must have at least 10 years of experience in urban planning.", "TECHNICAL"), evidence([], [], 2020), "FIRM_EXPERIENCE:FAIL"],
    ["years in business cannot prove years in a field", req("The consultant must have at least 10 years of experience in urban planning.", "TECHNICAL"), evidence([], [], 2010), "none"],
    ["general experience proved by the founding year", req("The firm shall have a minimum of 8 years of general experience.", "ELIGIBILITY"), evidence([], [], 2012), "FIRM_EXPERIENCE:PASS"],
    ["an expert's years are not the firm's", req("The consultant must nominate a team leader with a minimum of 15 years of experience.", "EXPERT"), evidence([], [], 2024), "none"],
    ["the firm's staff years are not the firm's", req("The firm shall propose engineers with a minimum of 8 years of experience.", "ELIGIBILITY"), evidence([], [], 2024), "none"],
    ["a scored criterion is never a pass/fail gate", { ...AVERAGE_100M, priority: "SCORED" }, evidence([turnover(2025, 1e6)]), "none"],
  ] as const) {
    it(`${name} → ${expected}`, () => assert.equal(verdictOf(requirement, file), expected));
  }

  it("states FAILURE, EVIDENCE, MISSING and DECISION", () => {
    const [assessment] = assessMandatoryQualifications(AVERAGE_100M, evidence([turnover(2025, 20e6), turnover(2024, 18e6), turnover(2023, 15e6)]), NOW);
    const text = formatQualificationAssessment(assessment!);
    assert.match(text, /^FAILURE: Average annual turnover of at least ETB 100,000,000 over the last 3 year\(s\)\./);
    assert.match(text, /EVIDENCE: Turnover on file: FY2025 ETB 20,000,000; FY2024 ETB 18,000,000; FY2023 ETB 15,000,000; average ETB 17,666,667\./);
    assert.match(text, /MISSING: .*fall short/);
    assert.match(text, /DECISION: Northgate PLC cannot presently satisfy this mandatory requirement/);
  });
});

describe("the engine and the proposal's compliance matrix do not claim what the figures deny", () => {
  const knowledge = (financialRecords: any[], projects: any[]) => ({
    companyId: "c", experts: [], documents: [], legalRecords: [], complianceRecords: [], financialRecords, projects,
  }) as never;
  const ROWS = [
    { id: "t", requirement: { title: "Minimum average annual turnover", description: "The bidder shall have a minimum average annual turnover of ETB 100,000,000 over the last three (3) years, supported by audited financial statements.", requirementType: "FINANCIAL", priority: "MANDATORY" } },
    { id: "p", requirement: { title: "Similar assignments", description: "The consultant shall have completed at least three (3) similar assignments, each with a contract value of not less than ETB 50,000,000, in the last ten (10) years.", requirementType: "PROJECT_EXPERIENCE", priority: "MANDATORY", requiredQuantity: 3 } },
  ];
  const sectionE = (result: ReturnType<typeof buildCompliance>) => buildComplianceMatrixSection({
    requirements: ROWS.map((row) => ({ id: row.id, ...row.requirement })),
    matrixRows: result.matrices.map((m) => ({ requirementId: m.requirementId, supportLevel: toCanonicalSupportLevel(m.supportStatus), evidenceType: m.evidenceType, evidenceReference: m.evidenceReference })),
    gaps: result.gaps,
  } as never)!;
  const statusOf = (section: string, title: string) => new RegExp(`\\| ${title} \\|[^\\n]*\\| (FULLY MET|PARTIALLY MET|NOT MET) \\|`).exec(section)?.[1];

  it("figures that fall short: NOT MET, and a CRITICAL gap stating the decision", () => {
    const result = buildCompliance(ROWS as never, knowledge(
      [turnover(2025, 20e6), turnover(2024, 18e6), turnover(2023, 15e6)].map((r, i) => ({ id: `f${i}`, ...r })),
      [{ id: "p1", name: "Small clinic design", contractValue: 2e6, currency: "ETB", endDate: new Date("2022-01-01") }],
    ), { expertMatches: [], projectMatches: [{ projectId: "p1", score: 0.8, isSelected: true }] } as never, { companyName: "Northgate PLC", now: NOW });
    for (const id of ["t", "p"]) {
      const row = result.matrices.find((m) => m.requirementId === id)!;
      assert.equal(row.supportStatus, "UNSUPPORTED", id);
      assert.match(row.evidenceSummary, /^FAILURE: .* EVIDENCE: .* MISSING: .* DECISION: Northgate PLC cannot presently satisfy/);
      const gap = result.gaps.find((g) => g.requirementId === id)!;
      assert.equal(gap.severity, "CRITICAL");
      assert.match(gap.title, /mandatory qualification not met$/);
    }
    const section = sectionE(result);
    assert.equal(statusOf(section, "Minimum average annual turnover"), "NOT MET");
    assert.equal(statusOf(section, "Similar assignments"), "NOT MET");
    assert.doesNotMatch(section, /FULLY MET \|/);
  });

  it("figures that meet the threshold: still FULLY MET, with the figures named for the owner", () => {
    const result = buildCompliance(ROWS as never, knowledge(
      [turnover(2025, 140e6), turnover(2024, 120e6), turnover(2023, 110e6)].map((r, i) => ({ id: `f${i}`, ...r })),
      ["A", "B", "C"].map((name, i) => ({ id: `p${i}`, name: `Hospital ${name}`, contractValue: 80e6, currency: "ETB", endDate: new Date(`202${i + 2}-06-30`) })),
    ), { expertMatches: [], projectMatches: [0, 1, 2].map((i) => ({ projectId: `p${i}`, score: 0.9, isSelected: true })) } as never, { companyName: "Northgate PLC", now: NOW });
    assert.equal(result.gaps.filter((g) => g.requirementId === "t" || g.requirementId === "p").length, 0, JSON.stringify(result.gaps));
    assert.match(result.matrices.find((m) => m.requirementId === "t")!.evidenceSummary, /PASS: .*average ETB 123,333,333/);
    const section = sectionE(result);
    assert.equal(statusOf(section, "Minimum average annual turnover"), "FULLY MET");
    assert.equal(statusOf(section, "Similar assignments"), "FULLY MET");
  });

  it("figures not yet proven: PARTIALLY MET and a HIGH gap naming what to supply — never FULLY MET", () => {
    const result = buildCompliance([ROWS[0]!] as never, knowledge([turnover(2025, 140e6), turnover(2024, 120e6)].map((r, i) => ({ id: `f${i}`, ...r })), []),
      { expertMatches: [], projectMatches: [] } as never, { companyName: "Northgate PLC", now: NOW });
    assert.equal(result.matrices[0]!.supportStatus, "PARTIAL");
    const gap = result.gaps.find((g) => g.requirementId === "t")!;
    assert.equal(gap.severity, "HIGH");
    assert.match(gap.mitigationPlan ?? "", /audited turnover in ETB for 1 more year/);
  });

  it("no evidence at all still blocks, as before", () => {
    const result = buildCompliance([ROWS[0]!] as never, knowledge([], []), { expertMatches: [], projectMatches: [] } as never, { now: NOW });
    assert.equal(result.gaps.find((g) => g.requirementId === "t")!.severity, "CRITICAL");
  });

  it("a requirement that states no figure keeps the engine's treatment", () => {
    const plain = [{ id: "a", requirement: { title: "Audited financial statements", description: "Submit audited financial statements.", requirementType: "FINANCIAL", priority: "MANDATORY" } }];
    const result = buildCompliance(plain as never, knowledge([{ id: "f", ...turnover(2025, 1e6) }], []), { expertMatches: [], projectMatches: [] } as never, { now: NOW });
    assert.equal(result.matrices[0]!.supportStatus, "SUPPORTED");
    assert.equal(result.gaps.filter((g) => g.requirementId === "a").length, 0);
  });
});

describe("automatic coverage links no record as proof of a figure it falls short of", () => {
  const FILE_ID = "file-1";
  const TURNOVER_QUOTE = "The bidder shall have a minimum average annual turnover of ETB 100,000,000 over the last three (3) years.";
  const SIMILAR_QUOTE = "The consultant shall have completed at least three (3) similar assignments, each with a contract value of not less than ETB 50,000,000, in the last ten (10) years.";
  const AUDITED_QUOTE = "The bidder shall submit audited financial statements for the last three years.";
  const TEXT = `Section 3. ${TURNOVER_QUOTE} ${SIMILAR_QUOTE} ${AUDITED_QUOTE}`;
  const requirement = (id: string, title: string, quote: string, requirementType: string) => ({
    id, title, description: quote, requirementType, priority: "MANDATORY", restrictions: null, requiredQuantity: null, exactFileName: null,
    sourceTenderFileId: FILE_ID, sourcePageNumber: 3, sourceExactQuote: quote, complianceMatrixRows: [] as unknown[],
  });
  const statements = {
    id: "doc-fs", fileName: "Audited Financial Statements 2023-2025.pdf", category: "FINANCIAL_STATEMENT",
    extractedText: `Audited financial statements. Statement of profit or loss. Revenue for the year ${"and other figures ".repeat(20)}`,
    contentSha256: "b".repeat(64), contentByteLength: 2048, integrityStatus: "VERIFIED",
  };

  function stubDb() {
    const created: Array<{ requirementId: string; supportLevel: string; notes: string }> = [];
    const tx = { complianceMatrix: {
      deleteMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: any }) => { created.push(data); return data; },
      update: async () => ({}),
    } };
    const db = {
      tender: { findFirst: async () => ({
        id: "tender-1", userId: "user-1",
        requirements: [
          requirement("req-turnover", "Minimum average annual turnover", TURNOVER_QUOTE, "FINANCIAL"),
          requirement("req-similar", "Similar assignments", SIMILAR_QUOTE, "PROJECT_EXPERIENCE"),
          requirement("req-audited", "Audited financial statements", AUDITED_QUOTE, "FINANCIAL"),
        ],
        files: [{ id: FILE_ID, extractedText: TEXT, totalPages: 10 }],
        generatedDocuments: [], expertMatches: [], projectMatches: [{ projectId: "p1" }],
      }) },
      tenderRequirement: { findMany: async () => [], update: async () => ({}) },
      tenderFile: { findMany: async () => [{ id: FILE_ID, extractedText: TEXT, totalPages: 10, deletionStatus: "ACTIVE" }] },
      company: { findUnique: async () => ({ id: "company-1", name: "Northgate PLC", foundingYear: 2012 }) },
      expert: { findMany: async () => [] },
      project: { findMany: async () => [{ id: "p1", name: "Small clinic design", contractValue: 2e6, currency: "ETB", endDate: new Date("2022-01-01"), trustLevel: "REGEX_DRAFT" }] },
      legalRecord: { findMany: async () => [] },
      financialRecord: { findMany: async () => [] },
      companyComplianceRecord: { findMany: async () => [] },
      companyDocument: { findMany: async () => [statements] },
      $transaction: async (fn: (t: unknown) => Promise<void>) => { await fn(tx); },
    };
    return { db: db as never, created };
  }

  it("a shortfall gets no link and stays a blocker; an unproven figure is at most PARTIAL and names it", async () => {
    const { db, created } = stubDb();
    const result = await reconcileAutomaticRequirementCoverage(db, "tender-1", "user-1");
    assert.equal(result.ok, true);

    assert.equal(created.filter((row) => row.requirementId === "req-similar").length, 0, "nothing is linked as proof of three ETB 50 M assignments");
    assert.ok(result.remainingWithoutEligibleEvidence.some((r) => r.id === "req-similar"));

    const turnoverRows = created.filter((row) => row.requirementId === "req-turnover");
    assert.ok(turnoverRows.length > 0, "the statements are still linked for the owner to see");
    for (const row of turnoverRows) {
      assert.equal(row.supportLevel, "PARTIAL", "no turnover figure is on file, so the statements cannot prove ETB 100 M");
      assert.ok(parseAutomaticRequirementEvidence(row.notes)!.missingFacets!.includes("statedFigure"));
    }

    const audited = created.filter((row) => row.requirementId === "req-audited");
    assert.ok(audited.some((row) => row.supportLevel === "FULL"), "a requirement with no figure is linked as before");
  });
});
