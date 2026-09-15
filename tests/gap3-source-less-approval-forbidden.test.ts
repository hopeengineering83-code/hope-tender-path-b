// Gap 3 regression: source-less auto-approval is forbidden.
//
// No production route under app/api/company/ may:
//   - write `trustLevel: "REVIEWED"` (or `reviewedBy` / `reviewedAt`) without
//     a verified source document;
//   - fabricate provenance with `sourceContentHash: "manual"` or
//     `sourceTextHash: "manual"`;
//   - emit an `"Auto-approved"` note as a substitute for verified evidence;
//   - bypass the `SOURCE_REQUIRED_FOR_APPROVAL` guard in any approve path.
//
// A record without a verified source document stays UNVERIFIED. The user must
// upload the source document so the Engine can source-verify it automatically.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROUTES_ROOT = "app/api/company";

function listRouteFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try { stat = readdirSync(full); } catch {
      if (entry.endsWith("route.ts") && full.endsWith("route.ts")) out.push(full);
      continue;
    }
    if (Array.isArray(stat)) {
      out.push(...listRouteFiles(full));
    }
  }
  return out;
}

const ROUTE_FILES = listRouteFiles(ROUTES_ROOT);

const FORBIDDEN_PATTERNS: Array<{ name: string; regex: RegExp; reason: string }> = [
  {
    name: "fabricated sourceContentHash 'manual'",
    regex: /sourceContentHash:\s*"manual"|sourceContentHash:\s*ownedSource\?\.\w+\s*\?\?\s*"manual"/,
    reason: "fabricated provenance: sourceContentHash must never fall back to 'manual'",
  },
  {
    name: "fabricated sourceTextHash 'manual'",
    regex: /sourceTextHash:\s*"manual"/,
    reason: "fabricated provenance: sourceTextHash must never be 'manual'",
  },
  {
    name: "Auto-approved note",
    regex: /"Auto-approved[^"]*"/,
    reason: "fabricated approval note: an auto-approval note is invented provenance",
  },
  {
    name: "fabricated provenance object in fallback branch",
    regex: /(?:const durableProvenance|const verifiedProvenance)\s*=\s*provenance\?\.\s*ok\s*\?\s*provenance\s*:\s*\{[^}]*ok:\s*(?:true|true\s+as\s+const)/,
    reason: "fallback provenance construction: a non-ok provenance must trigger SOURCE_REQUIRED_FOR_APPROVAL, not a fabricated provenance object with ok:true",
  },
];

describe("Gap 3 — source-less auto-approval is forbidden everywhere", () => {
  it("inspects every app/api/company route file", () => {
    assert.ok(ROUTE_FILES.length >= 20, `expected to discover many company route files, got ${ROUTE_FILES.length}`);
  });

  for (const file of ROUTE_FILES) {
    it(`${file} contains no fabricated provenance or bypass`, () => {
      const src = readFileSync(file, "utf8");
      const codeOnly = src
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      for (const pattern of FORBIDDEN_PATTERNS) {
        assert.doesNotMatch(
          codeOnly,
          pattern.regex,
          `${file}: ${pattern.reason} (matched pattern "${pattern.name}")`,
        );
      }
    });
  }

  it("every approve path in [id]/route.ts declares SOURCE_REQUIRED_FOR_APPROVAL (when it can approve)", () => {
    // The five record types that have an approve action.
    const approveRoutes = [
      "app/api/company/experts/[id]/route.ts",
      "app/api/company/projects/[id]/route.ts",
      "app/api/company/legal-records/[id]/route.ts",
      "app/api/company/financial-records/[id]/route.ts",
      "app/api/company/compliance-records/[id]/route.ts",
    ];
    for (const route of approveRoutes) {
      const src = readFileSync(route, "utf8");
      assert.match(
        src,
        /SOURCE_REQUIRED_FOR_APPROVAL/,
        `${route}: an approve path must return SOURCE_REQUIRED_FOR_APPROVAL when no verified source exists`,
      );
    }
  });
});
