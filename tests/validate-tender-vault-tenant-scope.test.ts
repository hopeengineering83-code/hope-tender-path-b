// validateTender() re-read Company Vault records by bare ID:
//
//   prisma.expert.findMany({ where: { id: { in: selectedExpertIds }, deletedAt: null } })
//
// The IDs come from TenderExpertMatch / TenderProjectMatch rows on a tender
// whose ownership the caller (app/api/tenders/[id]/export/route.ts) has
// already checked, and matching is company-scoped — so in practice a foreign
// ID should never arrive. But "should never" meant the tenant boundary was
// inherited from a caller two levels up rather than enforced where the read
// happens, and TenderExpertMatch.expertId has no database-level tenant
// constraint: it is a plain FK to Expert.
//
// That matters because the validation messages interpolate the records'
// fullName / name:
//
//   `... Affected: ${regexDraft.map((e) => e.fullName).join(", ")}.`
//
// so a single cross-tenant match row would put another company's expert and
// project names into a validation report the requesting user reads.
//
// This test creates exactly that row — company B's expert selected on company
// A's tender — and asserts the report never names it. It fails against the
// unscoped query and passes with `company: { userId: tender.userId }`.

import { before, after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import { validateTender } from "../lib/engine/validate";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const FOREIGN_EXPERT_NAME = `Foreign Expert ${nonce}`;
const FOREIGN_PROJECT_NAME = `Foreign Project ${nonce}`;
const OWN_EXPERT_NAME = `Own Expert ${nonce}`;

let ownerUserId: string;
let foreignUserId: string;
let tenderId: string;

before(async () => {
  await prismaReady;

  const owner = await prisma.user.create({
    data: { email: `scope-owner-${nonce}@example.test`, name: "Scope Owner", passwordHash: "test-hash" },
  });
  const foreign = await prisma.user.create({
    data: { email: `scope-foreign-${nonce}@example.test`, name: "Scope Foreign", passwordHash: "test-hash" },
  });
  ownerUserId = owner.id;
  foreignUserId = foreign.id;

  const ownerCompany = await prisma.company.create({ data: { userId: owner.id, name: `Owner Co ${nonce}` } });
  const foreignCompany = await prisma.company.create({ data: { userId: foreign.id, name: `Foreign Co ${nonce}` } });

  // Both drafts, so both would produce a named BLOCK issue if they were read.
  const ownExpert = await prisma.expert.create({
    data: { companyId: ownerCompany.id, fullName: OWN_EXPERT_NAME, trustLevel: "REGEX_DRAFT" },
  });
  const foreignExpert = await prisma.expert.create({
    data: { companyId: foreignCompany.id, fullName: FOREIGN_EXPERT_NAME, trustLevel: "REGEX_DRAFT" },
  });
  const foreignProject = await prisma.project.create({
    data: { companyId: foreignCompany.id, name: FOREIGN_PROJECT_NAME, trustLevel: "REGEX_DRAFT" },
  });

  const tender = await prisma.tender.create({
    data: { userId: owner.id, title: `Scope Tender ${nonce}` },
  });
  tenderId = tender.id;

  // The row the scope must defend against: nothing in the schema forbids it.
  await prisma.tenderExpertMatch.createMany({
    data: [
      { tenderId: tender.id, expertId: ownExpert.id, score: 0.9, isSelected: true },
      { tenderId: tender.id, expertId: foreignExpert.id, score: 0.9, isSelected: true },
    ],
  });
  await prisma.tenderProjectMatch.create({
    data: { tenderId: tender.id, projectId: foreignProject.id, score: 0.9, isSelected: true },
  });
});

after(async () => {
  await prisma.tenderExpertMatch.deleteMany({ where: { tenderId } });
  await prisma.tenderProjectMatch.deleteMany({ where: { tenderId } });
  await prisma.tender.deleteMany({ where: { id: tenderId } });
  for (const userId of [ownerUserId, foreignUserId]) {
    const companies = await prisma.company.findMany({ where: { userId }, select: { id: true } });
    for (const c of companies) {
      await prisma.expert.deleteMany({ where: { companyId: c.id } });
      await prisma.project.deleteMany({ where: { companyId: c.id } });
    }
    await prisma.company.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }
});

describe("validateTender never reads Vault records belonging to another tenant", () => {
  it("does not name a foreign expert reached through a cross-tenant match row", async () => {
    const report = await validateTender(tenderId);
    const serialized = JSON.stringify(report);

    assert.doesNotMatch(
      serialized,
      new RegExp(FOREIGN_EXPERT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "another company's expert name must never appear in a validation report",
    );
  });

  it("does not name a foreign project reached through a cross-tenant match row", async () => {
    const report = await validateTender(tenderId);
    assert.doesNotMatch(
      JSON.stringify(report),
      new RegExp(FOREIGN_PROJECT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "another company's project name must never appear in a validation report",
    );
  });

  it("still reports the tenant's own draft expert — the scope narrows, it does not blind the check", async () => {
    const report = await validateTender(tenderId);
    const serialized = JSON.stringify(report);

    assert.match(
      serialized,
      new RegExp(OWN_EXPERT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "the owner's own REGEX_DRAFT expert must still be flagged",
    );
    assert.ok(
      report.issues.some((i) => i.code === "REGEX_DRAFT_EXPERT_SELECTED"),
      "the REGEX_DRAFT block must still fire for the owner's own record",
    );
  });

  it("counts only the tenant's own records, so a foreign row cannot inflate the report", async () => {
    const report = await validateTender(tenderId);
    const expertIssue = report.issues.find((i) => i.code === "REGEX_DRAFT_EXPERT_SELECTED");
    assert.ok(expertIssue, "expected the REGEX_DRAFT expert issue");
    assert.match(
      expertIssue!.message,
      /^1 selected expert\(s\) are REGEX_DRAFT/,
      "two match rows exist but only one is in-tenant, so the count must be 1",
    );
    assert.equal(
      report.issues.some((i) => i.code === "REGEX_DRAFT_PROJECT_SELECTED"),
      false,
      "the only selected project is foreign, so no project issue should be raised at all",
    );
  });
});
