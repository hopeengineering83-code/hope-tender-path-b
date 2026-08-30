/**
 * A document that ships must not tell the reader to finish writing it.
 *
 * Found by driving the owner contract exactly as specified - upload, Run AI
 * Analyze, Run Engine, then nothing but the durable worker - and opening the
 * ZIP that came out. Two of the three documents inside contained:
 *
 *   "Draft technical response"
 *   "This document has been generated ... It is a working draft for review,
 *    validation, and final approval before export."
 *   "Proposed response structure"
 *   "Reviewer completion checklist"
 *   "Replace this draft with the final generated narrative or complete the
 *    draft manually before marking READY_FOR_EXPORT."
 *   "Run document validation again after editing and before final ZIP
 *    packaging."
 *
 * That is a worksheet addressed to the bid team, inside the Final ZIP, on its
 * way to a procuring entity.
 *
 * The generate route had already fixed this for the path an owner clicks
 * through - it materialises the planned rows so they are written from vault
 * evidence, and its own comment calls the worksheet "worse than nothing ...
 * shipped to the procuring entity as the company profile, carrying no company
 * information at all". The automatic chain calls
 * lib/engine/missing-plan-file-generation.ts directly and never reaches that
 * code, so the fix existed on the path that is optional and not on the one the
 * owner contract makes normal.
 *
 * The instructions are removed rather than reworded: there is no phrasing of
 * "replace this draft" that belongs in a document an evaluator opens. What
 * remains is the tender's own requirements and the company's own
 * source-verified evidence, or an honest line saying a section has none.
 *
 * Requires RUN_DB_INTEGRATION=true. Skips cleanly otherwise.
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const dbDescribe = RUN_DB ? describe : describe.skip;

/** Text that is addressed to whoever is preparing the bid, not to the client. */
const INTERNAL_INSTRUCTION_PATTERNS: Array<[string, RegExp]> = [
  ["replace this draft", /replace this draft/i],
  ["before marking READY_FOR_EXPORT", /before marking READY_FOR_EXPORT/i],
  ["reviewer completion checklist", /reviewer completion checklist/i],
  ["working draft for review", /working draft for review/i],
  ["proposed response structure", /proposed response structure/i],
  ["run document validation again", /run document validation again/i],
  ["complete the draft manually", /complete the draft manually/i],
  ["re-run AI Analyze", /re-?run AI Analyze/i],
  ["before final approval", /before final approval/i],
  ["before final ZIP packaging", /before final zip packaging/i],
];

dbDescribe("automatically generated plan files carry no internal instructions", () => {
  const { PrismaClient } = require("@prisma/client");
  const { randomUUID } = require("node:crypto");
  const { generateMissingPlanFiles } = require("../lib/engine/missing-plan-file-generation");

  const prisma = new PrismaClient();
  let userId = "";
  let tenderId = "";

  before(async () => {
    const user = await prisma.user.create({
      data: {
        name: "Instruction Owner",
        email: `instruction-owner+${Date.now()}@example.test`,
        passwordHash: "x",
        role: "ADMIN",
      },
    });
    userId = user.id;
    await prisma.company.create({ data: { userId, name: "Instruction Works" } });
    const tender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        userId,
        title: "Design Review and Technical Audit of Rural Water Supply Schemes",
        clientName: "Awash Water Works Design and Supervision Enterprise",
        status: "ACTIVE",
      },
    });
    tenderId = tender.id;
    await prisma.tenderRequirement.createMany({
      data: [
        {
          tenderId,
          title: "Company profile",
          description: "The Consultant shall submit a company profile describing its organisation and relevant experience.",
          requirementType: "ELIGIBILITY",
          priority: "MANDATORY",
        },
        {
          tenderId,
          title: "Capability statement",
          description: "The Consultant shall submit a capability statement describing its technical approach.",
          requirementType: "TECHNICAL",
          priority: "MANDATORY",
        },
      ],
    });
  });

  after(async () => {
    if (tenderId) await prisma.generatedDocument.deleteMany({ where: { tenderId } }).catch(() => {});
    if (tenderId) await prisma.tenderRequirement.deleteMany({ where: { tenderId } }).catch(() => {});
    if (tenderId) await prisma.tender.delete({ where: { id: tenderId } }).catch(() => {});
    if (userId) await prisma.company.deleteMany({ where: { userId } }).catch(() => {});
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect().catch(() => {});
  });

  /** Visible text of a base64 DOCX. */
  async function visibleText(base64: string): Promise<string> {
    const { execFileSync } = require("node:child_process");
    const { writeFileSync, mkdtempSync } = require("node:fs");
    const { join } = require("node:path");
    const { tmpdir } = require("node:os");
    const dir = mkdtempSync(join(tmpdir(), "docx-"));
    const file = join(dir, "d.docx");
    writeFileSync(file, Buffer.from(base64, "base64"));
    const xml = execFileSync("python3", [
      "-c",
      "import sys,zipfile;print(zipfile.ZipFile(sys.argv[1]).read('word/document.xml').decode())",
      file,
    ]).toString();
    return xml.replace(/<[^>]+>/g, " ");
  }

  it("writes the company-produced files without a reviewer worksheet", async () => {
    // The module writes rows for planned files that do not exist yet. It is
    // called here exactly as lib/ai-jobs/auto-finalize-continuation-service.ts
    // calls it on the automatic path.
    const result = await generateMissingPlanFiles({
      prisma,
      tenderId,
      userId,
      actorLabel: "machine:test",
    });
    // The gates ahead of file creation (confirmed Build Plan, generation gate)
    // may legitimately refuse this minimal fixture; what must never happen is a
    // file being written WITH the instructions. So the assertion runs over
    // whatever rows exist afterwards.
    void result;

    const docs = await prisma.generatedDocument.findMany({
      where: { tenderId },
      select: { exactFileName: true, name: true, fileContent: true },
    });

    for (const doc of docs) {
      if (!doc.fileContent) continue;
      const text = await visibleText(doc.fileContent);
      for (const [label, pattern] of INTERNAL_INSTRUCTION_PATTERNS) {
        assert.ok(
          !pattern.test(text),
          `${doc.exactFileName ?? doc.name} ships to the procuring entity and must not contain "${label}"`,
        );
      }
    }
  });

  it("keeps the instruction text out of the writer itself", async () => {
    // The behavioural case above only sees files the gates allowed to be
    // written. This one pins the source, so the worksheet cannot come back for
    // a tender shaped differently from the fixture.
    const source = require("node:fs").readFileSync("lib/engine/missing-plan-file-generation.ts", "utf8");
    const writer = source.slice(source.indexOf("async function narrativeDraftContent"));
    const body = writer.slice(0, writer.indexOf("\nasync function ", 10) + 1 || undefined);
    for (const [label, pattern] of INTERNAL_INSTRUCTION_PATTERNS) {
      // The doc comment above the function quotes the removed strings on
      // purpose, so only the function body is searched.
      const code = body.replace(/\/\*\*[\s\S]*?\*\//g, "");
      assert.ok(
        !pattern.test(code),
        `the writer must not emit "${label}" into a document that ships`,
      );
    }
  });

  it("still names the tender's own requirements", async () => {
    // Removing the instructions must not leave an empty file: the requirements
    // the tender itself states are real content and stay.
    const source = require("node:fs").readFileSync("lib/engine/missing-plan-file-generation.ts", "utf8");
    const writer = source.slice(source.indexOf("async function narrativeDraftContent"));
    assert.match(writer, /Tender requirements addressed/);
    assert.match(writer, /matchingRequirements\(fileName, requirements\)/);
  });

  it("quotes company evidence only through the vault guard", async () => {
    // A stale, unverified or soft-deleted record must not be quoted as
    // evidence in a submittable document.
    const source = require("node:fs").readFileSync("lib/engine/missing-plan-file-generation.ts", "utf8");
    assert.match(source, /canUseVaultRecord\(m\.expert, "GENERATION"\)/);
    assert.match(source, /canUseVaultRecord\(m\.project, "GENERATION"\)/);
    assert.match(source, /!m\.expert\.deletedAt/);
    assert.match(source, /!m\.project\.deletedAt/);
  });
});
