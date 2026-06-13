import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

describe("Tender UI Consolidation — legacy action removal", () => {
  const tenderDetailPath = path.join(process.cwd(), "app/dashboard/tenders/[id]/tender-detail.tsx");
  const tenderPagePath = path.join(process.cwd(), "app/dashboard/tenders/[id]/page.tsx");
  const hiderPath = path.join(process.cwd(), "components/legacy-tender-action-hider.tsx");
  const cleanerPath = path.join(process.cwd(), "components/generated-output-list-cleaner.tsx");

  it("LegacyTenderActionHider component has been deleted", () => {
    assert.strictEqual(existsSync(hiderPath), false, "legacy-tender-action-hider.tsx should be deleted");
  });

  it("GeneratedOutputListCleaner component has been deleted", () => {
    assert.strictEqual(existsSync(cleanerPath), false, "generated-output-list-cleaner.tsx should be deleted");
  });

  it("LegacyTenderActionHider is no longer imported or rendered in tender page", () => {
    const pageSource = readFileSync(tenderPagePath, "utf-8");
    assert.strictEqual(pageSource.includes("LegacyTenderActionHider"), false, "Page should not reference LegacyTenderActionHider");
    assert.strictEqual(pageSource.includes("legacy-tender-action-hider"), false, "Page should not reference legacy-tender-action-hider import path");
  });

  it("MutationObserver is not used for hiding buttons in TenderDetail or Page", () => {
    const detailSource = readFileSync(tenderDetailPath, "utf-8");
    const pageSource = readFileSync(tenderPagePath, "utf-8");

    // MutationObserver shouldn't be used for button hiding logic anymore.
    // It might be used for other things, but we search for patterns related to hiding.
    assert.ok(!detailSource.includes("MutationObserver") || !detailSource.includes("hidden"), "MutationObserver should not be coupled with hiding in TenderDetail");
    assert.ok(!pageSource.includes("MutationObserver"), "MutationObserver should not be in Tender Page");
  });

  it("TenderDetail no longer contains legacy action buttons", () => {
    const source = readFileSync(tenderDetailPath, "utf-8");
    const legacyActions = [
      'Run Engine"',
      'Generate Docs"',
      'ZIP Package"',
      '✦ AI Analyze"',
      '✦ Resume AI Analyze"',
      '✦ AI Proposal"',
      '✓ Validate"',
      'Running..."',
      'Generating..."',
      'Validating..."'
    ];

    for (const action of legacyActions) {
      assert.strictEqual(source.includes(action), false, `TenderDetail should not contain '${action}'`);
    }
  });

  it("TenderDetail no longer contains shadow calculations", () => {
    const source = readFileSync(tenderDetailPath, "utf-8");
    assert.strictEqual(source.includes("const canGenerateDocs"), false, "canGenerateDocs should be removed");
    assert.strictEqual(source.includes("const generateDisabledReason"), false, "generateDisabledReason should be removed");
    assert.strictEqual(source.includes("const zipDisabledReason"), false, "zipDisabledReason should be removed");
    assert.strictEqual(source.includes("const hasAnyGeneratedDoc"), false, "hasAnyGeneratedDoc should be removed");
  });

  it("Authoritative panels are still rendered in the main page with correct props", () => {
    const pageSource = readFileSync(tenderPagePath, "utf-8");
    assert.ok(pageSource.includes("EngineActionPanel"), "EngineActionPanel should be present");
    assert.ok(pageSource.includes("GenerationActionPanel"), "GenerationActionPanel should be present");
    assert.ok(pageSource.includes("FinalSubmissionControlCenter"), "FinalSubmissionControlCenter should be present");

    // Check Prop wiring
    assert.ok(pageSource.includes("readiness={generationReadiness}"), "GenerationActionPanel should receive readiness");
    assert.ok(pageSource.includes("canonicalReadiness={canonicalReadiness}"), "GenerationActionPanel should receive canonicalReadiness");
  });

  it("TenderDetail still renders essential non-duplicate actions", () => {
    const source = readFileSync(tenderDetailPath, "utf-8");
    assert.ok(source.includes('downloadDoc("proposal")'), "Proposal download should remain");
    assert.ok(source.includes('downloadDoc("requirements")'), "Requirements download should remain");
    assert.ok(source.includes('setEditing'), "Edit action should remain");
    assert.ok(source.includes('handleDelete'), "Delete action should remain");

    // Verify file upload and listing remain (checked by presence of some sub-components or props)
    // Actually, TenderDetail renders the file list and requirement panels.
    // Let's check for some keywords that suggest they are still there.
    assert.ok(source.includes('files.map'), "File listing should remain");
    assert.ok(source.includes('requirements.map') || source.includes('RequirementCoveragePanel'), "Requirements should remain");
  });

  it("The 'Authoritative actions' banner is removed", () => {
    const pageSource = readFileSync(tenderPagePath, "utf-8");
    assert.strictEqual(pageSource.includes("Authoritative actions:"), false, "The warning banner should be removed");
  });
});
