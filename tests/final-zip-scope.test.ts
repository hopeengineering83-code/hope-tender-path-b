// Tests for the strict final-ZIP scope resolver
// (lib/engine/final-zip-scope.ts).
//
// The route used to:
//   - Always duplicate CV docs under CVs/.
//   - Always append Win-Probability-Report.docx.
//   - Save fileList without the appended Win-Probability entry,
//     so the DB record drifted from the actual ZIP.
//
// These tests pin the new "exactly and only what the tender
// requires" behaviour, including the cases where CVs/ or
// Win-Probability ARE explicitly required (and must therefore
// still be included).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  buildFinalZipEntries,
  tenderRequiresCvFolder,
  tenderRequiresWinProbabilityReport,
  isCvGeneratedDocument,
  collectTenderRequiredFilenames,
  bareFileName,
  type FinalZipScopeInput,
} from "../lib/engine/export/final-zip-scope";

function tender(overrides: Partial<FinalZipScopeInput["tender"]> = {}): FinalZipScopeInput["tender"] {
  return {
    exactFileNaming: null,
    exactFileOrder: null,
    requirements: [],
    ...overrides,
  };
}

function doc(overrides: Partial<FinalZipScopeInput["generatedDocs"][number]>): FinalZipScopeInput["generatedDocs"][number] {
  return {
    id: "doc-1",
    name: "Technical Proposal",
    exactFileName: "Technical-Proposal.docx",
    exactOrder: 1,
    documentType: "TECHNICAL_PROPOSAL",
    ...overrides,
  };
}

describe("collectTenderRequiredFilenames", () => {
  it("merges exactFileNaming, exactFileOrder, and requirement.exactFileName, deduped", () => {
    const names = collectTenderRequiredFilenames(tender({
      exactFileNaming: JSON.stringify(["Technical-Proposal.docx", "CVs/CV-John.docx"]),
      exactFileOrder: JSON.stringify(["Technical-Proposal.docx", "Financial-Offer.docx"]),
      requirements: [{ exactFileName: "Compliance-Matrix.docx" }, { exactFileName: null }],
    }));
    assert.deepEqual(names.sort(), [
      "CVs/CV-John.docx",
      "Compliance-Matrix.docx",
      "Financial-Offer.docx",
      "Technical-Proposal.docx",
    ]);
  });

  it("returns empty when no explicit submission scope is declared", () => {
    assert.deepEqual(collectTenderRequiredFilenames(tender()), []);
  });

  it("tolerates malformed JSON without throwing", () => {
    const names = collectTenderRequiredFilenames(tender({
      exactFileNaming: "not-json",
      exactFileOrder: "[",
      requirements: [{ exactFileName: "Real-File.docx" }],
    }));
    assert.deepEqual(names, ["Real-File.docx"]);
  });
});

describe("tenderRequiresCvFolder", () => {
  it("returns false when no exactFileNaming declares CVs/", () => {
    assert.equal(tenderRequiresCvFolder(tender()), false);
    assert.equal(tenderRequiresCvFolder(tender({
      exactFileNaming: JSON.stringify(["Technical-Proposal.docx", "Financial-Offer.docx"]),
    })), false);
  });

  it("returns true when exactFileNaming includes a CVs/ path", () => {
    assert.equal(tenderRequiresCvFolder(tender({
      exactFileNaming: JSON.stringify(["Technical-Proposal.docx", "CVs/CV-John.docx"]),
    })), true);
  });

  it("matches case-insensitively (cvs/, Cv/, CV/)", () => {
    assert.equal(tenderRequiresCvFolder(tender({
      exactFileNaming: JSON.stringify(["cvs/cv-1.docx"]),
    })), true);
    assert.equal(tenderRequiresCvFolder(tender({
      exactFileNaming: JSON.stringify(["CV/jane.docx"]),
    })), true);
  });

  it("returns true when a per-requirement exactFileName declares CVs/", () => {
    assert.equal(tenderRequiresCvFolder(tender({
      requirements: [{ exactFileName: "CVs/team-lead.docx" }],
    })), true);
  });
});

describe("tenderRequiresWinProbabilityReport", () => {
  it("returns false by default — Win-Probability is internal", () => {
    assert.equal(tenderRequiresWinProbabilityReport(tender()), false);
    assert.equal(tenderRequiresWinProbabilityReport(tender({
      exactFileNaming: JSON.stringify(["Technical-Proposal.docx"]),
    })), false);
  });

  it("returns true when exactFileNaming includes Win-Probability-Report.docx", () => {
    assert.equal(tenderRequiresWinProbabilityReport(tender({
      exactFileNaming: JSON.stringify(["Win-Probability-Report.docx"]),
    })), true);
  });

  it("matches variants: win_probability.docx, WinProbabilityReport.docx", () => {
    assert.equal(tenderRequiresWinProbabilityReport(tender({
      exactFileNaming: JSON.stringify(["win_probability.docx"]),
    })), true);
    assert.equal(tenderRequiresWinProbabilityReport(tender({
      exactFileNaming: JSON.stringify(["WinProbabilityReport.docx"]),
    })), true);
  });

  it("does NOT match unrelated 'probability' or 'win' files", () => {
    assert.equal(tenderRequiresWinProbabilityReport(tender({
      exactFileNaming: JSON.stringify(["Marketing-Strategy.docx"]),
    })), false);
  });
});

describe("isCvGeneratedDocument", () => {
  it("matches documentType EXPERT_CV_PACKAGE", () => {
    assert.equal(isCvGeneratedDocument(doc({ documentType: "EXPERT_CV_PACKAGE", name: "Whatever" })), true);
  });
  it("matches name starting with CV-", () => {
    assert.equal(isCvGeneratedDocument(doc({ documentType: "OTHER", name: "CV-Alemu" })), true);
  });
  it("does NOT match other documents", () => {
    assert.equal(isCvGeneratedDocument(doc({ documentType: "TECHNICAL_PROPOSAL", name: "Technical Proposal" })), false);
  });
});

describe("buildFinalZipEntries — default (no explicit scope)", () => {
  it("places each generated doc at the ZIP root with no duplication", () => {
    const result = buildFinalZipEntries({
      tender: tender(),
      generatedDocs: [
        doc({ id: "d1", name: "Technical Proposal", exactFileName: "Technical-Proposal.docx", exactOrder: 1, documentType: "TECHNICAL_PROPOSAL" }),
        doc({ id: "d2", name: "CV-Alemu", exactFileName: "CV-Alemu.docx", exactOrder: 2, documentType: "EXPERT_CV_PACKAGE" }),
      ],
    });
    assert.equal(result.entries.length, 2);
    assert.deepEqual(result.entries.map((e) => e.name), ["Technical-Proposal.docx", "CV-Alemu.docx"]);
    assert.equal(result.hasExplicitScope, false);
    assert.equal(result.exclusions.length, 0);
  });

  it("does NOT add Win-Probability-Report.docx by default", () => {
    const result = buildFinalZipEntries({
      tender: tender(),
      generatedDocs: [doc({ id: "d1" })],
    });
    assert.equal(result.entries.some((e) => /Win-Probability/i.test(e.name)), false);
  });

  it("does NOT duplicate CV documents under CVs/ when no explicit CVs/ path is required", () => {
    const result = buildFinalZipEntries({
      tender: tender(),
      generatedDocs: [
        doc({ id: "d1", name: "Technical Proposal", exactFileName: "Technical-Proposal.docx", exactOrder: 1, documentType: "TECHNICAL_PROPOSAL" }),
        doc({ id: "d2", name: "CV-Alemu", exactFileName: "CV-Alemu.docx", exactOrder: 2, documentType: "EXPERT_CV_PACKAGE" }),
      ],
    });
    const cvFolderEntries = result.entries.filter((e) => e.name.startsWith("CVs/") || e.name.startsWith("cvs/"));
    assert.equal(cvFolderEntries.length, 0);
  });

  it("respects exactOrder when ordering", () => {
    const result = buildFinalZipEntries({
      tender: tender(),
      generatedDocs: [
        doc({ id: "d1", name: "B", exactFileName: "B.docx", exactOrder: 2 }),
        doc({ id: "d2", name: "A", exactFileName: "A.docx", exactOrder: 1 }),
        doc({ id: "d3", name: "C", exactFileName: "C.docx", exactOrder: 3 }),
      ],
    });
    assert.deepEqual(result.entries.map((e) => e.name), ["A.docx", "B.docx", "C.docx"]);
  });
});

describe("buildFinalZipEntries — explicit CVs/ requirement", () => {
  it("places CV documents under CVs/ ONLY when an exactFileNaming entry declares the CVs/ path", () => {
    const result = buildFinalZipEntries({
      tender: tender({
        exactFileNaming: JSON.stringify(["Technical-Proposal.docx", "CVs/CV-Alemu.docx"]),
      }),
      generatedDocs: [
        doc({ id: "d1", name: "Technical Proposal", exactFileName: "Technical-Proposal.docx", exactOrder: 1, documentType: "TECHNICAL_PROPOSAL" }),
        doc({ id: "d2", name: "CV-Alemu", exactFileName: "CV-Alemu.docx", exactOrder: 2, documentType: "EXPERT_CV_PACKAGE" }),
      ],
    });
    assert.equal(result.hasExplicitScope, true);
    const names = result.entries.map((e) => e.name);
    assert.ok(names.includes("CVs/CV-Alemu.docx"), `expected CVs/ folder entry; got ${JSON.stringify(names)}`);
    // Technical Proposal stays at root.
    assert.ok(names.includes("Technical-Proposal.docx"));
    // No duplicate entry of CV at root.
    assert.equal(names.filter((n) => /^CV-Alemu\.docx$/.test(n)).length, 0);
  });
});

describe("buildFinalZipEntries — explicit Win-Probability requirement", () => {
  it("includes Win-Probability-Report.docx ONLY when exactFileNaming declares it AND it appears in generatedDocs", () => {
    const result = buildFinalZipEntries({
      tender: tender({
        exactFileNaming: JSON.stringify(["Technical-Proposal.docx", "Win-Probability-Report.docx"]),
      }),
      generatedDocs: [
        doc({ id: "d1", name: "Technical Proposal", exactFileName: "Technical-Proposal.docx", exactOrder: 1 }),
        doc({ id: "d2", name: "Win Probability Report", exactFileName: "Win-Probability-Report.docx", exactOrder: 2, documentType: "WIN_PROBABILITY_REPORT" }),
      ],
    });
    const names = result.entries.map((e) => e.name);
    assert.ok(names.includes("Win-Probability-Report.docx"), `expected explicitly-required Win-Probability entry; got ${JSON.stringify(names)}`);
  });

  it("excludes Win-Probability-Report.docx when it appears in generatedDocs but is NOT explicitly required", () => {
    const result = buildFinalZipEntries({
      tender: tender({ exactFileNaming: JSON.stringify(["Technical-Proposal.docx"]) }),
      generatedDocs: [
        doc({ id: "d1", name: "Technical Proposal", exactFileName: "Technical-Proposal.docx", exactOrder: 1 }),
        doc({ id: "d2", name: "Win Probability Report", exactFileName: "Win-Probability-Report.docx", exactOrder: 2, documentType: "WIN_PROBABILITY_REPORT" }),
      ],
    });
    const names = result.entries.map((e) => e.name);
    assert.equal(names.some((n) => /Win-Probability/i.test(n)), false);
    // The doc gets surfaced as an exclusion with a clear reason.
    assert.ok(result.exclusions.some((x) => x.docId === "d2"));
    assert.match(result.exclusions[0].reason, /internal scoring artifact/i);
  });
});

describe("bareFileName", () => {
  it("strips folder prefix", () => {
    assert.equal(bareFileName("CVs/CV-John.docx"), "CV-John.docx");
    assert.equal(bareFileName("Technical-Proposal.docx"), "Technical-Proposal.docx");
    assert.equal(bareFileName("a/b/c/file.pdf"), "file.pdf");
  });
});
