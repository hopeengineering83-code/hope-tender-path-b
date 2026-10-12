// The submission plan must not depend on the order requirements are read in.
//
// 2026-10-08, Pharo tender on the new Preview database: the tender names one
// file ("Technical Proposal.pdf") and every one of its 14 requirements points
// at it. The file's type was whichever requirement came first. Run Engine
// confirmed "Technical Proposal.pdf / ANNEX"; finalization then updated the
// requirement rows, an unordered read returned them in another order, the
// export gate recomputed "COMPANY_PROFILE", and refused a correct plan:
// "Plan item Technical Proposal.pdf is not in current tender-controlled
// scope" (BUILD_PLAN_ITEMS_INVALID). The proposal was finished and scored
// 100; the download was refused.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import { executeTenderDeletion } from "../lib/tender/delete-tender";
import { buildSubmissionPlan, plannedSubmissionTargetFiles } from "../lib/engine/submission-plan";
import { validateBuildPlanItemsAtRuntime } from "../lib/engine/build-plan";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

const TYPES = ["COMPANY_PROFILE", "METHODOLOGY", "ELIGIBILITY", "PROJECT_EXPERIENCE", "EXPERT", "ANNEX", "TECHNICAL"];
const REQS = TYPES.flatMap((type, i) => [0, 1].map((j) => ({
  id: `r-${i}-${j}`, title: `${type} ${j}`, description: "Required in the technical proposal.", requirementType: type,
  priority: i % 2 ? "SCORED" : "MANDATORY", exactFileName: "Technical Proposal.pdf", exactOrder: null,
})));
const TENDER = { id: "t", title: "Architectural Consultancy Services", exactFileNaming: JSON.stringify(["Technical Proposal.pdf"]), exactFileOrder: null };
const keyOf = (rs: typeof REQS) => JSON.stringify(plannedSubmissionTargetFiles(buildSubmissionPlan({ ...TENDER, requirements: rs } as any))
  .map((f) => [f.exactOrder, f.exactFileName, f.documentType]));

function shuffled<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe("a plan does not depend on the order requirements are read in", () => {
  it("every read order gives the same plan", () => {
    const first = keyOf(REQS);
    for (let seed = 1; seed <= 40; seed++) assert.equal(keyOf(shuffled(REQS, seed)), first, `order ${seed} changed the plan`);
  });

  it("a file the tender names as its technical proposal is that proposal", () => {
    const [file] = plannedSubmissionTargetFiles(buildSubmissionPlan({ ...TENDER, requirements: REQS } as any));
    assert.equal(file!.exactFileName, "Technical Proposal.pdf");
    assert.equal(file!.documentType, "TECHNICAL_PROPOSAL");
  });

  describe("on real PostgreSQL", () => {
    let userId = "";
    let tenderId = "";
    before(async () => {
      await prismaReady;
      const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      userId = (await prisma.user.create({ data: { email: `plan-order-${nonce}@example.test`, name: "P", passwordHash: "h" } })).id;
      tenderId = (await prisma.tender.create({ data: {
        userId, title: `Plan order ${nonce}`, status: "DRAFT", stage: "TENDER_INTAKE", exactFileNaming: TENDER.exactFileNaming,
        requirements: { create: REQS.map(({ id: _id, ...r }) => r) },
      } })).id;
    });
    after(async () => {
      await prisma.$transaction((tx) => executeTenderDeletion(tx, tenderId, "plan-order-test", userId));
      await prisma.user.deleteMany({ where: { id: userId } });
    });

    it("a confirmed plan stays in scope after the requirement rows are updated", async () => {
      const read = async () => (await prisma.tender.findFirstOrThrow({ where: { id: tenderId }, include: { requirements: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } }));
      const items = plannedSubmissionTargetFiles(buildSubmissionPlan((await read()) as any));
      // What finalization does to requirement rows: update them, in some order.
      const rows = await prisma.tenderRequirement.findMany({ where: { tenderId }, select: { id: true } });
      for (const row of shuffled(rows, 7)) await prisma.tenderRequirement.update({ where: { id: row.id }, data: { isResolved: true } });
      const result = await validateBuildPlanItemsAtRuntime(prisma, tenderId, userId, items);
      assert.deepEqual(result.blockers, []);
      assert.equal(result.ok, true);
    });
  });
});
