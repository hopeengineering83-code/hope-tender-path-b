from pathlib import Path


def replace_exact(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(f"{label} mismatch: {text.count(old)}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


path = Path("scripts/repair-pr1175-final-gaps.py")
text = path.read_text(encoding="utf-8")
old = '''def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))
'''
new = '''def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        if path == "lib/engine/matching.ts" and old.startswith("      const trustLabel = trustLevelLabel(trustLevel);") and count == 2:
            write(path, text.replace(old, new, 1))
            return
        if path == "app/api/tenders/[id]/ai-rematch/route.ts" and old == "    complianceStatePreserved: true," and count == 2:
            index = text.rfind(old)
            write(path, text[:index] + new + text[index + len(old):])
            return
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))
'''
if text.count(old) != 1:
    raise SystemExit(f"replace_once function mismatch: {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")

matching_test = Path("tests/matching-fail-closed-negative-tests.test.ts")
test_text = matching_test.read_text(encoding="utf-8")
stale = '''    // Must NOT import from vault-review-provenance (that's PR #1146's scope)
    assert.ok(
      !src.includes("vault-review-provenance"),
      "matching-eligibility.ts must NOT reference vault-review-provenance (PR #1146 scope)",
    );
'''
canonical = '''    // The provenance module is now integrated and is the canonical matching authority.
    assert.ok(
      src.includes("vault-review-provenance") && src.includes("canUseVaultRecord"),
      "matching-eligibility.ts must delegate to the canonical durable provenance authority",
    );
'''
if test_text.count(stale) != 1:
    raise SystemExit(f"stale provenance assertion mismatch: {test_text.count(stale)}")
test_text = test_text.replace(stale, canonical, 1)
needle = '''    assert.match(src, /NO_REVIEW_TIMESTAMP/);
'''
replacement = '''    assert.match(src, /NO_REVIEW_TIMESTAMP/);
    assert.match(src, /NO_DURABLE_PROVENANCE/);
'''
if test_text.count(needle) != 1:
    raise SystemExit(f"rejection-code assertion mismatch: {test_text.count(needle)}")
matching_test.write_text(test_text.replace(needle, replacement, 1), encoding="utf-8")

# Existing relevance tests used structural REVIEWED fixtures. Upgrade them to
# real source-byte-bound provenance so the tests continue measuring sector
# relevance rather than being correctly zeroed by the new authority gate.
relevance = Path("tests/matching-relevance-gates.test.ts")
replace_exact(
    relevance,
    '''import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildMatches } from "../lib/engine/matching";
import type { CompanyKnowledgeSnapshot, RequirementDraft } from "../lib/engine/types";

function provenance(id: string) {
  return {
    sourceDocumentId: `source-${id}`,
    reviewedBy: "reviewer-1",
    reviewedAt: new Date("2026-07-01T00:00:00.000Z"),
    reviewNotes: "Reviewed against the owned source document.",
  };
}
''',
    '''import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { buildMatches } from "../lib/engine/matching";
import type { CompanyKnowledgeSnapshot, RequirementDraft } from "../lib/engine/types";
import { buildReviewProvenance, expertReviewFields, projectReviewFields } from "../lib/vault-review-provenance";

const REVIEWED_AT = new Date("2026-07-01T00:00:00.000Z");
const REVIEWER_ID = "reviewer-1";

function verifiedSource(id: string, text: string) {
  return {
    id: `source-${id}`,
    companyId: "c1",
    extractedText: text,
    contentSha256: createHash("sha256").update(text, "utf8").digest("hex"),
    contentByteLength: Buffer.byteLength(text),
    integrityStatus: "VERIFIED",
  };
}
''',
    "relevance imports",
)
replace_exact(
    relevance,
    '''function makeProject(
  id: string,
  name: string,
  sector: string,
  summary: string,
  serviceAreas: string[],
): CompanyKnowledgeSnapshot["projects"][number] {
  return {
    id,
    companyId: "c1",
    name,
    clientName: "Client",
    country: "ET",
    sector,
    summary,
    serviceAreas: JSON.stringify(serviceAreas),
    contractValue: 150000,
    currency: "USD",
    startDate: null,
    endDate: null,
    trustLevel: "REVIEWED",
    ...provenance(id),
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
''',
    '''function makeProject(
  id: string,
  name: string,
  sector: string,
  summary: string,
  serviceAreas: string[],
): CompanyKnowledgeSnapshot["projects"][number] {
  const base = {
    id,
    companyId: "c1",
    name,
    clientName: "Client",
    country: "ET",
    sector,
    summary,
    serviceAreas: JSON.stringify(serviceAreas),
    contractValue: 150000,
    currency: "USD",
    startDate: null,
    endDate: null,
    trustLevel: "REVIEWED",
    reviewedBy: REVIEWER_ID,
    reviewedAt: REVIEWED_AT,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const sourceText = `Project ${name}. Client Client. Country ET. Sector ${sector}. Service areas ${serviceAreas.join(", ")}. Contract value 150000. Currency USD. This verified project reference contains complete source evidence for matching review.`;
  const sourceDocument = verifiedSource(id, sourceText);
  const provenance = buildReviewProvenance({
    recordType: "PROJECT",
    sourceDocument,
    fields: projectReviewFields(base),
    reviewerId: REVIEWER_ID,
    reviewedAt: REVIEWED_AT,
  });
  assert.equal(provenance.ok, true);
  if (!provenance.ok) throw new Error("project fixture provenance failed");
  return {
    ...base,
    sourceDocumentId: sourceDocument.id,
    sourceDocument,
    reviewNotes: provenance.serialized,
  } as unknown as CompanyKnowledgeSnapshot["projects"][number];
}
''',
    "relevance project fixture",
)
replace_exact(
    relevance,
    '''function makeExpert(
  id: string,
  fullName: string,
  title: string,
  profile: string,
  disciplines: string[],
  sectors: string[],
): CompanyKnowledgeSnapshot["experts"][number] {
  return {
    id,
    companyId: "c1",
    fullName,
    title,
    email: null,
    phone: null,
    profile,
    disciplines: JSON.stringify(disciplines),
    sectors: JSON.stringify(sectors),
    certifications: JSON.stringify([]),
    yearsExperience: 12,
    isActive: true,
    trustLevel: "REVIEWED",
    ...provenance(id),
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
''',
    '''function makeExpert(
  id: string,
  fullName: string,
  title: string,
  profile: string,
  disciplines: string[],
  sectors: string[],
): CompanyKnowledgeSnapshot["experts"][number] {
  const base = {
    id,
    companyId: "c1",
    fullName,
    title,
    email: null,
    phone: null,
    profile,
    disciplines: JSON.stringify(disciplines),
    sectors: JSON.stringify(sectors),
    certifications: JSON.stringify([]),
    yearsExperience: 12,
    isActive: true,
    trustLevel: "REVIEWED",
    reviewedBy: REVIEWER_ID,
    reviewedAt: REVIEWED_AT,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const sourceText = `Expert ${fullName}. Title ${title}. Years experience 12. Disciplines ${disciplines.join(", ")}. Sectors ${sectors.join(", ")}. This verified curriculum vitae contains complete source evidence for matching review.`;
  const sourceDocument = verifiedSource(id, sourceText);
  const provenance = buildReviewProvenance({
    recordType: "EXPERT",
    sourceDocument,
    fields: expertReviewFields(base),
    reviewerId: REVIEWER_ID,
    reviewedAt: REVIEWED_AT,
  });
  assert.equal(provenance.ok, true);
  if (!provenance.ok) throw new Error("expert fixture provenance failed");
  return {
    ...base,
    sourceDocumentId: sourceDocument.id,
    sourceDocument,
    reviewNotes: provenance.serialized,
  } as unknown as CompanyKnowledgeSnapshot["experts"][number];
}
''',
    "relevance expert fixture",
)

strict = Path("tests/matching-strict-domain.test.ts")
replace_exact(
    strict,
    '''import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildMatches } from "../lib/engine/matching";
import type { CompanyKnowledgeSnapshot, RequirementDraft } from "../lib/engine/types";
''',
    '''import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { buildMatches } from "../lib/engine/matching";
import type { CompanyKnowledgeSnapshot, RequirementDraft } from "../lib/engine/types";
import { buildReviewProvenance, projectReviewFields } from "../lib/vault-review-provenance";
''',
    "strict imports",
)
replace_exact(
    strict,
    '''function reviewedProject(overrides: Partial<CompanyKnowledgeSnapshot["projects"][number]> & Pick<CompanyKnowledgeSnapshot["projects"][number], "id" | "name" | "sector" | "summary">): CompanyKnowledgeSnapshot["projects"][number] {
  return {
    companyId: "c1",
    clientName: "Client",
    country: "ET",
    serviceAreas: JSON.stringify([]),
    contractValue: 100000,
    currency: "USD",
    startDate: null,
    endDate: null,
    sourceDocumentId: `source-${overrides.id}`,
    trustLevel: "REVIEWED",
    reviewedBy: "reviewer-1",
    reviewedAt: new Date("2026-07-01T00:00:00.000Z"),
    reviewNotes: "Reviewed against durable source evidence.",
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
''',
    '''function reviewedProject(overrides: Partial<CompanyKnowledgeSnapshot["projects"][number]> & Pick<CompanyKnowledgeSnapshot["projects"][number], "id" | "name" | "sector" | "summary">): CompanyKnowledgeSnapshot["projects"][number] {
  const reviewedAt = new Date("2026-07-01T00:00:00.000Z");
  const base = {
    companyId: "c1",
    clientName: "Client",
    country: "ET",
    serviceAreas: JSON.stringify([]),
    contractValue: 100000,
    currency: "USD",
    startDate: null,
    endDate: null,
    trustLevel: "REVIEWED",
    reviewedBy: "reviewer-1",
    reviewedAt,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  if (overrides.sourceDocumentId === null) {
    return { ...base, sourceDocumentId: null } as CompanyKnowledgeSnapshot["projects"][number];
  }
  const serviceAreas = JSON.parse(base.serviceAreas || "[]") as string[];
  const sourceText = `Project ${base.name}. Client ${base.clientName}. Country ${base.country}. Sector ${base.sector}. Service areas ${serviceAreas.join(", ")}. Contract value ${base.contractValue}. Currency ${base.currency}. This verified project reference contains complete durable source evidence.`;
  const sourceDocument = {
    id: `source-${base.id}`,
    companyId: "c1",
    extractedText: sourceText,
    contentSha256: createHash("sha256").update(sourceText, "utf8").digest("hex"),
    contentByteLength: Buffer.byteLength(sourceText),
    integrityStatus: "VERIFIED",
  };
  const provenance = buildReviewProvenance({
    recordType: "PROJECT",
    sourceDocument,
    fields: projectReviewFields(base),
    reviewerId: "reviewer-1",
    reviewedAt,
  });
  assert.equal(provenance.ok, true);
  if (!provenance.ok) throw new Error("strict-domain fixture provenance failed");
  return {
    ...base,
    sourceDocumentId: sourceDocument.id,
    sourceDocument,
    reviewNotes: provenance.serialized,
  } as unknown as CompanyKnowledgeSnapshot["projects"][number];
}
''',
    "strict project fixture",
)

print("repair preflight applied")
