// A model wrote "## B.1 Client References" with no "# Section B" heading, so
// the delivered proposal folded its experience into Section A and the
// contents page had no Section B (2026-10-06). The missing heading is restored
// before the first sub-section; nothing else moves.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { restoreMissingSectionHeadings } from "../lib/engine/restore-section-headings";
import { withoutTablelessExperienceSections } from "../lib/engine/benchmark-tables";

describe("a lettered sub-section keeps its section", () => {
  it("restores Section B before its first sub-section", () => {
    const md = "# Section A: Company Profile\n\n## A.1 Company Background\n\nText.\n\n## B.1 Client References\n\nRefs.\n\n## B.2 Project Portfolio\n\nCards.\n\n# Section C: Technical Approach\n\n## C.1 Understanding\n";
    const { markdown, restored } = restoreMissingSectionHeadings(md);
    assert.deepEqual(restored, ["Section B: Relevant Experience"]);
    const lines = markdown.split("\n");
    assert.equal(lines[lines.indexOf("## B.1 Client References") - 2], "# Section B: Relevant Experience");
    assert.equal(markdown.replace("# Section B: Relevant Experience\n\n", ""), md);
  });

  it("leaves a document that has its section headings unchanged", () => {
    for (const md of [
      "# Section A: Company Profile\n\n## A.1 X\n\n# Section B: Relevant Experience\n\n## B.1 Y\n",
      "# SECTION B: RELEVANT EXPERIENCE\n\n## B.1 Y\n",
      "# Cover Letter\n\nDear Committee,\n",
    ]) {
      const result = restoreMissingSectionHeadings(md);
      assert.equal(result.markdown, md);
      assert.deepEqual(result.restored, []);
    }
  });

  it("a writer's portfolio that only promises cards gives way to the record-built ones", () => {
    const md = "# Section B: Relevant Experience\n\n## B.1 Client References\n\nListed below.\n\n## B.2 Project Portfolio\n\nPresented below.\n\n# Section C: Technical Approach\n";
    const out = withoutTablelessExperienceSections(md, { references: true, portfolio: true });
    assert.equal(out, "# Section B: Relevant Experience\n\n# Section C: Technical Approach\n");
  });

  it("a writer's section that holds a table, even under a sub-heading, stays", () => {
    const md = "## B.2 Project Portfolio\n\nIntro.\n\n### Hospital X\n\n| Field | Detail |\n|---|---|\n| Client | Y |\n\n## B.3 Other\n";
    assert.equal(withoutTablelessExperienceSections(md, { references: true, portfolio: true }), md);
    assert.equal(withoutTablelessExperienceSections("## B.2 Project Portfolio\n\nPresented below.\n", { references: false, portfolio: false }), "## B.2 Project Portfolio\n\nPresented below.\n");
  });
});
