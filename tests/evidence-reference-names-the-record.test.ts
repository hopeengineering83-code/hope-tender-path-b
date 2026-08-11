// Seen live on the tender's Match Evidence panel: a mandatory requirement was
// reported as supported by
//
//   PROJECT  e6ed6bac-1811-49b8-a245-fe8f4c27411e, cccb66a6-699a-…, 324cd171-…
//
// The matching was fine — those were real, correctly selected project records.
// They were simply written to the compliance matrix as primary keys. Every
// other branch of the same builder already writes something checkable: a
// registration number, a fiscal year, an original file name. Only the expert
// and project branches wrote ids, and those are the two branches a reviewer
// most needs to read, because they are where the proposal claims particular
// people and particular past work.
//
// A compliance matrix a reviewer cannot read is not evidence, so this pins the
// reference to the record's own name, and pins the fallback: an id is better
// than an empty cell when a name is missing.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/engine/compliance.ts", "utf8");

describe("compliance evidence references name the record", () => {
  it("resolves expert and project references through the name lookups", () => {
    assert.match(
      source,
      /nameOrId\(expertNameById, match\.expertId\)/,
      "expert references must resolve to the expert's name",
    );
    assert.match(
      source,
      /nameOrId\(projectNameById, match\.projectId\)/,
      "project references must resolve to the project's name",
    );
  });

  it("no longer writes bare record ids as the reference", () => {
    // The exact expressions that produced the unreadable panel row.
    assert.doesNotMatch(source, /map\(\(match\) => match\.expertId\)/);
    assert.doesNotMatch(source, /map\(\(match\) => match\.projectId\)/);
  });

  it("falls back to the id rather than dropping the reference", () => {
    // A record with no name still has to be cited. Losing the reference
    // entirely would be worse than showing an id: the requirement would look
    // unsupported when it is not.
    assert.match(
      source,
      /const nameOrId = \(lookup: Map<string, string>, id: string\): string => lookup\.get\(id\) \|\| id;/,
      "the fallback must keep the id, not produce an empty reference",
    );
  });

  it("builds both lookups from the Company Vault records already in scope", () => {
    // Derived from the same knowledge the matcher used, so the panel and the
    // match cannot disagree about which record was cited.
    assert.match(source, /expertNameById = new Map<string, string>\(\s*knowledge\.experts\.map/);
    assert.match(source, /projectNameById = new Map<string, string>\(\s*knowledge\.projects\.map/);
  });
});
