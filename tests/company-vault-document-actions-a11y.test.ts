import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("app/dashboard/company/page.tsx", "utf8");
const deleteClassifierSource = readFileSync("lib/company-vault-delete-classifier.ts", "utf8");

describe("Company Vault document row actions", () => {
  it("keeps row actions keyboard discoverable with focus-within, not hover only", () => {
    assert.match(source, /group-focus-within:opacity-100/);
    assert.match(source, /focus-visible:outline/);
  });

  it("uses mobile/tablet friendly touch targets and visible text labels for document row actions", () => {
    assert.match(source, /min-h-8 rounded border/);
    assert.match(source, /min-h-8 rounded-md/);
    assert.match(source, /Re-extracting…" : "Re-extract"/);
    assert.match(source, />Download<\/a>/);
    assert.match(source, /Deleting…" : "Delete"/);
  });

  it("uses an accessible in-page confirmation instead of native window.confirm", () => {
    assert.doesNotMatch(source, /window\.confirm\(/);
    assert.match(source, /confirmingDeleteDocId/);
    assert.match(source, /role="region"/);
    assert.match(source, /aria-labelledby=\{`delete-confirm-title-\$\{doc\.id\}`\}/);
    assert.match(source, /aria-describedby=\{`delete-confirm-help-\$\{doc\.id\}`\}/);
    assert.match(source, /aria-expanded=\{confirmingDeleteDocId===doc\.id\}/);
    // aria-controls is now conditional — only rendered when the confirmation
    // panel is mounted (confirmingDeleteDocId===doc.id). This prevents dangling
    // ARIA references when the confirmation region is not in the DOM.
    assert.match(source, /confirmingDeleteDocId===doc\.id \? \{ "aria-controls": `delete-confirm/);
    assert.match(source, /Yes, delete document/);
    assert.match(source, /Unreviewed AI-drafted and regex-drafted/i);
  });

  it("prevents duplicate delete clicks and reports safe user-facing failures", () => {
    assert.match(source, /deletingDocId/);
    assert.match(source, /if \(deletingDocId\) return/);
    assert.match(source, /disabled=\{deletingDocId!==null \|\| reextractingDocId!==null\}/);
    assert.match(source, /deleteButtonRefs/);
    assert.match(source, /confirmDeleteButtonRefs/);
    assert.match(source, /else delete deleteButtonRefs\.current\[doc\.id\]/);
    assert.match(source, /else delete confirmDeleteButtonRefs\.current\[doc\.id\]/);
    assert.match(source, /requestAnimationFrame\(\(\) => confirmDeleteButtonRefs/);
    assert.match(source, /requestAnimationFrame\(\(\) => deleteButtonRefs/);
    assert.match(source, /onDeleteConfirmationKeyDown/);
    assert.match(source, /event\.key !== "Escape"/);
    assert.match(source, /Press Escape to cancel/);
    // The unknown-error message now lives in the shared classifier
    // (lib/company-vault-delete-classifier.ts), not duplicated in page.tsx.
    assert.match(deleteClassifierSource, /We could not delete that Company Vault document/);
    assert.match(source, /role="alert" aria-live="assertive"/);
    assert.doesNotMatch(source, /String\(err\)|stack|trace/i);
  });
});


describe("Company Vault document re-extraction action", () => {
  it("prevents duplicate expensive re-extraction and exposes progress accessibly", () => {
    assert.match(source, /reextractingDocId/);
    assert.match(source, /if \(reextractingDocId\) return/);
    assert.match(source, /aria-busy=\{reextractingDocId===doc\.id\}/);
    assert.match(source, /disabled=\{reextractingDocId!==null \|\| deletingDocId!==null\}/);
    assert.match(source, /Re-extracting…/);
  });

  it("keeps re-extraction failures safe and actionable for non-technical users", () => {
    assert.match(source, /We could not re-extract text from that Company Vault document/);
    assert.match(source, /Network interruption while re-extracting the Company Vault document/);
    assert.doesNotMatch(source, /String\(err\)|stack|trace/i);
  });
});

describe("Company Vault expert and project delete actions", () => {
  it("uses in-page confirmations instead of native confirm dialogs for expert/project deletes", () => {
    assert.doesNotMatch(source, /confirm\("Delete this (expert|project)\?"\)/);
    assert.match(source, /confirmingDeleteExpertId/);
    assert.match(source, /expert-delete-confirm-/);
    assert.match(source, /Yes, delete expert/);
    assert.match(source, /confirmingDeleteProjectId/);
    assert.match(source, /project-delete-confirm-/);
    assert.match(source, /Yes, delete project/);
  });

  it("keeps expert/project delete failures safe and non-optimistic", () => {
    assert.match(source, /We could not delete that expert record/);
    assert.match(source, /Network interruption while deleting the expert record/);
    assert.match(source, /We could not delete that project record/);
    assert.match(source, /Network interruption while deleting the project record/);
    assert.match(source, /if \(deletingExpertId\) return/);
    assert.match(source, /if \(deletingProjectId\) return/);
  });
});

describe("Company Vault compliance/legal/financial delete actions", () => {
  it("uses in-page confirmations for compliance, legal, and financial record deletes", () => {
    assert.match(source, /confirmingDeleteComplianceId/);
    assert.match(source, /compliance-delete-confirm-/);
    assert.match(source, /Yes, delete compliance record/);
    assert.match(source, /confirmingDeleteLegalId/);
    assert.match(source, /legal-delete-confirm-/);
    assert.match(source, /Yes, delete legal record/);
    assert.match(source, /confirmingDeleteFinancialId/);
    assert.match(source, /financial-delete-confirm-/);
    assert.match(source, /Yes, delete financial record/);
  });

  it("keeps compliance, legal, and financial delete failures safe and non-optimistic", () => {
    assert.match(source, /if \(deletingComplianceId\) return/);
    assert.match(source, /if \(deletingLegalId\) return/);
    assert.match(source, /if \(deletingFinancialId\) return/);
    assert.match(source, /We could not delete that compliance record/);
    assert.match(source, /We could not delete that legal record/);
    assert.match(source, /We could not delete that financial record/);
    assert.match(source, /Network interruption while deleting the compliance record/);
    assert.match(source, /Network interruption while deleting the legal record/);
    assert.match(source, /Network interruption while deleting the financial record/);
  });
});

describe("Company Vault add/reimport mutation failures", () => {
  it("surfaces safe failures for compliance, legal, financial, and reimport mutations", () => {
    assert.match(source, /We could not add that compliance record/);
    assert.match(source, /We could not add that legal record/);
    assert.match(source, /We could not add that financial record/);
    assert.match(source, /We could not re-import Company Vault documents/);
    assert.match(source, /Network interruption while re-importing Company Vault documents/);
    assert.doesNotMatch(source, /String\(err\)|stack|trace/i);
  });
});


describe("Company Vault expert and project save failures", () => {
  it("surfaces safe failures and duplicate-submit guards for expert and project saves", () => {
    // Profile saving moved entirely to the dedicated /dashboard/company/profile
    // editor (see single-company-profile-editor.test.ts) — the Knowledge
    // Vault's own legacy inline profile form and handleSubmit were removed as
    // dead code once its "Company Profile" tab was suppressed and delisted.
    assert.match(source, /if \(expertSaving\) return/);
    assert.match(source, /if \(projectSaving\) return/);
    assert.match(source, /We could not add that expert record/);
    assert.match(source, /Network interruption while adding the expert record/);
    assert.match(source, /We could not add that project record/);
    assert.match(source, /Network interruption while adding the project record/);
    assert.match(source, /if \(!editExpert \|\| expertEditSaving\) return/);
    assert.match(source, /if \(!editProject \|\| projectEditSaving\) return/);
    assert.match(source, /We could not save that expert record/);
    assert.match(source, /We could not save that project record/);
  });

  it("marks edit modals as dialogs and prevents duplicate save clicks", () => {
    assert.match(source, /role="dialog" aria-modal="true" aria-labelledby="edit-expert-title"/);
    assert.match(source, /role="dialog" aria-modal="true" aria-labelledby="edit-project-title"/);
    assert.match(source, /disabled=\{expertEditSaving\|\|!expertEditForm\.fullName\}/);
    assert.match(source, /disabled=\{projectEditSaving\|\|!projectEditForm\.name\}/);
    assert.match(source, /expertEditSaving\?"Saving…":"Save"/);
    assert.match(source, /projectEditSaving\?"Saving…":"Save"/);
  });
});


describe("Company Vault truthful guidance and reduced-motion navigation", () => {
  it("does not claim every uploaded document is fully extracted", () => {
    assert.doesNotMatch(source, /All types extracted fully/);
    assert.match(source, /Review each file before using it as tender evidence/);
  });

  it("uses a scoped project form ref instead of a global querySelector smooth scroll", () => {
    assert.match(source, /projectFormRef = useRef<HTMLFormElement>\(null\)/);
    assert.match(source, /ref=\{projectFormRef\}/);
    assert.match(source, /projectFormRef\.current\?\.scrollIntoView\(\{ block: "start" \}\)/);
    assert.doesNotMatch(source, /document\.querySelector<HTMLFormElement>\("form"\)/);
    assert.doesNotMatch(source, /behavior: "smooth"/);
  });

  it("keeps upload network failures non-technical and actionable", () => {
    assert.match(source, /Network interruption — please retry/);
    assert.doesNotMatch(source, /error:"Network error"/);
  });
});


describe("Company Vault loading and upload announcements", () => {
  it("announces page, upload, and compliance loading states to assistive technology", () => {
    assert.match(source, /role="status" aria-live="polite" className="text-sm text-slate-400 py-16 text-center">Loading Company Vault…/);
    assert.match(source, /role="status" aria-live="polite" aria-label="Upload progress"/);
    assert.match(source, /role="status" aria-live="polite" className="text-sm text-slate-400">Loading compliance records…/);
  });
});
