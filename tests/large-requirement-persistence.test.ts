// Targeted test: large tender requirement persistence must use batch
// operations (createMany + parallel updates), not sequential individual
// create/update calls that consume the transaction budget.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Large tender requirement persistence", () => {
  it("upsertRequirements collects creates into a batch array", () => {
    const src = read("lib/engine/stable-requirements.ts");
    assert.ok(
      src.includes("toCreate") && src.includes("toUpdate"),
      "upsertRequirements must split requirements into toCreate and toUpdate arrays for batch processing",
    );
  });

  it("upsertRequirements uses createMany for batch insertion", () => {
    const src = read("lib/engine/stable-requirements.ts");
    assert.ok(
      src.includes("tx.tenderRequirement.createMany"),
      "upsertRequirements must use tx.tenderRequirement.createMany for batch insertion",
    );
  });

  it("upsertRequirements uses Promise.all for batch updates", () => {
    const src = read("lib/engine/stable-requirements.ts");
    assert.ok(
      src.includes("Promise.all") && src.includes("toUpdate.map"),
      "upsertRequirements must use Promise.all(toUpdate.map(...)) for batch updates",
    );
  });

  it("upsertRequirements does NOT do individual create calls in a loop", () => {
    const src = read("lib/engine/stable-requirements.ts");
    assert.ok(
      !/for\s*\(.*\)\s*\{[^}]*await\s+tx\.tenderRequirement\.create\(/s.test(src),
      "upsertRequirements must NOT do individual create calls inside a for loop",
    );
  });

  it("upsertRequirements still deletes missing requirements", () => {
    const src = read("lib/engine/stable-requirements.ts");
    assert.ok(
      src.includes("deleteMany") && src.includes("toDelete"),
      "upsertRequirements must still delete missing requirements (deleteMissing option)",
    );
  });

  it("upsertRequirements preserves existing requirement IDs (update by match)", () => {
    const src = read("lib/engine/stable-requirements.ts");
    assert.ok(
      src.includes("existingMap") && src.includes("existingId"),
      "upsertRequirements must match existing requirements by normalized title+type to preserve IDs",
    );
  });
});
