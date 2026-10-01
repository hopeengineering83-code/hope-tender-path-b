// getTenderGenerationReadiness must not throw against the real Prisma client.
//
// It contained a guard meant to tolerate test mocks that do not implement
// $queryRaw:
//
//     const queryRaw = (client as …).$queryRaw;
//     … queryRaw ? await queryRaw`SELECT …`.catch(() => fallback) : fallback
//
// Detaching $queryRaw from the client loses its receiver. Prisma's
// implementation dereferences `this._createPrismaPromise`, so invoking the
// bare reference threw
//
//     TypeError: Cannot read properties of undefined (reading '_createPrismaPromise')
//
// and the `.catch()` beside it could not help: the throw happens synchronously
// while the tagged template is evaluated, before any promise exists. The guard
// therefore did exactly the opposite of its purpose — mocks (no $queryRaw)
// took the safe branch, and the real client crashed.
//
// app/api/tenders/[id]/download/route.ts:106 calls this function on the ZIP
// path unconditionally, so every final-package download answered
// 500 DOWNLOAD_ROUTE_RUNTIME_ERROR. The product's last step could not complete
// for any tender.
//
// Every unit test in the suite used a mock, which is precisely why none of
// them saw it. This one uses the real client.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { prisma, prismaReady } from "../lib/prisma";
import { getTenderGenerationReadiness } from "../lib/tender-generation-readiness";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

let userId: string;
let tenderId: string;

describe("getTenderGenerationReadiness against the real Prisma client", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.user.create({
      data: { email: `queryraw-${nonce}@example.test`, name: "QueryRaw Receiver", passwordHash: "h" },
    });
    userId = user.id;
    const tender = await prisma.tender.create({
      data: {
        userId,
        title: `QueryRaw Receiver ${nonce}`,
        clientName: "QueryRaw Procuring Authority",
        reference: `QR-${nonce}`,
        country: "Ethiopia",
        status: "DRAFT",
        stage: "TENDER_INTAKE",
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    tenderId = tender.id;
    await prisma.tenderFile.create({
      data: {
        tenderId,
        fileName: "rfp.txt",
        originalFileName: "rfp.txt",
        mimeType: "text/plain",
        size: 64,
        storagePath: "",
        extractedText: "REQUEST FOR PROPOSAL. Submit by email to procurement@example.test.",
        totalPages: 1,
      },
    });
  });

  after(async () => {
    await prisma.tenderFile.deleteMany({ where: { tenderId } });
    await prisma.tender.deleteMany({ where: { id: tenderId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("completes without throwing", async () => {
    // The regression. Before the fix this rejected with the
    // _createPrismaPromise TypeError rather than returning a readiness object.
    const readiness = await getTenderGenerationReadiness(prisma, userId, tenderId);
    assert.ok(readiness, "must return a readiness result");
    assert.ok(Array.isArray(readiness.blockers));
    assert.ok(Array.isArray(readiness.fullProposalBlockers));
  });

  it("runs the raw query on the client the caller passed in", async () => {
    // Scope note: the tests here cover the throw, which is what broke the ZIP
    // route. They do not prove extractedTextLength reaches every downstream
    // consumer — that value feeds assessTenderAnalysisQuality and is not
    // exposed on the result, so there is no honest assertion for it from out
    // here.
    //
    // What is assertable is that the query runs against the passed client. A
    // client whose $queryRaw is replaced with a throwing stub must surface as
    // the safe fallback rather than as a rejection, which is the tolerance the
    // original guard was reaching for and failed to deliver.
    const hostile = Object.create(prisma) as typeof prisma;
    Object.defineProperty(hostile, "$queryRaw", {
      value: () => { throw new Error("raw query unavailable"); },
      configurable: true,
    });

    const readiness = await getTenderGenerationReadiness(hostile, userId, tenderId);
    assert.ok(readiness, "a failing raw query must degrade, not reject");
  });

  it("is callable repeatedly — the receiver is not consumed", async () => {
    await getTenderGenerationReadiness(prisma, userId, tenderId);
    await getTenderGenerationReadiness(prisma, userId, tenderId);
  });
});
