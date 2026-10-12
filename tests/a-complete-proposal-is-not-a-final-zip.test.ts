// A complete proposal is not a final ZIP.
//
// Pharo, Preview 2026-10-11: the Next Required Action read "Proposal complete —
// attach originals manually" while the Release Status panel on the same page
// read "Ready to download — The final ZIP package is ready" with a "Download
// Final ZIP" button, and POST /export refused that ZIP with
// EXPORT_READINESS_BLOCKED / PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED.
//
// Cause: the panel classified getCanonicalTenderReadiness().readyForFinalExport,
// which never consulted the strict final-submission gate — the only gate that
// knows the owner compiles originals outside the App. The header beside it read
// "Readiness score 84 / 100", which was the bid-decision score, while /export
// reported readinessScore 60.
//
// Three states, one authority (the strict final-submission gate):
//   IN_PROGRESS                                   — App work not complete
//   PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED  — App work complete; proposal
//                                                   package downloads; final ZIP
//                                                   NOT claimed ready
//   SUBMISSION_READY                              — the only state that may say
//                                                   "Final ZIP ready"

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolvePackageVerdict, type CanonicalTenderReadiness } from "../lib/canonical-tender-readiness";
import { classifyReleaseStatus, classifyBlocker } from "../lib/release-status-classifier";
import { releaseStageCopy, resolveReleasePresentationStage } from "../lib/ui/release-stage-copy";
import { deriveTruthfulReleaseStatus, packageDownloadLinks, type PanelWorkflowDecision } from "../components/generation-action-panel";
import { finalPackageStatus, isProposalCompleteExceptOwnerAttachments } from "../lib/engine/final-submission-readiness";
import { evaluateAutoFinalizeConvergence } from "../lib/ai-jobs/auto-finalize-continuation-service";

const read = (path: string) => readFileSync(path, "utf8");
const FINAL_ZIP_READY = /final ZIP package is ready|Download Final ZIP/i;

const strict = (packageStatus: "SUBMISSION_READY" | "PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED" | "IN_PROGRESS", envelopes = { TECHNICAL: 1, FINANCIAL: 0, ADMIN: 0 }, strictTwoEnvelope = false) =>
  async () => ({ packageStatus, summary: { strictTwoEnvelope, envelopeBreakdown: envelopes } });

/** The workflow decision Pharo carries: export stage, no blockers. */
const exportStageDecision: PanelWorkflowDecision = {
  blockerCodes: [],
  blockerDetails: [],
  nextRequiredAction: "EXPORT_READY",
  nextRequiredActionLabel: "Export ready",
  nextRequiredActionReason: "All gates pass.",
};

/** What the Generation & Review panel renders for a canonical readiness. */
function panelFor(canonical: Pick<CanonicalTenderReadiness, "blockers" | "readyForFinalExport" | "packageDownloads">) {
  const status = deriveTruthfulReleaseStatus(null, canonical as CanonicalTenderReadiness, undefined, false, exportStageDecision);
  const copy = releaseStageCopy(resolveReleasePresentationStage({ status, canonicalAction: exportStageDecision.nextRequiredAction, activeWork: null }));
  const offersDownload = status === "READY_TO_DOWNLOAD" || status === "PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED";
  const links = offersDownload ? packageDownloadLinks(status, canonical.packageDownloads) : [];
  return { status, copy, links, text: [copy.label, copy.explanation, ...links.map((l) => l.label)].join(" | ") };
}

async function canonicalFor(packageStatus: Parameters<typeof strict>[0], blockers: string[] = [], envelopes?: Parameters<typeof strict>[1], twoEnvelope = false) {
  const verdict = await resolvePackageVerdict({ blockers, documentsComplete: true, loadFinalSubmission: strict(packageStatus, envelopes, twoEnvelope) });
  return {
    ...verdict,
    readyForFinalExport: verdict.packageStatus === "SUBMISSION_READY" && verdict.blockers.length === 0,
  };
}

describe("CASE 1 — proposal complete with manual originals: the Generation panel never says Final ZIP ready", () => {
  it("the strict gate's PROPOSAL_COMPLETE verdict reaches the panel", async () => {
    const canonical = await canonicalFor("PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED");
    assert.equal(canonical.readyForFinalExport, false);
    assert.deepEqual(canonical.blockers, ["OWNER_ATTACHMENTS_REQUIRED"]);
    const panel = panelFor(canonical);
    assert.equal(panel.status, "PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED");
    assert.doesNotMatch(panel.text, FINAL_ZIP_READY);
    assert.doesNotMatch(panel.copy.label, /Ready to download/);
    assert.equal(panel.copy.label, "Proposal complete — attach originals manually");
    assert.match(panel.copy.explanation, /does not claim the externally assembled submission is complete/);
  });
  it("a tender form awaiting the owner's original reads the same way", async () => {
    const canonical = await canonicalFor("PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED", ["MISSING_PLANNED_FILES", "MISSING_TENDER_FORM_FIELDS"]);
    assert.deepEqual(canonical.blockers, ["OWNER_ATTACHMENTS_REQUIRED"]);
    assert.equal(panelFor(canonical).status, "PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED");
  });
  it("the classifier never turns owner attachments into READY_TO_DOWNLOAD", () => {
    assert.equal(classifyReleaseStatus(["OWNER_ATTACHMENTS_REQUIRED"], false), "PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED");
    assert.equal(classifyBlocker("OWNER_ATTACHMENTS_REQUIRED"), "OWNER_ATTACHMENTS");
    // A security, legal or source blocker still outranks it.
    assert.equal(classifyReleaseStatus(["OWNER_ATTACHMENTS_REQUIRED", "CONTENT_HASH_MISMATCH"], false), "FAILED_SECURITY_OR_INTEGRITY");
    assert.equal(classifyReleaseStatus(["OWNER_ATTACHMENTS_REQUIRED", "LEGAL_SIGNATURE_REQUIRED"], false), "LEGAL_RELEASE_REQUIRED");
  });
  it("a strict gate that refuses for another reason, or cannot be read, never reports the ZIP ready", async () => {
    for (const load of [strict("IN_PROGRESS"), async () => null, async () => { throw new Error("db down"); }]) {
      const verdict = await resolvePackageVerdict({ blockers: [], documentsComplete: true, loadFinalSubmission: load as never });
      assert.equal(verdict.packageStatus, "IN_PROGRESS");
      assert.deepEqual(verdict.blockers, ["FINAL_SUBMISSION_GATE_BLOCKED"]);
      const panel = panelFor({ blockers: verdict.blockers, readyForFinalExport: false, packageDownloads: verdict.packageDownloads });
      assert.notEqual(panel.status, "READY_TO_DOWNLOAD");
      assert.doesNotMatch(panel.text, FINAL_ZIP_READY);
    }
  });
  it("the gate is not consulted while App work is still in progress", async () => {
    let asked = false;
    const verdict = await resolvePackageVerdict({ blockers: ["NO_ACTIVE_GENERATED_DOCUMENTS"], documentsComplete: false, loadFinalSubmission: async () => { asked = true; return null; } });
    assert.equal(asked, false);
    assert.equal(verdict.packageStatus, "IN_PROGRESS");
    assert.deepEqual(verdict.blockers, ["NO_ACTIVE_GENERATED_DOCUMENTS"]);
  });
});

describe("CASE 2 — the same state offers the proposal package", () => {
  it("one proposal-scope download, labelled as the proposal", async () => {
    const panel = panelFor(await canonicalFor("PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED"));
    assert.deepEqual(panel.links, [{ query: "?type=zip&scope=proposal", label: "Download Proposal Package" }]);
  });
  it("one per non-empty envelope when the tender requires separate sealed envelopes", async () => {
    const panel = panelFor(await canonicalFor("PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED", [], { TECHNICAL: 1, FINANCIAL: 1, ADMIN: 0 }, true));
    assert.deepEqual(panel.links.map((l) => l.query), ["?type=zip&scope=proposal&envelope=technical", "?type=zip&scope=proposal&envelope=financial"]);
    assert.ok(panel.links.every((l) => /^Download Proposal Package — \w+ envelope$/.test(l.label)));
  });
  it("the panel renders exactly these links, not a hard-coded final ZIP", () => {
    const src = read("components/generation-action-panel.tsx");
    assert.match(src, /packageDownloadLinks\(status, canonicalReadiness\?\.packageDownloads\)/);
    assert.doesNotMatch(src, /href=\{`\/api\/tenders\/\$\{_tenderId\}\/download\?type=zip`\}/);
  });
});

describe("CASE 3 — only the strict gate's SUBMISSION_READY says Final ZIP ready", () => {
  it("strict SUBMISSION_READY → Ready to download, Download Final ZIP", async () => {
    const canonical = await canonicalFor("SUBMISSION_READY");
    assert.equal(canonical.readyForFinalExport, true);
    const panel = panelFor(canonical);
    assert.equal(panel.status, "READY_TO_DOWNLOAD");
    assert.equal(panel.copy.label, "Ready to download");
    assert.match(panel.copy.explanation, /The final ZIP package is ready/);
    assert.deepEqual(panel.links, [{ query: "?type=zip", label: "Download Final ZIP" }]);
  });
  it("canonical readiness requires the strict verdict for readyForFinalExport", () => {
    const src = read("lib/canonical-tender-readiness.ts");
    assert.match(src, /readyForFinalExport: packageStatus === "SUBMISSION_READY" && /);
    assert.match(src, /loadFinalSubmission: \(\) => getFinalSubmissionReadiness\(client, \{ tenderId, userId \}\)/);
  });
});

describe("CASE 4 — AUTO_FINALIZE completes the App's work but never promotes the submission", () => {
  it("the package status of a proposal-complete verdict is never SUBMISSION_READY", () => {
    assert.equal(finalPackageStatus({ ok: false, proposalComplete: true }), "PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED");
    assert.equal(finalPackageStatus({ ok: true, proposalComplete: true }), "SUBMISSION_READY");
  });
  it("the AUTO_FINALIZE job ends without failure when only owner originals remain", () => {
    const failures = evaluateAutoFinalizeConvergence({
      exportRepair: { repaired: 0, skipped: 0, manualRequired: 1, finalExportReady: false },
      sourceRepair: { checked: 0, repaired: 0, remaining: 0 },
      finalReadiness: { evaluated: true, ok: false, proposalComplete: true, ownerAttachmentsOutstanding: 5, documentBlockers: 0, tenderLevelBlockers: 1, categories: ["OWNER_ATTACHMENTS_REQUIRED"] },
      validation: { validated: 1, failed: 0, pending: 0, rejected: [] },
      pdfFinalization: { finalized: 0, skipped: 0, failed: 0 },
      pdfValidation: { validated: 0, failed: 0, pending: 0, rejected: [] },
      coverageReconciliation: { refreshed: true, requirementsChecked: 7 },
      packageReconciliation: { requiredTotal: 1, missing: 0 },
      missingFileGeneration: { generated: 0, planned: 0, skipped: 0, blocked: null },
      formReuse: { reused: 0, stillMissing: 0 },
      warning: null,
    } as never);
    assert.deepEqual(failures, []);
  });
  it("the auto-finalize route reports COMPLETED with the proposal package, and EXPORT_READY only when the final ZIP is", () => {
    const src = read("app/api/tenders/[id]/auto-finalize/route.ts");
    assert.match(src, /const exportReady = readiness\.ok && canonicalReadiness\?\.readyForFinalExport === true;/);
    assert.match(src, /const proposalComplete = exportReady \|\| canonicalReadiness\?\.packageStatus === "PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED";/);
    assert.match(src, /status: proposalComplete \? "COMPLETED" : "IN_PROGRESS"/);
    assert.match(src, /nextAction: exportReady \? "EXPORT_READY" : proposalComplete \? "DOWNLOAD_PROPOSAL_PACKAGE" : "AUTOMATIC_PROCESSING"/);
    assert.match(src, /readinessOk: exportReady,/);
  });
});

describe("CASE 5 — every surface reads the strict gate's package semantics", () => {
  it("Generation panel, Next Action panel, release state, export and download agree", () => {
    const nextAction = read("components/next-action-panel.tsx");
    const releaseState = read("lib/engine/tender-release-state.ts");
    const exportRoute = read("app/api/tenders/[id]/export/route.ts");
    const downloadRoute = read("app/api/tenders/[id]/download/route.ts");
    const presentation = read("lib/engine/two-action-workflow-presentation.ts");
    // The one producer of package semantics.
    for (const [name, src] of [["release state", releaseState], ["export route", exportRoute], ["download route", downloadRoute], ["canonical readiness", read("lib/canonical-tender-readiness.ts")]] as const) {
      assert.match(src, /getFinalSubmissionReadiness/, `${name} must read the strict final-submission gate`);
    }
    assert.match(nextAction, /releaseState\?\.packageStatus === "PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED"/);
    // POST /export answers from the same gate: a proposal-complete tender gets
    // EXPORT_READINESS_BLOCKED with the proposal package, never readyToDownload.
    assert.match(exportRoute, /const finalSubmission = await getFinalSubmissionReadiness\(prisma, \{ tenderId: tender\.id, userId \}\);\n    if \(!finalSubmission\?\.ok\) \{/);
    assert.ok(exportRoute.indexOf("if (!finalSubmission?.ok)") < exportRoute.indexOf("readyToDownload: true,"), "the strict verdict is checked before the route can say ready");
    assert.match(exportRoute, /code: "EXPORT_READINESS_BLOCKED",\n        readyToDownload: false,/);
    assert.match(downloadRoute, /const proposalOnly = !canonical\.ok && packageScope === "proposal" && canonical\.proposalComplete;/);
    // One sentence for the state on every surface.
    const label = releaseStageCopy("PROPOSAL_COMPLETE").label;
    assert.ok(nextAction.includes(`"${label}"`), "the Next Action panel names it the same way");
    assert.ok(presentation.includes(`"${label}"`), "the workflow presentation names it the same way");
  });
  it("no panel infers the final ZIP from the weaker calculator", () => {
    const panel = read("components/generation-action-panel.tsx");
    // The only "Download Final ZIP" the panel can print comes from
    // packageDownloadLinks, which requires READY_TO_DOWNLOAD — itself only
    // reachable through the strict gate's SUBMISSION_READY.
    assert.equal(panel.match(/Download Final ZIP/g)?.length, 1);
    assert.match(panel, /const base = finalZip \? "Download Final ZIP" : "Download Proposal Package";/);
  });
});

describe("CASE 6 — one readiness score, and the bid score is named for what it is", () => {
  it("the release state's readinessScore is the strict gate's score, the one /export reports", () => {
    const src = read("lib/engine/tender-release-state.ts");
    assert.match(src, /const readinessScore: number \| null = readinessCalculable \? finalSubmission\.summary\.readinessScore : null;/);
    assert.match(src, /bidScore = decision\.score;/);
    assert.doesNotMatch(src, /readinessScore = decision\.score/);
  });
  it("the header names both: Submission readiness, and the bid fit score beside the verdict", () => {
    const src = read("components/next-action-panel.tsx");
    assert.match(src, />Submission readiness</);
    assert.match(src, /Bid fit score \{releaseState\.bidScore\} \/ 100/);
    assert.doesNotMatch(src, />Readiness score</);
  });
});

describe("CASE 7 — a passed deadline stays an advisory and never makes the submission ready", () => {
  it("owner attachments plus a deadline advisory: proposal complete, not submission ready", async () => {
    assert.equal(isProposalCompleteExceptOwnerAttachments({
      documentBlockers: [],
      tenderLevelBlockers: [{ category: "OWNER_ATTACHMENTS_REQUIRED" }],
      exportReadyCount: 1,
      formsAwaitingOriginal: [],
      plannedFileNames: [],
      missingPlanFileNames: [],
    }), true);
    // DEADLINE_PASSED is an advisory warning, not a blocker; it neither blocks
    // the proposal nor unlocks the final ZIP.
    const canonical = await canonicalFor("PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED");
    const panel = panelFor(canonical);
    assert.equal(panel.status, "PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED");
    assert.doesNotMatch(panel.text, FINAL_ZIP_READY);
    assert.notEqual(classifyReleaseStatus(canonical.blockers, canonical.readyForFinalExport), "READY_TO_DOWNLOAD");
  });
});
