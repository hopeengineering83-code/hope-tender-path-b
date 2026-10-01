import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { injectMethodologyTables } from "../lib/engine/methodology-tables";

/**
 * Run 36074770709 delivered two risk registers in C.8: the sector register,
 * emitted as "## C.5 Risk Register and Mitigation Strategy", and a generic
 * one appended beneath it. The injector's presence check, /^##\s+Risk\s+
 * Register/, could not see past the section number, so it judged the register
 * missing and added its own. Headings are now also compared with their
 * numbers removed.
 */

const OPTS = { primarySector: "Healthcare", experts: [], projects: [] };

function registers(markdown: string): number {
  return (markdown.match(/^#{2,4}\s+(?:[A-Z]\.\d+(?:\.\d+)*\s+)?Risk\s+Register\b/gim) ?? []).length;
}

describe("a proposal carries one risk register", () => {
  it("sees a numbered register heading and adds no second register", () => {
    const md = "# Section C: Methodology\n\n## C.5 Risk Register and Mitigation Strategy\n\n| Risk | Mitigation |\n|---|---|\n| Late approvals | Early submission |\n";
    const result = injectMethodologyTables(md, OPTS);
    assert.deepEqual(result.injected.find((i) => i.key === "risk-register"), { key: "risk-register", reason: "SKIPPED_PRESENT" });
    assert.equal(registers(result.markdown), 1);
  });

  it("sees a register under a 'Section C.5:' style heading", () => {
    const md = "# Section C: Methodology\n\n### Section C.5: Risk Register\n\nRisks.\n";
    const result = injectMethodologyTables(md, OPTS);
    assert.equal(result.injected.find((i) => i.key === "risk-register")?.reason, "SKIPPED_PRESENT");
  });

  it("still adds the register when the proposal has none", () => {
    const md = "# Section C: Methodology\n\n## C.1 Approach\n\nText.\n";
    const result = injectMethodologyTables(md, OPTS);
    assert.equal(result.injected.find((i) => i.key === "risk-register")?.reason, "MISSING");
    assert.equal(registers(result.markdown), 1);
  });
});
