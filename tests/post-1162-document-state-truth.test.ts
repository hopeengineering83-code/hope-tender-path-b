import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("post-1162 document workspace truth", () => {
  it("uses one canonical document-plus-readiness loader for initial and post-review refreshes", () => {
    const source = read("app/dashboard/documents/page.tsx");

    assert.match(source, /async function fetchDocumentsWithReadiness\(\)/);
    assert.ok((source.match(/fetchDocumentsWithReadiness\(\)/g) ?? []).length >= 3);
    assert.doesNotMatch(source, /setTenders\(await res\.json\(\)\)/);
    assert.match(source, /READINESS_UNAVAILABLE/);
  });

  it("fails closed and warns when canonical readiness cannot be refreshed", () => {
    const source = read("app/dashboard/documents/page.tsx");

    assert.match(source, /canonicalBlockerCodes: \[READINESS_UNAVAILABLE\]/);
    assert.match(source, /canonical document and export status could not be refreshed/);
    assert.match(source, /role="alert"/);
  });

  it("uses truthful document-workspace language and stable keyed fragments", () => {
    const source = read("app/dashboard/documents/page.tsx");

    assert.match(source, /Proposal Documents/);
    assert.match(source, /aria-label="Proposal documents"/);
    assert.match(source, /<Fragment key=\{document\.id\}>/);
    assert.doesNotMatch(source, />Generated Documents</);
  });
});
