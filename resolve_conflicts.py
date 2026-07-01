import os
import re

def resolve_file(path, replacement_pattern, replacement_text):
    if not os.path.exists(path):
        return
    content = open(path).read()
    if '<<<<<<< HEAD' not in content:
        return
    new_content = re.sub(replacement_pattern, replacement_text, content, flags=re.DOTALL)
    with open(path, 'w') as f:
        f.write(new_content)

# 1. lib/engine/canonical-field-state.ts
# Keep origin/main version for canonical field state
resolve_file('lib/engine/canonical-field-state.ts',
    r'<<<<<<< HEAD.*?>>>>>>> origin/main',
    r'''      // USER_CONFIRMED unblocks a critical field ONLY when the confirmed value
      // exactly matches the field-specific extracted value that has active
      // tender-source evidence (valid page + meaningful quote from a current
      // tender source file). Unrelated, stale, or missing evidence keeps the
      // field blocked.
      //
      // Normalize dates before comparison so "2026-12-11" and "12/11/2026"
      // are treated as the same value.
      const normalizedConfirmed = normalizeFieldValue(fieldKey, effectiveStr);
      const normalizedRaw = normalizeFieldValue(fieldKey, rawValue ?? "");
      const confirmedMatchesGroundedSource =
        validation.valid &&
        isGroundedEvidence(evidence) &&
        normalizedConfirmed === normalizedRaw &&
        normalizedConfirmed !== "";
      if (confirmedMatchesGroundedSource) {
        status = "EXTRACTED_AND_GROUNDED";
      } else {
        status = "MANUAL_CONFIRMED";
        if (isCritical && !isGroundedEvidence(evidence)) {
          blockerReason = `Field "${label}" was manually confirmed but has no active tender-source evidence (page + quote). Link to an active tender source to unblock generation.`;
        } else if (isCritical && isGroundedEvidence(evidence) && normalizedConfirmed !== normalizedRaw) {
          blockerReason = `Field "${label}" was manually confirmed with a value that does not match the active tender-source evidence. The confirmed value must exactly match the extracted source value.`;
        }
      }
    } else if (override?.fieldState === "USER_EDITED") {
      // USER_EDITED unblocks a critical field ONLY when the edited value
      // exactly matches the field-specific extracted value with active
      // tender-source evidence. A user edit of a *different* value is a
      // candidate, not a grounded fact — it must not unlock generation.
      const normalizedEdited = normalizeFieldValue(fieldKey, effectiveStr);
      const normalizedRaw = normalizeFieldValue(fieldKey, rawValue ?? "");
      const editedMatchesGroundedSource =
        validation.valid &&
        isGroundedEvidence(evidence) &&
        normalizedEdited === normalizedRaw &&
        normalizedEdited !== "";
      if (editedMatchesGroundedSource) {
        status = "EXTRACTED_AND_GROUNDED";
      } else {
        status = isCritical ? "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED" : "MANUAL_OVERRIDE";
        if (isCritical) {
          blockerReason = `Field "${label}" has a candidate value that does not match active tender-source evidence. Critical fields remain blocked until the value exactly matches the grounded source evidence.`;''')

# 2. app/api/tenders/[id]/submission-plan/build/route.ts
resolve_file('app/api/tenders/[id]/submission-plan/build/route.ts',
    r'<<<<<<< HEAD.*?>>>>>>> origin/main',
    r'''      // Skip DB record creation; update status instead
      await prisma.tender.update({ where: { id: id }, data: { status: "PLAN_APPROVED" } });
      fileStatuses.push({ exactFileName: file.exactFileName, status: "virtual" });''')

# 3. app/api/tenders/[id]/generate/route.ts
# Manual search and replace for this one because of multiple markers or complex structure
path = 'app/api/tenders/[id]/generate/route.ts'
if os.path.exists(path):
    content = open(path).read()
    if '<<<<<<< HEAD' in content:
        content = re.sub(r'<<<<<<< HEAD.*?>>>>>>> origin/main',
            r'''    // Skip DB record creation; update status instead
    await prisma.tender.update({ where: { id: id }, data: { status: "PLAN_APPROVED" } });
    const planRowsCreated = plannedFiles.length;''',
            content, flags=re.DOTALL)
        with open(path, 'w') as f:
            f.write(content)

# 4. lib/engine/generation-readiness-gate.ts
resolve_file('lib/engine/generation-readiness-gate.ts',
    r'<<<<<<< HEAD.*?>>>>>>> origin/main',
    r'''// H — virtual submission-plan signal.
    const { buildSubmissionPlanWithDerivedFallback, deriveSubmissionPlanStatus } = await import("./submission-plan");
    const plan = buildSubmissionPlanWithDerivedFallback(tender as any);
    const planStatus = deriveSubmissionPlanStatus(tender as any, plan);
    const hasValidVirtualSubmissionPlan = planStatus === "CANONICAL_APPROVED";

    // I — EXPORT/FINAL-ZIP readiness: count of real current generated files
    //     with content, validation, and review. PLANNED/SUPERSEDED/virtual/
    //     missing-content/unvalidated/unreviewed rows never count.
    //     This is a strict count — only GENERATED rows with fileContent and
    //     validationStatus/reviewStatus indicating readiness are included.
    const exportReadyDocumentCount = await prisma.generatedDocument.count({
      where: {
        tenderId,
        generationStatus: "GENERATED",
        fileContent: { not: null },
        validationStatus: { in: ["VALIDATED", "APPROVED", "READY_FOR_EXPORT"] },
        reviewStatus: { in: ["APPROVED", "READY_FOR_EXPORT", "REPLACE_WITH_ORIGINAL"] },
      },
    });''')

# 5. tests/unified-snapshot-integration.test.ts
resolve_file('tests/unified-snapshot-integration.test.ts',
    r'<<<<<<< HEAD.*?>>>>>>> origin/main',
    r'''  const tender = await prisma.tender.create({ data: tenderData });
  await prisma.aiJob.create({ data: { id: "test-job-" + Date.now(), tenderId: tender.id, jobType: "AI_ANALYZE", status: "COMPLETED", userId, analysisInputHash: "dummy" } });
  await prisma.auditLog.create({ data: { userId, action: "TENDER_ANALYZED", entityType: "Tender", entityId: tender.id, description: "satisfy trigger" } });''')
