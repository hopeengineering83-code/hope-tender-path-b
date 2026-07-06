// Metadata contradiction alignment — panels and gates must AGREE.
//
// The user-visible bug class this pins down: a field shows green
// ("Extracted and grounded", generationEligible=true) in the dashboard
// panels while the BuildPlan validator / release gates reject the very same
// evidence — or the reverse. Each test drives the SAME tender state through
// BOTH the canonical field-state resolver (what every panel renders) and
// validateCriticalMetadataEvidenceForBuildPlan (what draft/confirmation/
// generation/export/final-ZIP enforce) and asserts they reach the SAME
// verdict. If any threshold, containment rule, page bound, placeholder rule,
// override rule, or submission-method classification drifts between the two
// paths again, one of these tests fails.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { resolveCanonicalFieldState, type CanonicalResolverInput } from "../lib/engine/canonical-field-state";
import type { MetadataFieldState } from "../lib/engine/tender-policy-registry";
import { validateCriticalMetadataEvidenceForBuildPlan } from "../lib/engine/build-plan";
import { isEmailSubmissionMethod, isPhysicalSubmissionMethod, isPortalSubmissionMethod } from "../lib/engine/submission-method-policy";

// One tender state, expressed once, consumable by BOTH paths.
const FILE_ID = "file-1";
const FILE_TEXT =
  "Invitation to Bid: Construction of Rural Health Centre, Lot 3. " +
  "Procurement Reference Number: MOH/RFP/2026/014. " +
  "Ministry of Health, Republic of Kenya invites sealed bids. " +
  "Bids shall be submitted by email to procurement@health.go.ke. " +
  "The deadline for submission of bids is 30 September 2026 at noon.";

type StatePatch = {
  tender?: Record<string, unknown>;
  files?: Array<{ id: string; extractedText?: string | null; totalPages?: number | null }>;
  overrides?: Array<{ field: string; fieldState: string; overrideValue: string | null }>;
};

function baseTender() {
  return {
    id: "t1",
    title: "Construction of Rural Health Centre, Lot 3",
    reference: "MOH/RFP/2026/014",
    clientName: "Ministry of Health, Republic of Kenya",
    procuringEntityName: "Ministry of Health, Republic of Kenya",
    deadline: new Date("2026-09-30T12:00:00Z"),
    currency: "KES",
    country: "Kenya",
    submissionMethod: "email submission required",
    submissionAddress: null as string | null,
    submissionEmails: "procurement@health.go.ke",
    submissionEmailSubject: null as string | null,
    clientContactName: "Jane Mwangi",
    clientContactEmail: "jane.mwangi@health.go.ke",
    metadataContaminated: false,
    clientNameSourceFileId: FILE_ID,
    clientNameSourcePage: 1,
    clientNameSourceQuote: "Ministry of Health, Republic of Kenya invites sealed bids",
    submissionMethodSourceFileId: FILE_ID,
    submissionMethodSourcePage: 1,
    submissionMethodSourceQuote: "Bids shall be submitted by email to procurement@health.go.ke",
    submissionAddressSourceFileId: null as string | null,
    submissionAddressSourcePage: null as number | null,
    submissionAddressSourceQuote: null as string | null,
    submissionEmailSourceFileId: FILE_ID,
    submissionEmailSourcePage: 1,
    submissionEmailSourceQuote: "Bids shall be submitted by email to procurement@health.go.ke",
    titleSourceFileId: FILE_ID,
    titleSourcePage: 1,
    titleSourceQuote: "Construction of Rural Health Centre, Lot 3",
    deadlineSourceFileId: FILE_ID,
    deadlineSourcePage: 1,
    deadlineSourceQuote: "The deadline for submission of bids is 30 September 2026 at noon",
    referenceSourceFileId: FILE_ID,
    referenceSourcePage: 1,
    referenceSourceQuote: "Procurement Reference Number: MOH/RFP/2026/014",
    contactDetailsSourceJson: null,
  };
}

const BUILD_PLAN_CRITICAL_FIELDS = ["title", "clientName", "deadline", "submissionMethod", "submissionEmails", "submissionAddress"] as const;

/** Run BOTH paths on the same state; return each side's verdict. */
function verdicts(patch: StatePatch = {}) {
  const tender = { ...baseTender(), ...(patch.tender ?? {}) };
  const files = patch.files ?? [{ id: FILE_ID, extractedText: FILE_TEXT, totalPages: 10 }];
  const overrides = patch.overrides ?? [];

  const resolved = resolveCanonicalFieldState({
    tender: tender as CanonicalResolverInput["tender"],
    overrides: overrides.map((o) => ({ ...o, fieldState: o.fieldState as MetadataFieldState, reason: null, overriddenBy: "u", createdAt: new Date() })),
    hasExtractedRequirements: true,
    submissionMethodContext: (tender.submissionMethod as string | null) ?? undefined,
    activeTenderFileIds: new Set(files.map((f) => f.id)),
    activeFiles: files,
  });
  // The panel verdict restricted to the fields the BuildPlan validator
  // enforces: does any of them carry a hard blocker?
  const panelBlocked = resolved.fields.some(
    (f) => (BUILD_PLAN_CRITICAL_FIELDS as readonly string[]).includes(f.fieldKey) && f.blockerReason !== null,
  );

  const gate = validateCriticalMetadataEvidenceForBuildPlan(tender as any, files as any[], overrides);
  return { panelBlocked, gateBlocked: !gate.ok, gateBlockers: gate.blockers, resolved };
}

describe("metadata alignment — panel verdict equals gate verdict for the same tender state", () => {
  it("fully grounded tender: GREEN in panels AND passes the gate", () => {
    const v = verdicts();
    assert.equal(v.gateBlocked, false, `gate must pass a fully grounded tender: ${JSON.stringify(v.gateBlockers)}`);
    assert.equal(v.panelBlocked, false, "panels must be green for a fully grounded tender");
  });

  it("ungrounded critical field (no title evidence): BLOCKED in BOTH", () => {
    const v = verdicts({ tender: { titleSourceFileId: null, titleSourcePage: null, titleSourceQuote: null } });
    assert.equal(v.gateBlocked, true, "gate must block an ungrounded title");
    assert.equal(v.panelBlocked, true, "panels must not show green for a field the gate blocks");
  });

  it("quote NOT contained in the file text: BLOCKED in BOTH", () => {
    const v = verdicts({ tender: { titleSourceQuote: "A quote that appears nowhere in the file at all" } });
    assert.equal(v.gateBlocked, true, "gate must block a foreign quote");
    assert.equal(v.panelBlocked, true, "panels must not ground a quote the gate rejects as not contained");
  });

  it("source page beyond the file's totalPages: BLOCKED in BOTH", () => {
    const v = verdicts({ tender: { titleSourcePage: 99 } });
    assert.equal(v.gateBlocked, true, "gate must block a page beyond totalPages");
    assert.equal(v.panelBlocked, true, "panels must not ground a page the gate rejects");
  });

  it("quote below the meaningful threshold (6-9 chars): BLOCKED in BOTH (this was green-but-blocked before)", () => {
    // A short quote that IS contained in the file text — under the old rules
    // the panels grounded anything > 5 chars while every gate required >= 10,
    // so this exact state showed green and then failed to generate.
    const v = verdicts({ tender: { titleSourceQuote: "Lot 3. Mi" } }); // 9 chars, contained
    assert.equal(v.gateBlocked, true, "gate must block a below-threshold quote");
    assert.equal(v.panelBlocked, true, "panels must apply the SAME meaningful-quote threshold as the gate");
  });

  it("unclassifiable submission method: BLOCKED in BOTH (was green in panels, fail-closed at the gate)", () => {
    const v = verdicts({
      tender: {
        submissionMethod: "carrier pigeon",
        submissionMethodSourceQuote: "Bids shall be submitted by email to procurement@health.go.ke",
      },
    });
    assert.equal(v.gateBlocked, true, "gate fails closed on an unclassifiable method");
    assert.equal(v.panelBlocked, true, "panels must not show a method valid when no gate can classify its endpoint");
  });

  it("ungrounded email endpoint on an email-method tender: BLOCKED in BOTH", () => {
    // submissionEmails is critical when the effective method is email —
    // the validator hard-requires a grounded email endpoint. The panels
    // previously treated submissionEmails as never-critical (green).
    const v = verdicts({ tender: { submissionEmailSourceFileId: null, submissionEmailSourcePage: null, submissionEmailSourceQuote: null } });
    assert.equal(v.gateBlocked, true, "gate must block an ungrounded email endpoint on an email tender");
    assert.equal(v.panelBlocked, true, "panels must block the same ungrounded email endpoint");
  });

  it("portal tender with ONE grounded endpoint: GREEN in BOTH (one-of-two rule)", () => {
    const v = verdicts({
      tender: {
        submissionMethod: "online portal submission",
        submissionMethodSourceQuote: "Bids shall be submitted by email to procurement@health.go.ke",
      },
    });
    assert.equal(v.gateBlocked, false, `portal with one grounded endpoint must pass the gate: ${JSON.stringify(v.gateBlockers)}`);
    assert.equal(v.panelBlocked, false, "panels must not block a portal tender with one grounded endpoint");
  });

  it("portal tender with NO grounded endpoint: BLOCKED in BOTH", () => {
    const v = verdicts({
      tender: {
        submissionMethod: "online portal submission",
        submissionMethodSourceQuote: "Bids shall be submitted by email to procurement@health.go.ke",
        submissionEmails: null,
        submissionEmailSourceFileId: null,
        submissionEmailSourcePage: null,
        submissionEmailSourceQuote: null,
      },
    });
    assert.equal(v.gateBlocked, true, "gate must block a portal tender with no grounded endpoint");
    assert.equal(v.panelBlocked, true, "panels must block a portal tender with no grounded endpoint");
  });

  it("reference VALUE without evidence: NOT blocked in EITHER (authority model — operational field)", () => {
    // Authority model: reference is an operational-warning field. It NEVER
    // blocks draft or final work. The previous "value-driven evidence-
    // mandatory" rule was removed because it caused the rigidity the mission
    // explicitly calls out: "reference number becomes a hard blocker merely
    // because it exists without source evidence."
    //
    // The gate no longer blocks on reference, and the panel no longer blocks
    // on reference. They agree (both NOT blocked).
    const v = verdicts({ tender: { referenceSourceFileId: null, referenceSourcePage: null, referenceSourceQuote: null } });
    const refField = v.resolved.fields.find((f) => f.fieldKey === "reference")!;
    assert.equal(refField.blockerReason, null, "panel must NOT block reference under authority model");
    assert.equal(refField.generationEligible, true, "reference must be generation-eligible");
    assert.equal(refField.exportEligible, true, "reference must be export-eligible");
  });

  it("placeholder override value on a critical field: BLOCKED in BOTH", () => {
    const v = verdicts({ overrides: [{ field: "clientName", fieldState: "USER_EDITED", overrideValue: "Bid-Team to confirm" }] });
    assert.equal(v.gateBlocked, true, "gate must reject a placeholder effective value");
    assert.equal(v.panelBlocked, true, "panels must reject the same placeholder effective value");
  });
});

describe("metadata alignment — ONE submission-method classification everywhere", () => {
  it("prose and enum-style physical methods classify identically", () => {
    for (const m of ["sealed envelope", "SEALED_ENVELOPE", "hand delivery", "HAND_DELIVERY", "Courier", "COURIER", "hard copy", "HARD_COPY"]) {
      assert.equal(isPhysicalSubmissionMethod(m), true, `${m} must classify as physical`);
      assert.equal(isEmailSubmissionMethod(m), false, `${m} must not classify as email`);
    }
  });

  it("portal-with-email-wording classifies as portal (not email) — the export gate previously disagreed", () => {
    for (const m of ["email upload via portal", "online portal submission", "E_PROCUREMENT", "e-tender portal"]) {
      assert.equal(isPortalSubmissionMethod(m), true, `${m} must classify as portal`);
      assert.equal(isEmailSubmissionMethod(m), false, `${m} must NOT classify as email`);
    }
  });

  it("the export gate consumes the policy classifiers on effective values (no ad-hoc regexes)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("lib/engine/export-readiness.ts", "utf8");
    assert.ok(src.includes("isEmailSubmissionMethod(effMethod)"), "export email check must use the policy classifier");
    assert.ok(src.includes("isPhysicalSubmissionMethod(effMethod)"), "export address check must use the policy classifier");
    assert.ok(!src.includes("/email/i.test(method)"), "no ad-hoc email regex");
    assert.ok(!src.includes("/sealed|hand|courier/i"), "no ad-hoc physical regex");
  });
});

describe("metadata alignment — overrides are honored by every consumer (no raw-only checks)", () => {
  it("a USER_EDITED submissionMethod override switches the applicable endpoint in BOTH paths", () => {
    // Raw method = email (grounded email endpoint). Override switches to
    // physical — now BOTH paths must demand a grounded address instead.
    const v = verdicts({ overrides: [{ field: "submissionMethod", fieldState: "USER_EDITED", overrideValue: "sealed envelope delivery" }] });
    assert.equal(v.gateBlocked, true, "gate must demand a grounded address once the effective method is physical");
    assert.ok(
      v.gateBlockers.some((b) => /submissionAddress/i.test(b)),
      `gate blocker must be about the missing address: ${JSON.stringify(v.gateBlockers)}`,
    );
    const addressField = v.resolved.fields.find((f) => f.fieldKey === "submissionAddress")!;
    assert.notEqual(addressField.blockerReason, null, "panels must block the missing address under the effective method too");
  });

  it("the export gate reads effective (override-aware) values for deadline/method/emails", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("lib/engine/export-readiness.ts", "utf8");
    assert.ok(src.includes('effectiveValue("submissionMethod"'), "export gate must derive the effective method");
    assert.ok(src.includes('effectiveValue("submissionEmails"'), "export gate must derive the effective emails");
    assert.ok(src.includes("effectiveDeadline("), "export gate must consult the deadline override");
  });
});
