import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("PR #1175 CodeQL inline findings remain closed", () => {
  it("audits links with a positive scheme allowlist", () => {
    const source = read("e2e/pr1175-independent-release-audit.spec.ts");
    assert.match(source, /\["http", "https", "mailto", "tel"\]\.includes/);
    assert.match(source, /\|\| !permittedScheme/);
  });

  it("decodes XML entities once without chained unescaping", () => {
    const source = read("lib/engine/export-gap-repair.ts");
    assert.match(source, /replace\(\/&\(lt\|gt\|quot\|apos\|amp\);\/g, \(_match, name: string\) => entities\[name\]\)/);
    assert.doesNotMatch(source, /replace\(\/&lt;\/g[\s\S]{0,300}replace\(\/&amp;\/g/);
  });

  it("extracts DOCX text from bounded captures rather than tag stripping", () => {
    const source = read("lib/engine/tender-form-completion-gate.ts");
    assert.match(source, /<w:t\[\^>\]\*>\(\[\^<\]\*\)<\\\/w:t>/);
    assert.doesNotMatch(source, /replace\(\/<\[\^>\]\+>\/g/);
  });

  it("uses only static regular expressions for form fields and local fixture IDs", () => {
    const form = read("lib/engine/tender-form-completion-gate.ts");
    const localProvider = read("scripts/local-ai-provider.mjs");
    assert.doesNotMatch(form, /new RegExp\(/);
    assert.doesNotMatch(localProvider, /new RegExp\(/);
    assert.match(localProvider, /FILE_ID:\(\[0-9a-f\]/);
  });

  it("redacts every accumulated or fatal pre-deploy log value at its sink", () => {
    const source = read("scripts/verify-pre-deploy-safe.mjs");
    for (const value of ["p", "w", "b"]) {
      assert.match(source, new RegExp(`console\\.log\\(redact\\(${value}\\)\\)`));
    }
    assert.match(source, /console\.error\("Fatal error:", redact\(/);
  });
});
