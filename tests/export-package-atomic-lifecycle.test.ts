import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/tenders/[id]/export/route.ts", "utf8");

describe("export preparation atomic lifecycle authority", () => {
  it("creates the READY package and moves the tender to EXPORTED in one transaction", () => {
    const start = source.indexOf("const exportPackage = await prisma.$transaction");
    const end = source.indexOf("await logAction", start);
    assert.ok(start >= 0 && end > start, "canonical export transaction must exist before the audit event");
    const transaction = source.slice(start, end);
    assert.match(transaction, /tx\.exportPackage\.updateMany/);
    assert.match(transaction, /tx\.exportPackage\.create/);
    assert.match(transaction, /tx\.tender\.update/);
    assert.match(transaction, /where:\s*\{\s*id,\s*userId\s*\}/);
    assert.match(transaction, /data:\s*\{\s*status:\s*"EXPORTED",\s*stage:\s*"EXPORT"\s*\}/);
    assert.equal((transaction.match(/prisma\.\$transaction/g) ?? []).length, 1);
  });

  it("does not persist a READY package in a transaction separate from the tender lifecycle update", () => {
    const exportTail = source.slice(source.indexOf("const generatedFileNames"));
    assert.equal((exportTail.match(/await prisma\.\$transaction/g) ?? []).length, 1);
    assert.doesNotMatch(exportTail, /data:\s*\{\s*\}/);
  });
});
