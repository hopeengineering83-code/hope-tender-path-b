// A tender with two source files (a ToR and a guideline PDF) showed "Tender
// content changed since the last analysis" the moment AI Analyze succeeded,
// every time (Preview, 2026-10-06). The release snapshot loaded files without
// createdAt, so the shared content builder ordered them by id, while the
// promotion re-hash ordered them by upload time. With one file the orders
// agree, which is why only multi-file tenders were stuck.
//
// Every site that recomputes the current hash now loads ANALYSIS_HASH_FILE_SELECT.
import { after, before, it } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { dbDescribe, getPrisma, testSuffix, seedUser, seedTender, cleanupTender, cleanupUser, type TestUser } from "./helpers/db-acceptance-harness";
import { computePersistedTenderAnalysisHash } from "../lib/engine/tender-analysis-content";
import { getTenderReleaseSnapshot } from "../lib/engine/tender-release-snapshot";

const TOR = "TERMS OF REFERENCE. Consultancy service for a feasibility study. The consultant shall assess water supply, sanitation and hygiene systems and submit a technical and a financial proposal before the set tender closing.";
const GUIDELINE = "GUIDELINE FOR CONDUCTING FEASIBILITY STUDIES. Each study follows the OECD-DAC criteria: relevance, coherence, effectiveness, efficiency, impact and sustainability, with a recommendations matrix.";

dbDescribe("a two-file tender's analysis is current when it succeeds", () => {
  let prisma: PrismaClient;
  let user: TestUser;
  let tenderId: string;

  before(async () => {
    prisma = getPrisma();
    const suffix = testSuffix();
    user = await seedUser(prisma, suffix, "ADMIN");
    tenderId = (await seedTender(prisma, { userId: user.id, suffix })).id;
    // Upload order is the reverse of id order: the first upload gets the
    // larger id, so ordering by id and by createdAt disagree.
    const base = Date.now() - 60_000;
    for (const [id, name, text, at] of [
      [`ffffffff-${randomUUID().slice(9)}`, "ToR-Feasibility Study.pdf", TOR, base],
      [`00000000-${randomUUID().slice(9)}`, "guideline-for-conducting-feasibility-studies.pdf", GUIDELINE, base + 30_000],
    ] as const) {
      await prisma.tenderFile.create({
        data: {
          id, tenderId, fileName: name, originalFileName: name, mimeType: "application/pdf", size: 1000,
          extractedText: text, extractionScore: 90, totalPages: 5, extractedPages: 5, deletionStatus: "ACTIVE",
          createdAt: new Date(at),
        },
      });
    }
  });

  after(async () => {
    await cleanupTender(prisma, tenderId);
    await cleanupUser(prisma, user.id);
  });

  it("the readiness snapshot computes the same hash promotion binds", async () => {
    const promoted = await computePersistedTenderAnalysisHash(prisma as never, tenderId, user.id);
    const snapshot = await getTenderReleaseSnapshot(prisma, tenderId, user.id);
    assert.ok(promoted);
    assert.equal(snapshot?.analysis.currentContentHash, promoted);
  });
});
