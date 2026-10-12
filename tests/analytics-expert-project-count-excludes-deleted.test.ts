// Reported live symptom: after deleting an expert/project, the Company
// Vault page (backed by /api/company, which filters deletedAt: null) shows
// the record gone, while app/dashboard/analytics/page.tsx's "Experts" /
// "Projects" KvStat tiles kept showing the pre-delete count — "one place
// says present, another says zero". Root cause: analytics/page.tsx used a
// Prisma relation _count with no `where`, which counts every row
// including soft-deleted ones, unlike every other expert/project query in
// the app (all of which filter deletedAt: null). This proves the exact
// Prisma query shape analytics/page.tsx now uses (a `where`-scoped
// relation count) actually excludes a soft-deleted expert/project, against
// a real PostgreSQL database rather than by source inspection alone.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

describe("analytics page's Expert/Project _count excludes soft-deleted rows — real PostgreSQL", () => {
  let userId: string;
  let companyId: string;

  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const user = await prisma.user.create({
      data: { email: `analytics-count-${nonce}@example.test`, name: "Analytics Count Test", passwordHash: "test-hash" },
    });
    userId = user.id;
    const company = await prisma.company.create({ data: { userId, name: `Analytics Count Firm ${nonce}` } });
    companyId = company.id;

    const expert = await prisma.expert.create({ data: { companyId, fullName: "Deleted Expert" } });
    await prisma.expert.create({ data: { companyId, fullName: "Live Expert" } });
    const project = await prisma.project.create({ data: { companyId, name: "Deleted Project" } });
    await prisma.project.create({ data: { companyId, name: "Live Project" } });

    // Soft-delete one of each, mirroring the app's delete action.
    await prisma.expert.update({ where: { id: expert.id }, data: { deletedAt: new Date() } });
    await prisma.project.update({ where: { id: project.id }, data: { deletedAt: new Date() } });
  });

  after(async () => {
    await prisma.expert.deleteMany({ where: { companyId } });
    await prisma.project.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("an unfiltered relation _count (the pre-fix shape) still counts the soft-deleted rows — proves the bug was real", async () => {
    const company = await prisma.company.findUnique({
      where: { userId },
      select: { _count: { select: { experts: true, projects: true } } },
    });
    assert.equal(company?._count.experts, 2, "unfiltered count includes the soft-deleted expert");
    assert.equal(company?._count.projects, 2, "unfiltered count includes the soft-deleted project");
  });

  it("the fixed, deletedAt-filtered relation _count matches /api/company's live count", async () => {
    const company = await prisma.company.findUnique({
      where: { userId },
      select: {
        _count: {
          select: {
            experts: { where: { deletedAt: null } },
            projects: { where: { deletedAt: null } },
          },
        },
      },
    });
    assert.equal(company?._count.experts, 1, "filtered count must exclude the soft-deleted expert");
    assert.equal(company?._count.projects, 1, "filtered count must exclude the soft-deleted project");

    const liveExperts = await prisma.expert.count({ where: { companyId, deletedAt: null } });
    const liveProjects = await prisma.project.count({ where: { companyId, deletedAt: null } });
    assert.equal(company?._count.experts, liveExperts, "must agree with the same deletedAt:null count /api/company uses");
    assert.equal(company?._count.projects, liveProjects);
  });
});
