// A tender-page poll does not download the Company Vault.
//
// After the 2026-10-08 fix a poll no longer read stored file bodies, but it
// still re-checked the selected experts' and projects' provenance against
// their source documents' full text on every poll. Measured through a
// byte-counting proxy with an ordinary vault (a CV compilation and a project
// portfolio, ~0.4 MB of text each), one /workflow-center poll still moved
// ~1 MB out of Postgres — ~120 MB an hour for one idle tab.
//
// Status reads now take stored texts through the stored-text cache: Postgres
// hashes the text, and the text itself moves only when this instance does not
// hold that exact version. This pins the bytes a warm poll reads, that a
// changed text is never served stale, and that the verdicts are unchanged.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import { executeTenderDeletion } from "../lib/tender/delete-tender";
import { getTenderReleaseSnapshot } from "../lib/engine/tender-release-snapshot";
import { getCanonicalTenderWorkflowState } from "../lib/engine/workflow/workflow-state";
import { getCanonicalTenderWorkflowDecision } from "../lib/engine/canonical-workflow-decision";
import { getCompanyIngestionReadiness } from "../lib/company-ingestion-readiness";
import { clearStoredTextCache, loadStoredTexts, storedTextCacheStats } from "../lib/stored-text-cache";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

const CV_MARKER = "CV-MARKER-7f3a";
const cvText = `${CV_MARKER} CURRICULUM VITAE. Name of expert: A. Proposed position: Structural Engineer. Professional experience: design of buildings. `.repeat(3000);
const portfolioText = "Project name: Regional office. Client name: Ministry. Scope of services: design and supervision. ".repeat(3500);

let userId = "";
let companyId = "";
let tenderId = "";
let cvId = "";

function counting() {
  const tally = { bytes: 0, sawVaultText: false };
  const client = (prisma as any).$extends({ query: { $allModels: { async $allOperations({ args, query }: any) {
    const result = await query(args);
    const json = JSON.stringify(result ?? null, (_k, v) => (typeof v === "bigint" ? String(v) : v));
    tally.bytes += Buffer.byteLength(json);
    if (json.includes(CV_MARKER)) tally.sawVaultText = true;
    return result;
  } } } });
  return { client, tally };
}

async function poll(client: any) {
  const snapshot = await getTenderReleaseSnapshot(client, tenderId, userId);
  await Promise.all([
    getCanonicalTenderWorkflowState(client, userId, tenderId),
    getCanonicalTenderWorkflowDecision(client, userId, tenderId, snapshot),
  ]);
  return snapshot!;
}

describe("a poll does not download the Company Vault — real PostgreSQL", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.user.create({ data: { email: `poll-vault-${nonce}@example.test`, name: "Poll", passwordHash: "h", company: { create: { name: "Firm" } } }, include: { company: true } });
    userId = user.id;
    companyId = user.company!.id;
    cvId = (await prisma.companyDocument.create({ data: { companyId, fileName: "cvs.pdf", originalFileName: "cvs.pdf", mimeType: "application/pdf", size: 1, category: "EXPERT_CV", extractedText: cvText } })).id;
    const pf = await prisma.companyDocument.create({ data: { companyId, fileName: "portfolio.pdf", originalFileName: "portfolio.pdf", mimeType: "application/pdf", size: 1, category: "PORTFOLIO", extractedText: portfolioText } });
    const experts = await Promise.all(Array.from({ length: 6 }, (_, i) => prisma.expert.create({ data: { companyId, fullName: `Expert ${i}`, title: "Structural Engineer", sourceDocumentId: cvId, trustLevel: "SOURCE_VERIFIED" } })));
    const projects = await Promise.all(Array.from({ length: 5 }, (_, i) => prisma.project.create({ data: { companyId, name: `Project ${i}`, sourceDocumentId: pf.id, trustLevel: "SOURCE_VERIFIED" } })));
    tenderId = (await prisma.tender.create({ data: {
      userId, title: `Poll vault ${nonce}`, status: "GENERATED", stage: "GENERATION", country: "Ethiopia",
      files: { create: [{ fileName: "tor.pdf", originalFileName: "tor.pdf", mimeType: "application/pdf", size: 1, extractedText: "The consultant shall design the building. ".repeat(800) }] },
      expertMatches: { create: experts.map((e, i) => ({ expertId: e.id, score: 90 - i, isSelected: true })) },
      projectMatches: { create: projects.map((p, i) => ({ projectId: p.id, score: 90 - i, isSelected: true })) },
    } })).id;
  });

  after(async () => {
    await prisma.$transaction((tx) => executeTenderDeletion(tx, tenderId, "poll-vault-test", userId));
    await prisma.expert.deleteMany({ where: { companyId } });
    await prisma.project.deleteMany({ where: { companyId } });
    await prisma.companyDocument.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("a warm poll reads kilobytes and no vault text; the verdict is the cold poll's", async () => {
    clearStoredTextCache();
    const cold = counting();
    const first = await poll(cold.client);
    assert.ok(cold.tally.bytes > 500_000, `the first poll on a cold instance reads the texts once (${cold.tally.bytes} bytes)`);

    const warm = counting();
    const second = await poll(warm.client);
    assert.equal(warm.tally.sawVaultText, false, "no vault text is downloaded by a warm poll");
    assert.ok(warm.tally.bytes < 120_000, `a warm poll read ${warm.tally.bytes} bytes`);
    assert.deepEqual(second.vault, first.vault, "the vault verdict is the same");
    assert.deepEqual(second.extraction, first.extraction, "the extraction verdict is the same");
  });

  it("a changed text is downloaded again, never served from the cache", async () => {
    await loadStoredTexts(prisma, "CompanyDocument", [cvId]);
    await prisma.companyDocument.update({ where: { id: cvId }, data: { extractedText: `${cvText} Revised.` } });
    const before = storedTextCacheStats.downloadedRows;
    const texts = await loadStoredTexts(prisma, "CompanyDocument", [cvId]);
    assert.ok(texts.get(cvId)!.endsWith("Revised."));
    assert.equal(storedTextCacheStats.downloadedRows, before + 1);
    await prisma.companyDocument.update({ where: { id: cvId }, data: { extractedText: null } });
    assert.equal((await loadStoredTexts(prisma, "CompanyDocument", [cvId])).get(cvId), null, "a cleared text reads as none");
    await prisma.companyDocument.update({ where: { id: cvId }, data: { extractedText: cvText } });
  });

  it("company readiness reads the vault through the same cache", async () => {
    await getCompanyIngestionReadiness(companyId, {}, prisma);
    const warm = counting();
    const readiness = await getCompanyIngestionReadiness(companyId, {}, warm.client);
    assert.equal(warm.tally.sawVaultText, false);
    assert.equal(readiness.totals.documents, 2);
    assert.equal(readiness.totals.usefulDocuments, 2, "the texts are still read and judged");
  });

  it("a client without raw queries downloads the text, as before", async () => {
    const plain = { companyDocument: { findMany: (args: any) => prisma.companyDocument.findMany(args) } };
    const texts = await loadStoredTexts(plain, "CompanyDocument", [cvId]);
    assert.ok(texts.get(cvId)!.startsWith(CV_MARKER));
  });
});
