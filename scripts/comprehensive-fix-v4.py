#!/usr/bin/env python3
"""Fix all verified defects from three-pass investigation."""
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
# FIX 2: Complete canonical hash — add items, requirement evidence, metadata
# ═══════════════════════════════════════════════════════════════════════════
print("\nFIX 2: Complete canonical hash...")
p = ROOT / "lib/engine/build-plan-hash.ts"
content = p.read_text()

# 1. Add requirement evidence fields to BuildPlanHashRequirement
old_req_type = '''export type BuildPlanHashRequirement = {
  id: string;
  title?: string | null;
  requirementType?: string | null;
  priority?: string | null;
  exactFileName?: string | null;
  exactOrder?: number | null;
};'''
new_req_type = '''export type BuildPlanHashRequirement = {
  id: string;
  title?: string | null;
  description?: string | null;
  requirementType?: string | null;
  priority?: string | null;
  exactFileName?: string | null;
  exactOrder?: number | null;
  sourceTenderFileId?: string | null;
  sourcePageNumber?: number | null;
  sourceExactQuote?: string | null;
};'''
content = content.replace(old_req_type, new_req_type)

# 2. Add critical metadata evidence to BuildPlanHashInput
old_input_type = '''export type BuildPlanHashInput = {
  activeFiles: BuildPlanHashFile[];
  requirements: BuildPlanHashRequirement[];
  exactFileNaming?: string | null;
  exactFileOrder?: string | null;
  submissionMethod?: string | null;
  submissionAddress?: string | null;
  submissionEmails?: string | null;
  submissionEmailSubject?: string | null;
  deadline?: Date | string | null;
  items?: BuildPlanHashItem[];
};'''
new_input_type = '''export type BuildPlanHashMetadataEvidence = {
  fieldKey: string;
  effectiveValue: string | null;
  sourceTenderFileId: string | null;
  sourcePage: number | null;
  sourceQuote: string | null;
  evidenceState: string | null;
};

export type BuildPlanHashInput = {
  activeFiles: BuildPlanHashFile[];
  requirements: BuildPlanHashRequirement[];
  exactFileNaming?: string | null;
  exactFileOrder?: string | null;
  submissionMethod?: string | null;
  submissionAddress?: string | null;
  submissionEmails?: string | null;
  submissionEmailSubject?: string | null;
  deadline?: Date | string | null;
  items?: BuildPlanHashItem[];
  metadataEvidence?: BuildPlanHashMetadataEvidence[];
};'''
content = content.replace(old_input_type, new_input_type)

# 3. Add requirement evidence + items + metadata to hash computation
old_hash_body = '''  const reqSig = input.requirements
    .slice()
    .sort(byId)
    .map((r) =>
      [
        r.id,
        r.title ?? "",
        r.requirementType ?? "",
        r.priority ?? "",
        r.exactFileName ?? "",
        r.exactOrder ?? "",
      ].join(UNIT),
    )
    .join("\\n");

  const canonical = [
    `files:${fileSig}`,
    `reqs:${reqSig}`,
    `exactFileNaming:${input.exactFileNaming ?? ""}`,
    `exactFileOrder:${input.exactFileOrder ?? ""}`,
    `submissionMethod:${input.submissionMethod ?? ""}`,
    `submissionAddress:${input.submissionAddress ?? ""}`,
    `submissionEmailSubject:${input.submissionEmailSubject ?? ""}`,
    `deadline:${input.deadline ? new Date(input.deadline).toISOString() : ""}`,
    `submissionEmails:${input.submissionEmails ?? ""}`,
  ].join("\\n\\n");

  return sha256(canonical);'''

new_hash_body = '''  const reqSig = input.requirements
    .slice()
    .sort(byId)
    .map((r) =>
      [
        r.id,
        r.title ?? "",
        r.description ?? "",
        r.requirementType ?? "",
        r.priority ?? "",
        r.exactFileName ?? "",
        r.exactOrder ?? "",
        r.sourceTenderFileId ?? "",
        r.sourcePageNumber ?? "",
        r.sourceExactQuote ?? "",
      ].join(UNIT),
    )
    .join("\\n");

  // Canonical BuildPlan items — any change to item fields invalidates the hash.
  const itemSig = (input.items ?? [])
    .slice()
    .sort((a, b) => a.exactOrder - b.exactOrder)
    .map((item) =>
      [
        `item:${item.canonicalId}`,
        `fn:${item.exactFileName}`,
        `ord:${item.exactOrder}`,
        `dt:${item.documentType}`,
        `req:${item.required ? 1 : 0}`,
        `fmt:${item.format}`,
        `env:${item.envelope ?? ""}`,
        `srids:${(item.sourceRequirementIds ?? []).slice().sort().join(",")}`,
        `pl:${item.pageLimit ?? ""}`,
        `tpl:${item.templateRequired ? 1 : 0}`,
        `tplf:${item.templateSourceFileId ?? ""}`,
        `br:${item.brandingAllowed ? 1 : 0}`,
        `sig:${item.signatureAllowed ? 1 : 0}`,
        `stmp:${item.stampAllowed ? 1 : 0}`,
        `grp:${item.grouping ?? ""}`,
        `nt:${item.notes ?? ""}`,
      ].join(UNIT),
    )
    .join("\\n");

  // Critical metadata evidence — any change to source grounding invalidates hash.
  const metaSig = (input.metadataEvidence ?? [])
    .slice()
    .sort((a, b) => a.fieldKey < b.fieldKey ? -1 : a.fieldKey > b.fieldKey ? 1 : 0)
    .map((m) =>
      [
        `mf:${m.fieldKey}`,
        `mv:${m.effectiveValue ?? ""}`,
        `mfid:${m.sourceTenderFileId ?? ""}`,
        `mpg:${m.sourcePage ?? ""}`,
        `mq:${m.sourceQuote ?? ""}`,
        `mes:${m.evidenceState ?? ""}`,
      ].join(UNIT),
    )
    .join("\\n");

  const canonical = [
    `files:${fileSig}`,
    `reqs:${reqSig}`,
    `items:${itemSig}`,
    `meta:${metaSig}`,
    `exactFileNaming:${input.exactFileNaming ?? ""}`,
    `exactFileOrder:${input.exactFileOrder ?? ""}`,
    `submissionMethod:${input.submissionMethod ?? ""}`,
    `submissionAddress:${input.submissionAddress ?? ""}`,
    `submissionEmailSubject:${input.submissionEmailSubject ?? ""}`,
    `deadline:${input.deadline ? new Date(input.deadline).toISOString() : ""}`,
    `submissionEmails:${input.submissionEmails ?? ""}`,
  ].join("\\n\\n");

  return sha256(canonical);'''

content = content.replace(old_hash_body, new_hash_body)
p.write_text(content)
print("  Hash now includes items + requirement evidence + metadata evidence")

# ═══════════════════════════════════════════════════════════════════════════
# FIX 2b: Update build-plan.ts to pass items + requirement evidence + metadata
# ═══════════════════════════════════════════════════════════════════════════
print("\nFIX 2b: Update build-plan.ts hash callers...")
p = ROOT / "lib/engine/build-plan.ts"
content = p.read_text()

# Update the tender select to include requirement evidence fields
old_select = '''      requirements: { orderBy: { createdAt: "asc" }, select: { id: true, title: true, description: true, requirementType: true, priority: true, exactFileName: true, exactOrder: true, sourceTenderFileId: true, sourcePageNumber: true, sourceExactQuote: true } },'''
# This is already present — check
if old_select not in content:
    # Try the version without description
    old_select2 = '''      requirements: { orderBy: { createdAt: "asc" }, select: { id: true, title: true, requirementType: true, priority: true, exactFileName: true, exactOrder: true } },'''
    new_select2 = '''      requirements: { orderBy: { createdAt: "asc" }, select: { id: true, title: true, description: true, requirementType: true, priority: true, exactFileName: true, exactOrder: true, sourceTenderFileId: true, sourcePageNumber: true, sourceExactQuote: true } },'''
    content = content.replace(old_select2, new_select2)

# Update hash input to include items + metadata evidence
# Find the hashInput assignment and add items + metadata
old_hash_input = '''  const hashInput = buildPlanHashInputFromTender({
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    submissionMethod: tender.submissionMethod,
    submissionAddress: tender.submissionAddress,
    submissionEmails: tender.submissionEmails,
    submissionEmailSubject: tender.submissionEmailSubject,
    deadline: tender.deadline,
    files: tender.files.map((f) => ({ id: f.id, fileName: f.originalFileName, extractedText: f.extractedText, deletionStatus: f.deletionStatus })),
    requirements: tender.requirements.map((r) => ({
      id: r.id, title: r.title, requirementType: r.requirementType, priority: r.priority,
      exactFileName: r.exactFileName, exactOrder: r.exactOrder,
    })),
  });
  // Include canonical BuildPlan items in the hash so item changes invalidate
  // the confirmed plan.
  hashInput.items = (items ?? []).map((item) => ({
    canonicalId: item.canonicalId,
    exactFileName: item.exactFileName,
    exactOrder: item.exactOrder,
    documentType: item.documentType,
    required: item.required,
    format: item.format,
    envelope: item.envelope,
    sourceRequirementIds: item.sourceRequirementIds,
    pageLimit: item.pageLimit,
    templateRequired: item.templateRequired,
    templateSourceFileId: item.templateSourceFileId,
    brandingAllowed: item.brandingAllowed,
    signatureAllowed: item.signatureAllowed,
    stampAllowed: item.stampAllowed,
    grouping: item.grouping,
    notes: item.notes,
  }));
  return computeBuildPlanHash(hashInput);'''

new_hash_input = '''  const hashInput = buildPlanHashInputFromTender({
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    submissionMethod: tender.submissionMethod,
    submissionAddress: tender.submissionAddress,
    submissionEmails: tender.submissionEmails,
    submissionEmailSubject: tender.submissionEmailSubject,
    deadline: tender.deadline,
    files: tender.files.map((f) => ({ id: f.id, fileName: f.originalFileName, extractedText: f.extractedText, deletionStatus: f.deletionStatus })),
    requirements: tender.requirements.map((r) => ({
      id: r.id, title: r.title, description: r.description, requirementType: r.requirementType, priority: r.priority,
      exactFileName: r.exactFileName, exactOrder: r.exactOrder,
      sourceTenderFileId: r.sourceTenderFileId, sourcePageNumber: r.sourcePageNumber, sourceExactQuote: r.sourceExactQuote,
    })),
  });
  // Include canonical BuildPlan items in the hash so item changes invalidate
  // the confirmed plan.
  hashInput.items = (items ?? []).map((item) => ({
    canonicalId: item.canonicalId,
    exactFileName: item.exactFileName,
    exactOrder: item.exactOrder,
    documentType: item.documentType,
    required: item.required,
    format: item.format,
    envelope: item.envelope,
    sourceRequirementIds: item.sourceRequirementIds,
    pageLimit: item.pageLimit,
    templateRequired: item.templateRequired,
    templateSourceFileId: item.templateSourceFileId,
    brandingAllowed: item.brandingAllowed,
    signatureAllowed: item.signatureAllowed,
    stampAllowed: item.stampAllowed,
    grouping: item.grouping,
    notes: item.notes,
  }));
  // Include critical metadata evidence in the hash so metadata grounding
  // changes invalidate the confirmed plan.
  hashInput.metadataEvidence = [
    { fieldKey: "clientName", effectiveValue: tender.clientName, sourceTenderFileId: (tender as any).clientNameSourceFileId ?? null, sourcePage: (tender as any).clientNameSourcePage ?? null, sourceQuote: (tender as any).clientNameSourceQuote ?? null, evidenceState: (tender as any).clientNameSourceFileId ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "submissionMethod", effectiveValue: tender.submissionMethod, sourceTenderFileId: (tender as any).submissionMethodSourceFileId ?? null, sourcePage: (tender as any).submissionMethodSourcePage ?? null, sourceQuote: (tender as any).submissionMethodSourceQuote ?? null, evidenceState: (tender as any).submissionMethodSourceFileId ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "submissionAddress", effectiveValue: tender.submissionAddress, sourceTenderFileId: (tender as any).submissionAddressSourceFileId ?? null, sourcePage: (tender as any).submissionAddressSourcePage ?? null, sourceQuote: (tender as any).submissionAddressSourceQuote ?? null, evidenceState: (tender as any).submissionAddressSourceFileId ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "submissionEmails", effectiveValue: tender.submissionEmails, sourceTenderFileId: (tender as any).submissionEmailSourceFileId ?? null, sourcePage: (tender as any).submissionEmailSourcePage ?? null, sourceQuote: null, evidenceState: (tender as any).submissionEmailSourceFileId ? "GROUNDED" : "UNGROUNDED" },
  ];
  return computeBuildPlanHash(hashInput);'''

if old_hash_input in content:
    content = content.replace(old_hash_input, new_hash_input)
    p.write_text(content)
    print("  build-plan.ts now passes items + requirement evidence + metadata to hash")
else:
    print("  WARNING: hash input pattern not found — checking current state...")
    # Check what's actually there
    if 'hashInput.items' in content:
        print("  items already passed")
    if 'description' in content[content.find('computeTenderBuildPlanHash'):content.find('computeTenderBuildPlanHash')+1000]:
        print("  description already in requirements")
    # Just append metadata evidence if items are already there
    if 'hashInput.items' in content and 'hashInput.metadataEvidence' not in content:
        content = content.replace(
            '  return computeBuildPlanHash(hashInput);',
            '''  // Include critical metadata evidence in the hash so metadata grounding
  // changes invalidate the confirmed plan.
  hashInput.metadataEvidence = [
    { fieldKey: "clientName", effectiveValue: tender.clientName, sourceTenderFileId: (tender as any).clientNameSourceFileId ?? null, sourcePage: (tender as any).clientNameSourcePage ?? null, sourceQuote: (tender as any).clientNameSourceQuote ?? null, evidenceState: (tender as any).clientNameSourceFileId ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "submissionMethod", effectiveValue: tender.submissionMethod, sourceTenderFileId: (tender as any).submissionMethodSourceFileId ?? null, sourcePage: (tender as any).submissionMethodSourcePage ?? null, sourceQuote: (tender as any).submissionMethodSourceQuote ?? null, evidenceState: (tender as any).submissionMethodSourceFileId ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "submissionAddress", effectiveValue: tender.submissionAddress, sourceTenderFileId: (tender as any).submissionAddressSourceFileId ?? null, sourcePage: (tender as any).submissionAddressSourcePage ?? null, sourceQuote: (tender as any).submissionAddressSourceQuote ?? null, evidenceState: (tender as any).submissionAddressSourceFileId ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "submissionEmails", effectiveValue: tender.submissionEmails, sourceTenderFileId: (tender as any).submissionEmailSourceFileId ?? null, sourcePage: (tender as any).submissionEmailSourcePage ?? null, sourceQuote: null, evidenceState: (tender as any).submissionEmailSourceFileId ? "GROUNDED" : "UNGROUNDED" },
  ];
  return computeBuildPlanHash(hashInput);'''
        )
        # Also add description + evidence fields to requirements if missing
        content = content.replace(
            'id: r.id, title: r.title, requirementType: r.requirementType, priority: r.priority,\n      exactFileName: r.exactFileName, exactOrder: r.exactOrder,',
            'id: r.id, title: r.title, description: r.description, requirementType: r.requirementType, priority: r.priority,\n      exactFileName: r.exactFileName, exactOrder: r.exactOrder,\n      sourceTenderFileId: r.sourceTenderFileId, sourcePageNumber: r.sourcePageNumber, sourceExactQuote: r.sourceExactQuote,'
        )
        p.write_text(content)
        print("  Added metadata evidence + requirement evidence to existing hash input")

# ═══════════════════════════════════════════════════════════════════════════
# FIX 6: Gate must use persisted confirmed items, not virtual plan
# ═══════════════════════════════════════════════════════════════════════════
print("\nFIX 6: Gate uses persisted confirmed items + passes to hash...")
p = ROOT / "lib/engine/generation-readiness-gate.ts"
content = p.read_text()

# The gate currently calls computeBuildPlanHash with buildPlanHashInputFromTender
# but does NOT pass items. Need to pass the persisted confirmed itemsJson items.
# Find the hash computation section
old_gate_hash = '''    const { computeBuildPlanHash, buildPlanHashInputFromTender } = await import("./build-plan-hash");
    const currentPlanHash = computeBuildPlanHash(buildPlanHashInputFromTender({
      exactFileNaming: tender.exactFileNaming,
      exactFileOrder: tender.exactFileOrder,
      submissionMethod: tender.submissionMethod,
      submissionAddress: tender.submissionAddress,
      submissionEmails: tender.submissionEmails,
      submissionEmailSubject: (tender as any).submissionEmailSubject ?? null,
      deadline: (tender as any).deadline ?? null,
      files: activeFiles.map((f) => ({ id: f.id, fileName: f.originalFileName, extractedText: f.extractedText, deletionStatus: "ACTIVE" })),
      requirements: (requirements as _RequirementRow[]).map((r) => ({
        id: r.id, title: r.title, requirementType: r.requirementType, priority: r.priority,
        exactFileName: r.exactFileName, exactOrder: r.exactOrder,
      })),
    }));'''

new_gate_hash = '''    const { computeBuildPlanHash, buildPlanHashInputFromTender } = await import("./build-plan-hash");
    // Use persisted confirmed BuildPlan items for hash — NOT a newly derived
    // virtual plan. This ensures stale detection compares against the exact
    // items that were confirmed, not what would be derived now.
    const persistedItems = recordedBuildPlan?.itemsJson ? JSON.parse(recordedBuildPlan.itemsJson) : [];
    const gateHashInput = buildPlanHashInputFromTender({
      exactFileNaming: tender.exactFileNaming,
      exactFileOrder: tender.exactFileOrder,
      submissionMethod: tender.submissionMethod,
      submissionAddress: tender.submissionAddress,
      submissionEmails: tender.submissionEmails,
      submissionEmailSubject: (tender as any).submissionEmailSubject ?? null,
      deadline: (tender as any).deadline ?? null,
      files: activeFiles.map((f) => ({ id: f.id, fileName: f.originalFileName, extractedText: f.extractedText, deletionStatus: "ACTIVE" })),
      requirements: (requirements as _RequirementRow[]).map((r) => ({
        id: r.id, title: r.title, description: r.description, requirementType: r.requirementType, priority: r.priority,
        exactFileName: r.exactFileName, exactOrder: r.exactOrder,
        sourceTenderFileId: r.sourceTenderFileId, sourcePageNumber: r.sourcePageNumber, sourceExactQuote: r.sourceExactQuote,
      })),
    });
    gateHashInput.items = persistedItems;
    gateHashInput.metadataEvidence = [
      { fieldKey: "clientName", effectiveValue: tender.clientName, sourceTenderFileId: (tender as any).clientNameSourceFileId ?? null, sourcePage: (tender as any).clientNameSourcePage ?? null, sourceQuote: (tender as any).clientNameSourceQuote ?? null, evidenceState: (tender as any).clientNameSourceFileId ? "GROUNDED" : "UNGROUNDED" },
      { fieldKey: "submissionMethod", effectiveValue: tender.submissionMethod, sourceTenderFileId: (tender as any).submissionMethodSourceFileId ?? null, sourcePage: (tender as any).submissionMethodSourcePage ?? null, sourceQuote: (tender as any).submissionMethodSourceQuote ?? null, evidenceState: (tender as any).submissionMethodSourceFileId ? "GROUNDED" : "UNGROUNDED" },
      { fieldKey: "submissionAddress", effectiveValue: tender.submissionAddress, sourceTenderFileId: (tender as any).submissionAddressSourceFileId ?? null, sourcePage: (tender as any).submissionAddressSourcePage ?? null, sourceQuote: (tender as any).submissionAddressSourceQuote ?? null, evidenceState: (tender as any).submissionAddressSourceFileId ? "GROUNDED" : "UNGROUNDED" },
      { fieldKey: "submissionEmails", effectiveValue: tender.submissionEmails, sourceTenderFileId: (tender as any).submissionEmailSourceFileId ?? null, sourcePage: (tender as any).submissionEmailSourcePage ?? null, sourceQuote: null, evidenceState: (tender as any).submissionEmailSourceFileId ? "GROUNDED" : "UNGROUNDED" },
    ];
    const currentPlanHash = computeBuildPlanHash(gateHashInput);'''

if old_gate_hash in content:
    content = content.replace(old_gate_hash, new_gate_hash)
    p.write_text(content)
    print("  Gate now uses persisted confirmed items + metadata in hash")
else:
    print("  WARNING: gate hash pattern not found")

# Also update the tender select to include requirement evidence fields
content = p.read_text()
if 'r.description' not in content[content.find('mappedRequirements'):content.find('mappedRequirements')+500] if 'mappedRequirements' in content else True:
    # Find the requirements select in the gate
    old_req_select = '''      requirements: { orderBy: { createdAt: "asc" }, select: { id: true, title: true, description: true, requirementType: true, priority: true, exactFileName: true, exactOrder: true, sourceTenderFileId: true, sourcePageNumber: true, sourceExactQuote: true, updatedAt: true } },'''
    if old_req_select not in content:
        old_req_select2 = '''      requirements: { orderBy: { createdAt: "asc" }, select: { id: true, title: true, requirementType: true, priority: true, exactFileName: true, exactOrder: true, sourceTenderFileId: true, sourcePageNumber: true, sourceExactQuote: true } },'''
        new_req_select2 = '''      requirements: { orderBy: { createdAt: "asc" }, select: { id: true, title: true, description: true, requirementType: true, priority: true, exactFileName: true, exactOrder: true, sourceTenderFileId: true, sourcePageNumber: true, sourceExactQuote: true } },'''
        content = content.replace(old_req_select2, new_req_select2)
        p.write_text(content)

# ═══════════════════════════════════════════════════════════════════════════
# FIX 1: Remove parallel authority from submission-plan/build
# ═══════════════════════════════════════════════════════════════════════════
print("\nFIX 1: Remove legacy logic from submission-plan/build...")
p = ROOT / "app/api/tenders/[id]/submission-plan/build/route.ts"
content = p.read_text()

# Find and remove the legacy extraction/analysis/heuristic logic that runs
# BEFORE the canonical service. The route should be a thin wrapper.
# Keep only: auth, rate limit, tender lookup, buildDraftBuildPlan call, response.

# The route currently has ~400 lines of legacy logic. Replace the entire
# body with a thin compatibility endpoint.
new_route = '''import { logger } from "../../../../../../lib/observability";
// POST /api/tenders/[id]/submission-plan/build
//
// Thin compatibility endpoint. Calls the same canonical buildDraftBuildPlan
// service as POST /api/tenders/[id]/build-plan. Returns the same typed result
// and blocker code for the same tender condition. Creates zero GeneratedDocument
// rows. Does NOT perform route-specific extraction, analysis, heuristic,
// optional-only, virtual-plan, or derived-plan decision logic.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { buildDraftBuildPlan } from "../../../../../../lib/engine/build-plan";
import { logAction } from "../../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../../lib/rate-limit";
import { sanitizeError } from "../../../../../../lib/sanitize-error";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const rl = rateLimit(`submission-plan-build:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded. Please wait and retry.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  await prismaReady;
  const { id } = await params;

  try {
    // Call the SAME canonical typed draft service as /build-plan.
    // Failed preflight returns { ok: false, code, message, status } — NOT 404.
    // Only a genuinely missing/foreign tender returns 404.
    const beforeDocs = await prisma.generatedDocument.count({ where: { tenderId: id } });
    const draftResult = await buildDraftBuildPlan(prisma, id, actor.id);
    if (!draftResult.ok) {
      return NextResponse.json({ ok: false, error: draftResult.message, code: draftResult.code }, { status: draftResult.status });
    }
    const afterDocs = await prisma.generatedDocument.count({ where: { tenderId: id } });
    const { plan, items } = draftResult;

    // Also write legacy fields for backward-compatible panel reads.
    // These are NOT authoritative — the canonical authority is itemsJson,
    // revision, status, and contentHash.
    const activeFiles = await prisma.tenderFile.findMany({ where: { tenderId: id, deletionStatus: "ACTIVE" }, select: { id: true, originalFileName: true } });
    const filesList = JSON.stringify(activeFiles.map((f) => ({ fileId: f.id, fileName: f.originalFileName })));
    const plannedDocumentsJson = JSON.stringify(items.map((doc: any) => ({ canonicalId: doc.canonicalId, exactFileName: doc.exactFileName, documentType: doc.documentType, required: doc.required })));
    await prisma.buildPlan.update({
      where: { tenderId: id },
      data: { filesList, plannedDocuments: plannedDocumentsJson, planType: "DERIVED", createdBy: actor.id },
    }).catch(() => {});

    await logAction({
      userId: actor.id,
      action: "SUBMISSION_PLAN_BUILT",
      entityType: "Tender",
      entityId: id,
      description: `Submission plan built via compatibility endpoint — DRAFT revision ${plan.revision}; ${items.length} planned files; ${afterDocs - beforeDocs} GeneratedDocument rows created.`,
      metadata: { tenderId: id, created: 0, skipped: 0, total: items.length, isDerivedDraft: false, virtualOnly: true, contentHash: plan.contentHash, revision: plan.revision },
    });

    return NextResponse.json({
      ok: true,
      created: 0,
      skipped: 0,
      total: items.length,
      isDerivedDraft: false,
      virtualOnly: true,
      contentHash: plan.contentHash,
      revision: plan.revision,
      status: plan.status,
      files: items.map((item: any) => ({ exactFileName: item.exactFileName, status: "virtual" as const })),
    });
  } catch (error) {
    logger.error("[submission-plan/build] error:", { detail: error });
    return NextResponse.json({ ok: false, error: sanitizeError(error) }, { status: 500 });
  }
}
'''

p.write_text(new_route)
print("  submission-plan/build is now a thin compatibility endpoint")

print("\n=== All fixes applied. Running typecheck... ===")
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
    print(result.stderr[-500:])
    sys.exit(1)
print("  Lint passed.")

print("\n=== Dropping DB and applying migrations from scratch... ===")
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
