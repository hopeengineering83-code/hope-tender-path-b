import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicApiSafe } from "../lib/assert-public-api-safe";

const endpoints = ["workflow-center", "runtime-readiness", "generation-readiness", "export-readiness", "readiness-score", "facts-ledger"];

test("key API contract snapshots stay safe and UI-stable", () => {
  for (const endpoint of endpoints) {
    const payload = {
      ok: false,
      endpoint,
      status: "blocked",
      severity: "HIGH",
      blockers: [],
      warnings: [],
      primaryNextAction: "Refresh and retry the readiness check.",
      diagnosticId: `diag_${endpoint}`,
      ...(endpoint === "export-readiness" ? { requiredDocuments: 0, generatedDocuments: 0, exportReadyDocuments: 0 } : {}),
    };
    assertPublicApiSafe(payload);
    assert.equal(typeof payload.ok, "boolean");
    assert.equal(typeof payload.status, "string");
    assert.equal(Array.isArray(payload.blockers), true);
    assert.equal(Array.isArray(payload.warnings), true);
    assert.equal(typeof payload.primaryNextAction, "string");
    assert.equal(typeof payload.diagnosticId, "string");
  }
});
