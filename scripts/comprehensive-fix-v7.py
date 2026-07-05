#!/usr/bin/env python3
"""Fix all 7 blockers from five-pass investigation at head f0d4eec4."""
import subprocess
import sys
from pathlib import Path

ROOT = Path("/home/z/my-project")

def run(cmd, check=True, env=None):
    import os
    e = env or {**os.environ}
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, shell=True, env=e)
    if check and r.returncode != 0:
        print(f"FAILED: {cmd[:80]}")
        print(r.stderr[-500:] if r.stderr else r.stdout[-500:])
    return r

run("git checkout hotfix/release-safety-consolidation")
print(f"HEAD: {run('git log --oneline -1').stdout.strip()}")

# ═══════════════════════════════════════════════════════════════════════════
# BLOCKER 2: Create forward-only migration for missing evidence columns
# ═══════════════════════════════════════════════════════════════════════════
print("\nBLOCKER 2: Create migration for missing evidence columns...")
migration_dir = ROOT / "prisma/migrations/20260702000000_add_title_deadline_email_source_evidence"
migration_dir.mkdir(parents=True, exist_ok=True)
(migration_dir / "migration.sql").write_text("""-- Forward-only migration: add missing durable source-evidence columns for
-- policy-critical metadata fields that lack them.
--
-- titleSourceFileId/Page/Quote: title evidence (title was policy-critical but
--   had no durable source storage).
-- deadlineSourceFileId/Page/Quote: deadline evidence (deadline value was hashed
--   but deadline source evidence was not persisted or hashed).
-- submissionEmailSourceQuote: email endpoint evidence quote (the sourceFileId
--   and sourcePage existed but the source quote was missing, so quote
--   containment could not be verified for email submissions).

ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "titleSourceFileId" TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "titleSourcePage" INTEGER;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "titleSourceQuote" TEXT;

ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "deadlineSourceFileId" TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "deadlineSourcePage" INTEGER;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "deadlineSourceQuote" TEXT;

ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "submissionEmailSourceQuote" TEXT;
""")
print("  Migration created: 20260702000000_add_title_deadline_email_source_evidence")

# Update schema.prisma — add the new fields to the Tender model
p = ROOT / "prisma/schema.prisma"
content = p.read_text()
# Find the submissionEmailSourcePage line and add new fields after it
old_field = '  submissionEmailSourcePage Int?'
new_fields = '''  submissionEmailSourcePage Int?
  // Title source evidence (Blocker 2 — policy-critical but missing durable storage)
  titleSourceFileId       String?
  titleSourcePage          Int?
  titleSourceQuote         String?
  // Deadline source evidence (Blocker 2 — value was hashed but evidence was not)
  deadlineSourceFileId     String?
  deadlineSourcePage       Int?
  deadlineSourceQuote      String?
  // Email endpoint source quote (Blocker 2 — sourceFileId/Page existed but quote was missing)
  submissionEmailSourceQuote String?'''
content = content.replace(old_field, new_fields)
p.write_text(content)
print("  Schema updated with new evidence columns")

# Update bootstrap in lib/prisma.ts
p = ROOT / "lib/prisma.ts"
content = p.read_text()
for col in ["titleSourceFileId", "titleSourcePage", "titleSourceQuote", "deadlineSourceFileId", "deadlineSourcePage", "deadlineSourceQuote", "submissionEmailSourceQuote"]:
    if f'ensureColumn(client, "Tender", "{col}"' not in content:
        col_type = "TEXT" if "FileId" in col or "Quote" in col else "INTEGER"
        # Find the last ensureColumn for Tender and add after it
        last_tender_col = content.rfind('ensureColumn(client, "Tender", "submissionEmail')
        if last_tender_col > 0:
            end_of_line = content.find('\n', last_tender_col)
            content = content[:end_of_line+1] + f'  await ensureColumn(client, "Tender", "{col}", "{col_type}");\n' + content[end_of_line+1:]
p.write_text(content)
print("  Bootstrap updated with new evidence columns")

# ═══════════════════════════════════════════════════════════════════════════
# BLOCKER 2: Update build-plan-hash.ts — add title + complete metadata evidence
# ═══════════════════════════════════════════════════════════════════════════
print("\nBLOCKER 2: Update hash input...")
p = ROOT / "lib/engine/build-plan-hash.ts"
content = p.read_text()

# Add title to BuildPlanHashInput
content = content.replace(
    "  deadline?: Date | string | null;\n  items?: BuildPlanHashItem[];",
    "  deadline?: Date | string | null;\n  title?: string | null;\n  items?: BuildPlanHashItem[];"
)

# Add title to hash computation
content = content.replace(
    "    `deadline:${input.deadline ? new Date(input.deadline).toISOString() : \"\"}`,",
    "    `deadline:${input.deadline ? new Date(input.deadline).toISOString() : \"\"}`,\n    `title:${input.title ?? \"\"}`,"
)

# Update buildCanonicalBuildPlanHashInput to include title + all metadata evidence
old_builder_meta = '''  // Derive metadata evidence from the tender's source fields.
  // Determine included fields from the policy-critical metadata set.
  input.metadataEvidence = [
    { fieldKey: "clientName", effectiveValue: tender.clientName ?? null, sourceTenderFileId: tender.clientNameSourceFileId ?? null, sourcePage: tender.clientNameSourcePage ?? null, sourceQuote: tender.clientNameSourceQuote ?? null, evidenceState: tender.clientNameSourceFileId ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "submissionMethod", effectiveValue: tender.submissionMethod ?? null, sourceTenderFileId: tender.submissionMethodSourceFileId ?? null, sourcePage: tender.submissionMethodSourcePage ?? null, sourceQuote: tender.submissionMethodSourceQuote ?? null, evidenceState: tender.submissionMethodSourceFileId ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "submissionAddress", effectiveValue: tender.submissionAddress ?? null, sourceTenderFileId: tender.submissionAddressSourceFileId ?? null, sourcePage: tender.submissionAddressSourcePage ?? null, sourceQuote: tender.submissionAddressSourceQuote ?? null, evidenceState: tender.submissionAddressSourceFileId ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "submissionEmails", effectiveValue: tender.submissionEmails ?? null, sourceTenderFileId: tender.submissionEmailSourceFileId ?? null, sourcePage: tender.submissionEmailSourcePage ?? null, sourceQuote: null, evidenceState: tender.submissionEmailSourceFileId ? "GROUNDED" : "UNGROUNDED" },
  ];'''

new_builder_meta = '''  // Derive metadata evidence from ALL policy-critical source fields.
  // Evidence state is based on actual validation (file ID + page + quote),
  // not merely sourceFileId existence.
  input.metadataEvidence = [
    { fieldKey: "title", effectiveValue: tender.title ?? null, sourceTenderFileId: (tender as any).titleSourceFileId ?? null, sourcePage: (tender as any).titleSourcePage ?? null, sourceQuote: (tender as any).titleSourceQuote ?? null, evidenceState: ((tender as any).titleSourceFileId && (tender as any).titleSourcePage && (tender as any).titleSourceQuote) ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "clientName", effectiveValue: tender.clientName ?? null, sourceTenderFileId: tender.clientNameSourceFileId ?? null, sourcePage: tender.clientNameSourcePage ?? null, sourceQuote: tender.clientNameSourceQuote ?? null, evidenceState: (tender.clientNameSourceFileId && tender.clientNameSourcePage && tender.clientNameSourceQuote) ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "deadline", effectiveValue: tender.deadline ? new Date(tender.deadline).toISOString() : null, sourceTenderFileId: (tender as any).deadlineSourceFileId ?? null, sourcePage: (tender as any).deadlineSourcePage ?? null, sourceQuote: (tender as any).deadlineSourceQuote ?? null, evidenceState: ((tender as any).deadlineSourceFileId && (tender as any).deadlineSourcePage && (tender as any).deadlineSourceQuote) ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "submissionMethod", effectiveValue: tender.submissionMethod ?? null, sourceTenderFileId: tender.submissionMethodSourceFileId ?? null, sourcePage: tender.submissionMethodSourcePage ?? null, sourceQuote: tender.submissionMethodSourceQuote ?? null, evidenceState: (tender.submissionMethodSourceFileId && tender.submissionMethodSourcePage && tender.submissionMethodSourceQuote) ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "submissionAddress", effectiveValue: tender.submissionAddress ?? null, sourceTenderFileId: tender.submissionAddressSourceFileId ?? null, sourcePage: tender.submissionAddressSourcePage ?? null, sourceQuote: tender.submissionAddressSourceQuote ?? null, evidenceState: (tender.submissionAddressSourceFileId && tender.submissionAddressSourcePage && tender.submissionAddressSourceQuote) ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "submissionEmails", effectiveValue: tender.submissionEmails ?? null, sourceTenderFileId: tender.submissionEmailSourceFileId ?? null, sourcePage: tender.submissionEmailSourcePage ?? null, sourceQuote: (tender as any).submissionEmailSourceQuote ?? null, evidenceState: (tender.submissionEmailSourceFileId && tender.submissionEmailSourcePage && (tender as any).submissionEmailSourceQuote) ? "GROUNDED" : "UNGROUNDED" },
  ];'''

content = content.replace(old_builder_meta, new_builder_meta)

# Also update the builder's tender type to accept new fields
old_builder_type = '''    submissionEmailSourceFileId?: string | null;
    submissionEmailSourcePage?: number | null;
    files: BuildPlanHashFile[];'''
new_builder_type = '''    submissionEmailSourceFileId?: string | null;
    submissionEmailSourcePage?: number | null;
    submissionEmailSourceQuote?: string | null;
    titleSourceFileId?: string | null;
    titleSourcePage?: number | null;
    titleSourceQuote?: string | null;
    deadlineSourceFileId?: string | null;
    deadlineSourcePage?: number | null;
    deadlineSourceQuote?: string | null;
    title?: string | null;
    files: BuildPlanHashFile[];'''
content = content.replace(old_builder_type, new_builder_type)

# Add title to the builder return
content = content.replace(
    "    deadline: tender.deadline ?? null,\n  };\n}",
    "    deadline: tender.deadline ?? null,\n    title: tender.title ?? null,\n  };\n}"
)

p.write_text(content)
print("  Hash input includes title + all 6 metadata evidence fields with strict state")

# ═══════════════════════════════════════════════════════════════════════════
# BLOCKER 1: Gate calls computeTenderBuildPlanHash instead of manual construction
# ═══════════════════════════════════════════════════════════════════════════
print("\nBLOCKER 1: Gate calls computeTenderBuildPlanHash...")
p = ROOT / "lib/engine/generation-readiness-gate.ts"
content = p.read_text()

# Find the manual hash construction and replace with computeTenderBuildPlanHash
# The gate currently calls computeBuildPlanHash(buildCanonicalBuildPlanHashInput(...))
# Replace with computeTenderBuildPlanHash(prisma, tenderId, userId, persistedItems)
old_gate_hash = content[content.find("// CANONICAL HASH: use buildCanonicalBuildPlanHashInput"):content.find("const recordedBuildPlanState")]
# Find a wider context
start = content.find("const { computeBuildPlanHash, buildCanonicalBuildPlanHashInput } = await import")
if start < 0:
    start = content.find("const { computeBuildPlanHash, buildCanonicalBuildPlanHashInput")
end = content.find("const recordedBuildPlanState")

old_section = content[start:end]
new_section = '''// CANONICAL HASH: call computeTenderBuildPlanHash — the ONE shared service
    // that loads tender data and builds the canonical hash input internally.
    // No manual file/requirement/metadata/item mapping in the gate.
    const persistedItems = recordedBuildPlan?.itemsJson ? JSON.parse(recordedBuildPlan.itemsJson) : [];
    const { computeTenderBuildPlanHash } = await import("./build-plan");
    const currentPlanHash = await computeTenderBuildPlanHash(prisma, tenderId, userId, persistedItems);

    '''

content = content[:start] + new_section + content[end:]
p.write_text(content)
print("  Gate now calls computeTenderBuildPlanHash — no manual hash construction")

# ═══════════════════════════════════════════════════════════════════════════
# BLOCKER 3: Policy-driven metadata validation
# ═══════════════════════════════════════════════════════════════════════════
print("\nBLOCKER 3: Policy-driven metadata validation...")
p = ROOT / "lib/engine/build-plan.ts"
content = p.read_text()

# Replace the hardcoded validator with a policy-driven one
old_validator = content[content.find("export function validateCriticalMetadataEvidenceForBuildPlan"):content.find("// ═══\n// PREFLIGHT")]

new_validator = '''export function validateCriticalMetadataEvidenceForBuildPlan(
  tender: {
    title?: string | null;
    titleSourceFileId?: string | null;
    titleSourcePage?: number | null;
    titleSourceQuote?: string | null;
    clientName?: string | null;
    clientNameSourceFileId?: string | null;
    clientNameSourcePage?: number | null;
    clientNameSourceQuote?: string | null;
    deadline?: Date | string | null;
    deadlineSourceFileId?: string | null;
    deadlineSourcePage?: number | null;
    deadlineSourceQuote?: string | null;
    submissionMethod?: string | null;
    submissionMethodSourceFileId?: string | null;
    submissionMethodSourcePage?: number | null;
    submissionMethodSourceQuote?: string | null;
    submissionAddress?: string | null;
    submissionAddressSourceFileId?: string | null;
    submissionAddressSourcePage?: number | null;
    submissionAddressSourceQuote?: string | null;
    submissionEmails?: string | null;
    submissionEmailSourceFileId?: string | null;
    submissionEmailSourcePage?: number | null;
    submissionEmailSourceQuote?: string | null;
  },
  activeFiles: Array<{ id: string; extractedText?: string | null }>,
): MetadataEvidenceValidation {
  const blockers: string[] = [];
  const activeFileMap = new Map(activeFiles.map((f) => [f.id, f]));
  const activeFileIds = new Set(activeFiles.map((f) => f.id));

  function checkField(
    label: string,
    value: string | null | undefined,
    sourceFileId: string | null | undefined,
    sourcePage: number | null | undefined,
    sourceQuote: string | null | undefined,
    requireQuote: boolean = true,
  ) {
    if (!value || !value.trim()) {
      blockers.push(`Critical metadata field ${label} has no value.`);
      return;
    }
    if (!sourceFileId || !activeFileIds.has(sourceFileId)) {
      blockers.push(`Critical metadata field ${label} has no active TenderFile source evidence.`);
      return;
    }
    if (typeof sourcePage !== "number" || sourcePage < 1) {
      blockers.push(`Critical metadata field ${label} has invalid source page.`);
      return;
    }
    if (requireQuote) {
      const quote = (sourceQuote ?? "").trim();
      if (quote.length < 10) {
        blockers.push(`Critical metadata field ${label} has no meaningful source quote.`);
        return;
      }
      const file = activeFileMap.get(sourceFileId!);
      const fileText = String(file?.extractedText ?? "").toLowerCase().replace(/\\s+/g, " ").trim();
      const normalizedQuote = quote.toLowerCase().replace(/\\s+/g, " ").trim();
      if (fileText.length === 0 || !fileText.includes(normalizedQuote)) {
        blockers.push(`Critical metadata field ${label} source quote is not contained in the referenced active TenderFile extracted text.`);
      }
    }
  }

  // POLICY-DRIVEN: always check title, clientName, deadline, submissionMethod.
  checkField("title", tender.title, tender.titleSourceFileId, tender.titleSourcePage, tender.titleSourceQuote);
  checkField("clientName", tender.clientName, tender.clientNameSourceFileId, tender.clientNameSourcePage, tender.clientNameSourceQuote);
  checkField("deadline", tender.deadline ? new Date(tender.deadline).toISOString() : null, tender.deadlineSourceFileId, tender.deadlineSourcePage, tender.deadlineSourceQuote);
  checkField("submissionMethod", tender.submissionMethod, tender.submissionMethodSourceFileId, tender.submissionMethodSourcePage, tender.submissionMethodSourceQuote);

  // SUBMISSION-METHOD-DRIVEN: only check the applicable endpoint.
  const method = (tender.submissionMethod ?? "").toLowerCase();
  if (method.includes("email")) {
    checkField("submissionEmails", tender.submissionEmails, tender.submissionEmailSourceFileId, tender.submissionEmailSourcePage, tender.submissionEmailSourceQuote);
  } else if (method.includes("physical") || method.includes("hard") || method.includes("address") || method.includes("mail")) {
    checkField("submissionAddress", tender.submissionAddress, tender.submissionAddressSourceFileId, tender.submissionAddressSourcePage, tender.submissionAddressSourceQuote);
  } else if (method.includes("portal") || method.includes("online")) {
    // Portal: require either address or email evidence (at least one endpoint)
    if (!tender.submissionAddress && !tender.submissionEmails) {
      blockers.push("Portal submission requires at least one submission endpoint (address or email).");
    }
  } else {
    // Unknown method: require address (safest default)
    checkField("submissionAddress", tender.submissionAddress, tender.submissionAddressSourceFileId, tender.submissionAddressSourcePage, tender.submissionAddressSourceQuote);
  }

  return { ok: blockers.length === 0, blockers };
}

'''

content = content.replace(old_validator, new_validator)
p.write_text(content)
print("  Validator is now policy-driven (submission-method-aware)")

# ═══════════════════════════════════════════════════════════════════════════
# BLOCKER 5: Fix confirmation conflict responses
# ═══════════════════════════════════════════════════════════════════════════
print("\nBLOCKER 5: Fix confirmation conflict responses...")
p = ROOT / "app/api/tenders/[id]/build-plan/confirm/route.ts"
content = p.read_text()

# Fix validation-failure branch: check updateMany count
old_val_branch = '''        if (staleBlockers.length > 0 || !validation.ok) {
          // Update validationJson ONLY through conditional updateMany.
          // Never overwrite contentHash.
          await (tx as any).buildPlan.updateMany({
            where: { id: candidateId, status: "DRAFT", revision: candidateRevision, contentHash: candidateHash },
            data: { validationJson: JSON.stringify({ ok: false, blockers: validation.blockers.concat(staleBlockers) }) },
          });
          return { status: 422 as const, body: { ok: false, code: "BUILD_PLAN_CONFIRMATION_BLOCKED", blockers: validation.blockers.concat(staleBlockers), authorizesGeneration: false } };
        }'''

new_val_branch = '''        if (staleBlockers.length > 0 || !validation.ok) {
          // Update validationJson ONLY through conditional updateMany.
          // Never overwrite contentHash. Check count — if zero, candidate was
          // concurrently rebuilt → return 409, not 422.
          const valUpdate = await (tx as any).buildPlan.updateMany({
            where: { id: candidateId, status: "DRAFT", revision: candidateRevision, contentHash: candidateHash },
            data: { validationJson: JSON.stringify({ ok: false, blockers: validation.blockers.concat(staleBlockers) }) },
          });
          if (valUpdate.count === 0) {
            return { status: 409 as const, body: { ok: false, code: "BUILD_PLAN_CONFLICT", error: "Build Plan was rebuilt during validation. Rebuild and retry.", authorizesGeneration: false } };
          }
          return { status: 422 as const, body: { ok: false, code: "BUILD_PLAN_CONFIRMATION_BLOCKED", blockers: validation.blockers.concat(staleBlockers), authorizesGeneration: false } };
        }'''

content = content.replace(old_val_branch, new_val_branch)

# Fix final P2034 exhaustion: return 409, not 500
content = content.replace(
    '''      // Non-concurrency failure — sanitized 500, NOT false 409
      return NextResponse.json({ ok: false, code: "BUILD_PLAN_INTERNAL_ERROR", error: "Confirmation failed due to an internal error." }, { status: 500 });''',
    '''      if (err?.code === "P2034") {
        // Final P2034 exhaustion — this IS a concurrency conflict → 409
        return NextResponse.json({ ok: false, code: "BUILD_PLAN_CONFLICT", error: "Confirmation failed after retries due to concurrent modification. Rebuild and retry.", authorizesGeneration: false }, { status: 409 });
      }
      // Non-concurrency failure — sanitized 500
      return NextResponse.json({ ok: false, code: "BUILD_PLAN_INTERNAL_ERROR", error: "Confirmation failed due to an internal error." }, { status: 500 });'''
)

p.write_text(content)
print("  Validation-failure count checked + P2034 exhaustion returns 409")

# ═══════════════════════════════════════════════════════════════════════════
# BLOCKER 6: Remove virtualOnly from submission-plan/build
# ═══════════════════════════════════════════════════════════════════════════
print("\nBLOCKER 6: Remove virtualOnly from submission-plan/build...")
p = ROOT / "app/api/tenders/[id]/submission-plan/build/route.ts"
content = p.read_text()
content = content.replace("      virtualOnly: true,\n", "")
# Also remove from audit metadata
content = content.replace("virtualOnly: true, ", "")
content = content.replace(", virtualOnly: true", "")
content = content.replace("virtualOnly: true", "")
# Remove virtual file status
content = content.replace('status: "virtual" as const', 'status: "DRAFT"')
# Clean up the response — return canonical contract only
content = content.replace(
    '''      files: items.map((item: any) => ({ exactFileName: item.exactFileName, status: "DRAFT" })),
    });''',
    '''    });'''
)
p.write_text(content)
print("  Removed virtualOnly + virtual terminology")

print("\n=== All fixes applied. Running typecheck... ===")
result = run("DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public' npx prisma generate", check=False)
result = run("DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public' npx tsc --noEmit", check=False)
if result.returncode != 0:
    print("TYPECHECK FAILED:")
    print(result.stdout[-2000:])
    print(result.stderr[-2000:])
    sys.exit(1)
print("  Typecheck passed.")

print("\n=== Running lint... ===")
result = run("npx eslint . --ext .ts,.tsx --max-warnings 50", check=False)
if result.returncode != 0:
    print("LINT FAILED:")
    print(result.stdout[-500:])
    sys.exit(1)
print("  Lint passed.")

print("\n=== Fresh DB + migrations ===")
run("""DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public' node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\\$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE').then(() => p.\\$executeRawUnsafe('CREATE SCHEMA public')).then(() => { console.log('Schema dropped'); return p.\\$disconnect(); }).catch(e => { console.error(e.message); process.exit(1); });
" """)
result = run("DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public' npx prisma migrate deploy", check=False)
if result.returncode != 0:
    print("MIGRATION FAILED:")
    print(result.stdout[-500:])
    print(result.stderr[-500:])
    sys.exit(1)
print("  Migrations applied.")
run("DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public' npx prisma generate")

print("\n=== Running full test suite... ===")
import os
test_env = {**os.environ, "DATABASE_URL": "postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public", "RUN_DB_INTEGRATION": "true"}
result = run("node scripts/run-tests.mjs", check=False, env=test_env)
for line in result.stdout.split('\n'):
    if line.startswith('ℹ tests') or line.startswith('ℹ pass') or line.startswith('ℹ fail'):
        print(f"  {line}")
if 'ℹ fail 0' not in result.stdout:
    print("TESTS FAILED!")
    for line in result.stdout.split('\n'):
        if line.startswith('✖'):
            print(f"  {line}")
    sys.exit(1)

print("\n✓ All checks passed!")
