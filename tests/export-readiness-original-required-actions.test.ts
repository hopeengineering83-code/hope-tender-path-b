import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

function actionForReason(reason: string): string {
  if (/ORIGINAL_REQUIRED|REPLACE_WITH_ORIGINAL|tender-issued original/i.test(reason)) {
    return "Attach or upload the exact tender-issued original form/template for this file. Do not use Repair safe document gaps for official-original rows.";
  }
  if (/NOT_EXPORTABLE/i.test(reason)) {
    return "Manual review required: this row is marked NOT_EXPORTABLE and must not be included in the final package unless replaced by the official source file.";
  }
  if (/PLANNED|CONTROL_RECORD_ONLY|control, placeholder, or text-only/i.test(reason)) {
    return "Generate the actual final file or attach the official original. Planned/control rows are not exportable files.";
  }
  return "Review and resolve this blocker before final export.";
}

describe("export readiness original-required action guidance", () => {
  it("tells the user to attach the exact original form and not use repair", () => {
    const action = actionForReason("[ORIGINAL_REQUIRED] Document is not exportable or must be replaced with the tender-issued original before export.");
    assert.match(action, /tender-issued original form\/template/);
    assert.match(action, /Do not use Repair safe document gaps/);
  });

  it("keeps not-exportable rows manual", () => {
    const action = actionForReason("Document format/status (DOCX/NOT_EXPORTABLE) is not a final export package file.");
    assert.match(action, /Manual review required/);
    assert.match(action, /NOT_EXPORTABLE/);
  });

  it("distinguishes planned control rows from repairable generated files", () => {
    const action = actionForReason("[CONTROL_RECORD_ONLY] Document is a control, placeholder, or text-only row.");
    assert.match(action, /Generate the actual final file/);
    assert.match(action, /Planned\/control rows are not exportable/);
  });
});
