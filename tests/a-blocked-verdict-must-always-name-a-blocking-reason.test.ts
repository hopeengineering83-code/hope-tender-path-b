import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveCurrentDocumentVerdict } from "../lib/engine/current-document-quality";
import { validateDocumentQuality } from "../lib/engine/document-quality-validator";
import { exportBlockReason } from "../lib/engine/document-output-state";

/**
 * THE DEFECT.
 * -----------
 * The previous commit made the export blocker carry the verdict's own reasons
 * instead of a fixed sentence naming the narrative rubric. Reading the code
 * that produces those reasons showed the fix was incomplete: two of the
 * conditions that BLOCK a document emit no HIGH-severity reason at all, and
 * every consumer filters to HIGH to report why an export was refused.
 *
 *   1. `validateDocumentQuality` blocks at `boilerplateHits.length >= 5`, but
 *      the only thing it emitted for boilerplate was a MEDIUM qualityWarning at
 *      >= 3. A document blocked solely on boilerplate density therefore had a
 *      BLOCKED verdict with zero HIGH reasons.
 *
 *   2. The narrative rubric returns QUALITY_FAILED when
 *      `severityFromScore(score) === "FAILED"` — score < 35 — even when every
 *      contributing issue is MEDIUM or LOW.
 *
 * In both cases the owner would have read "this document is blocked" and
 * nothing else: the same dead end the misattributed rubric sentence created,
 * reached by a different route.
 *
 * Both are ordinary defects, not tender-specific ones. The fixtures below are a
 * municipal water utility and a rail signalling assignment precisely so the
 * behaviour is pinned on documents from sectors this app has never been tuned
 * for.
 */
describe("a blocked verdict must always name a blocking reason", () => {
  // A competent, specific proposal body. Nothing here is a placeholder, an AI
  // trace, an empty body or an envelope mismatch — so anything that blocks it
  // has to be the density rule.
  const waterUtilityBody = [
    "# Understanding of the Assignment",
    "The Directorate seeks a condition assessment of 412 km of ductile iron distribution main",
    "across the northern pressure zone, together with a leakage reduction programme targeting",
    "non-revenue water below 18 percent within 30 months.",
    "",
    "# Technical Approach and Methodology",
    "We apply best practices in district metered area design, dividing the network into 26 DMAs",
    "sized between 800 and 2,500 connections. Our team of qualified professionals will install",
    "permanent acoustic loggers at 1,100 points. The firm has a proven track record in stepped",
    "pressure testing and brings state-of-the-art correlating equipment to night-flow analysis.",
    "Our innovative solutions for transient monitoring reduce burst frequency, and we look forward",
    "to the opportunity to discuss the phasing with the Directorate.",
    "",
    "# Work Plan",
    "Mobilisation runs weeks 1-4, baseline measurement weeks 5-16, and intervention weeks 17-120.",
  ].join("\n");

  const waterUtilityDoc = {
    id: "doc-water-1",
    name: "Technical Proposal",
    exactFileName: "Technical Proposal.md",
    format: "md",
    documentType: "TECHNICAL_PROPOSAL",
    fileContent: waterUtilityBody,
    storagePath: null,
    generationStatus: "GENERATED",
    validationStatus: "PENDING",
    reviewStatus: "PENDING",
  };

  it("counts the boilerplate density rule as a blocking condition of the validator", () => {
    const validation = validateDocumentQuality({
      name: waterUtilityDoc.name,
      documentType: waterUtilityDoc.documentType,
      fileContent: waterUtilityDoc.fileContent,
      storagePath: null,
      visibleText: waterUtilityBody,
    });
    assert.ok(
      validation.boilerplateHits.length >= 5,
      `fixture must trip the density rule; got ${validation.boilerplateHits.length}: ${validation.boilerplateHits.join(", ")}`,
    );
    assert.equal(validation.status, "BLOCKED");
    // Nothing else may be responsible, or this fixture is not testing density.
    assert.deepEqual(validation.placeholders, []);
    assert.deepEqual(validation.aiTrace, []);
    assert.equal(validation.envelopeMismatch, null);
    assert.equal(validation.isEmpty, false);
  });

  it("reports the phrase it matched, not a mangled regex source", () => {
    const validation = validateDocumentQuality({
      name: waterUtilityDoc.name,
      documentType: waterUtilityDoc.documentType,
      fileContent: waterUtilityDoc.fileContent,
      storagePath: null,
      visibleText: waterUtilityBody,
    });
    for (const hit of validation.boilerplateHits) {
      // The shipped behaviour stripped regex metacharacters off `re.source`,
      // turning /\bbest practices\b/i into "bbest practicesb" — a string that
      // appears nowhere in the document the owner is being asked to fix.
      assert.ok(
        waterUtilityBody.toLowerCase().includes(hit.toLowerCase()),
        `reported hit ${JSON.stringify(hit)} does not appear in the document text`,
      );
    }
    assert.ok(validation.boilerplateHits.some((hit) => /best practices/i.test(hit)));
  });

  it("names the density rule as a HIGH reason on the verdict", async () => {
    const verdict = await resolveCurrentDocumentVerdict(waterUtilityDoc, [], {
      selectedExpertNames: ["A. Okonkwo"],
      selectedProjectNames: ["Northern Zone NRW Reduction"],
    });
    assert.equal(verdict.score, "BLOCKED");
    const high = verdict.reasons.filter((reason) => reason.severity === "HIGH");
    assert.ok(high.length > 0, "a BLOCKED verdict must carry at least one HIGH reason");
    const density = high.find((reason) => reason.code === "BOILERPLATE_DENSITY");
    assert.ok(density, `expected BOILERPLATE_DENSITY among ${high.map((r) => r.code).join(", ")}`);
    // It must quote what to fix, not merely count.
    assert.match(density.message, /best practices/i);
  });

  it("does not report the same finding twice, once HIGH and once MEDIUM", async () => {
    const verdict = await resolveCurrentDocumentVerdict(waterUtilityDoc);
    const boilerplateReasons = verdict.reasons.filter((reason) =>
      /boilerplate/i.test(reason.message) || reason.code === "BOILERPLATE_DENSITY");
    assert.equal(
      boilerplateReasons.length,
      1,
      `boilerplate stated ${boilerplateReasons.length} times: ${boilerplateReasons.map((r) => `${r.severity}/${r.code}`).join(", ")}`,
    );
    assert.equal(boilerplateReasons[0].severity, "HIGH");
  });

  it("holds the invariant for every blocked document, whichever authority refused", async () => {
    // A rail signalling document that is blocked for a different reason
    // entirely, plus a body thin enough to fail the narrative rubric on score.
    const railDocs = [
      {
        id: "doc-rail-empty",
        name: "Technical Proposal",
        exactFileName: "Technical Proposal.md",
        format: "md",
        documentType: "TECHNICAL_PROPOSAL",
        fileContent: "Interlocking upgrade.",
        storagePath: null,
        generationStatus: "GENERATED",
        validationStatus: "PENDING",
        reviewStatus: "PENDING",
      },
      {
        id: "doc-rail-thin",
        name: "Technical Proposal",
        exactFileName: "Technical Proposal.md",
        format: "md",
        documentType: "TECHNICAL_PROPOSAL",
        fileContent: [
          "# Understanding of the Assignment",
          "We will upgrade the interlocking at Junction 7 and renew 14 point machines.",
          "# Technical Approach and Methodology",
          "Standard methods will be applied throughout the works programme.",
        ].join("\n"),
        storagePath: null,
        generationStatus: "GENERATED",
        validationStatus: "PENDING",
        reviewStatus: "PENDING",
      },
      waterUtilityDoc,
    ];

    let blockedSeen = 0;
    for (const doc of railDocs) {
      const verdict = await resolveCurrentDocumentVerdict(doc);
      if (verdict.score !== "BLOCKED") continue;
      blockedSeen += 1;
      const high = verdict.reasons.filter((reason) => reason.severity === "HIGH");
      assert.ok(
        high.length > 0,
        `${doc.id} is BLOCKED but names no HIGH reason; reasons were ${JSON.stringify(verdict.reasons)}`,
      );
    }
    // Vacuity guard: the loop must actually have exercised blocked documents.
    assert.ok(blockedSeen >= 2, `expected at least 2 blocked fixtures, saw ${blockedSeen}`);
  });

  it("carries a named rule all the way into the export blocker", async () => {
    const verdict = await resolveCurrentDocumentVerdict(waterUtilityDoc);
    // Exactly the projection lib/engine/final-package-readiness-model.ts builds.
    const qualityBlockReasons = verdict.reasons
      .filter((reason) => reason.severity === "HIGH")
      .map((reason) => (reason.code ? `[${reason.code}] ${reason.message}` : reason.message));

    const reason = exportBlockReason("QUALITY_BLOCKED", { qualityBlockReasons });
    assert.ok(reason);
    assert.match(reason, /BOILERPLATE_DENSITY/);
    // The two dead ends this whole area exists to prevent.
    assert.equal(/failed the canonical narrative-quality rubric/.test(reason), false);
    assert.equal(/blocking reasons were not supplied/.test(reason), false);
  });

  it("leaves a clean document clean — the rules did not simply start blocking everything", async () => {
    const cleanBody = [
      "# Understanding of the Assignment",
      "The Authority requires resignalling of 38 route-km between Junction 7 and the port branch,",
      "replacing 1980s relay interlocking with a computer-based interlocking rated SIL 4.",
      "",
      "# Technical Approach and Methodology",
      "We begin with a signalling principles review against the Authority's own scheme plan,",
      "then produce interlocking data, a correlation survey of 212 lineside assets, and staged",
      "commissioning across four possessions. Testing follows the Authority's specified",
      "independent tester regime, with 100 percent function testing before each possession.",
      "",
      "# Work Plan",
      "Design weeks 1-22, factory acceptance weeks 23-30, staged commissioning weeks 31-58.",
      "",
      "# Team Composition",
      "A. Okonkwo leads as Signalling Design Manager; R. Petrov acts as independent tester.",
    ].join("\n");

    const verdict = await resolveCurrentDocumentVerdict(
      { ...waterUtilityDoc, id: "doc-rail-clean", fileContent: cleanBody },
      [],
      { selectedExpertNames: ["A. Okonkwo", "R. Petrov"], selectedProjectNames: [] },
    );
    const density = verdict.reasons.find((reason) => reason.code === "BOILERPLATE_DENSITY");
    assert.equal(density, undefined, "a specific document must not be accused of boilerplate");
    const unattributed = verdict.reasons.find((reason) => reason.code === "QUALITY_BLOCKED_UNATTRIBUTED");
    assert.equal(unattributed, undefined, "the fail-safe must not fire on a document nothing refused");
  });
});
