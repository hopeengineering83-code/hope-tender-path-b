import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  formatDocumentReadinessFailure,
  formatOperationalCode,
  formatOperationalReason,
} from "../lib/operational-labels";

const commandCenterSource = readFileSync("app/dashboard/tenders/[id]/command-center/page.tsx", "utf8");
const reportSource = readFileSync("app/dashboard/tenders/[id]/report/page.tsx", "utf8");

describe("operational status presentation", () => {
  it("maps persisted decision and workflow codes to human labels", () => {
    assert.equal(formatOperationalCode("NO_GO"), "Do not bid");
    assert.equal(formatOperationalCode("TENDER_INTAKE"), "Tender intake");
    assert.equal(formatOperationalCode("READY_FOR_EXPORT"), "Ready for export");
    assert.equal(formatOperationalCode("AI_ANALYZE"), "AI analysis");
  });

  it("strips machine-code prefixes while preserving explanatory acronyms", () => {
    assert.equal(
      formatOperationalReason("NO_ACTIVE_GENERATED_DOCUMENTS: final PDF or ZIP requires generated documents"),
      "Final PDF or ZIP requires generated documents",
    );
    assert.equal(
      formatOperationalReason("NO_ACTIVE_GENERATED_DOCUMENTS"),
      "No generated documents are ready",
    );
  });

  it("does not duplicate a machine reason as both file name and reason", () => {
    assert.equal(
      formatDocumentReadinessFailure(
        "NO_ACTIVE_GENERATED_DOCUMENTS",
        ["NO_ACTIVE_GENERATED_DOCUMENTS: final export requires an active generated document"],
      ),
      "Final export requires an active generated document",
    );
  });

  it("humanizes the command center status, blocker, objection, and job surfaces", () => {
    assert.match(commandCenterSource, /formatTenderStatus\(tender\.status\)/);
    assert.match(commandCenterSource, /formatOperationalCode\(tender\.stage\)/);
    // Blockers now come pre-humanized from the canonical Tender Release
    // State's reconciled list (lib/engine/tender-release-state.ts), rendered
    // via formatOperationalReason(blocker.title) — the command center no
    // longer builds its own document-readiness-failure strings.
    assert.match(commandCenterSource, /formatOperationalReason\(blocker\.title\)/);
    assert.match(commandCenterSource, /formatOperationalCode\(job\.jobType\)/);
    assert.doesNotMatch(commandCenterSource, /\{tender\.status\} \/ \{tender\.stage\}/);
    assert.doesNotMatch(commandCenterSource, /READY_FOR_EXPORT and no tender-level blockers/);
  });

  // app/dashboard/tenders/[id]/executive-snapshot.tsx (its own independent
  // GO/REVIEW/NO_GO verdict) was removed — superseded by the canonical
  // Tender Release State panel, whose verdict labels are hand-written human
  // strings ("BID", "BID WITH CONDITIONS", "NO BID", "Decision unavailable")
  // rather than raw codes, so there is no formatOperationalCode dependency
  // to protect there.

  it("humanizes printable report status and blocker surfaces", () => {
    assert.match(reportSource, /formatOperationalCode\(blocker\.category\)/);
    assert.match(reportSource, /formatOperationalReason\(blocker\.title\)/);
    assert.match(reportSource, /formatTenderStatus\(tender\.status\)/);
    assert.match(reportSource, /formatOperationalCode\(tender\.stage\)/);
    assert.match(reportSource, /formatOperationalCode\(document\.generationStatus\)/);
    assert.doesNotMatch(reportSource, /font-mono font-semibold">\{b\.category\}/);
  });
});
