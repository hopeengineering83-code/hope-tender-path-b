import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AIEnvironmentVariableStatusList,
  groupEnvironmentVariables,
} from "../components/ai-environment-variable-status";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("post-1162 UI truth and responsive contracts", () => {
  it("renders complete variable truth in both desktop and mobile views", () => {
    const variables = [
      { name: "OCR_KEY", present: false, scope: "ocr" as const, severity: "recommended" as const, note: "OCR purpose" },
      { name: "AI_KEY_WITH_A_VERY_LONG_UNBROKEN_NAME", present: true, scope: "ai" as const, severity: "critical" as const, note: "AI purpose" },
    ];
    const html = renderToStaticMarkup(
      React.createElement(AIEnvironmentVariableStatusList, { variables }),
    );

    assert.match(html, /aria-label="Environment variables"/);
    assert.match(html, /aria-label="Environment variables by scope"/);
    assert.equal((html.match(/AI_KEY_WITH_A_VERY_LONG_UNBROKEN_NAME/g) ?? []).length, 2);
    assert.equal((html.match(/OCR_KEY/g) ?? []).length, 2);
    assert.match(html, /<dt[^>]*>Scope<\/dt>/);
    assert.match(html, /<dt[^>]*>Severity<\/dt>/);
    assert.match(html, /<dt[^>]*>Purpose<\/dt>/);
    assert.match(html, /break-all/);
    assert.match(html, /min-h-11/);
    assert.match(html, />SET<\/span>/);
    assert.match(html, />MISSING<\/span>/);
  });

  it("groups variables in a stable product order without Object.groupBy", () => {
    const groups = groupEnvironmentVariables([
      { name: "SESSION_SECRET", present: true, scope: "auth", severity: "critical", note: "Auth" },
      { name: "DATABASE_URL", present: true, scope: "database", severity: "critical", note: "DB" },
      { name: "AI_KEY", present: true, scope: "ai", severity: "critical", note: "AI" },
    ]);

    assert.deepEqual(groups.map((group) => group.scope), ["ai", "database", "auth"]);
    assert.deepEqual(groups.map((group) => group.variables[0]?.name), ["AI_KEY", "DATABASE_URL", "SESSION_SECRET"]);
  });

  it("does not label planned and empty document workspaces as generated", () => {
    const page = source("app/dashboard/documents/page.tsx");

    assert.doesNotMatch(page, />Generated Documents<\/h1>/);
    assert.match(page, />Proposal Documents<\/h1>/);
    assert.match(page, /No proposal document workspaces are available yet/);
  });

  it("labels root links as home navigation", () => {
    for (const path of ["app/not-found.tsx", "app/error.tsx"]) {
      const page = source(path);
      assert.match(page, /href="\/"/);
      assert.match(page, /Return home/);
      assert.doesNotMatch(page, /Return to dashboard/);
    }
  });
});
