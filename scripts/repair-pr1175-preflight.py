from pathlib import Path

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
text = text.replace(old, new, 1)

# Append test-fixture normalization to the generated repair. The production
# change correctly requires current verified source bytes plus serialized
# provenance. These pre-existing relevance tests used structural REVIEWED
# fixtures only, which made every candidate score zero and masked the sector
# assertions. Replace only the fixture builders; assertions remain unchanged.
fixture_patch = r"""

# Normalize matching relevance fixtures to the same durable-provenance contract
# enforced in production. This does not relax matching thresholds or assertions.
relevance_path = "tests/matching-relevance-gates.test.ts"
relevance = read(relevance_path)
relevance = relevance.replace(
    'import { strict as assert } from "node:assert";\n',
    'import { strict as assert } from "node:assert";\nimport { createHash } from "node:crypto";\nimport { buildReviewProvenance, expertReviewFields, projectReviewFields } from "../lib/vault-review-provenance";\n',
    1,
)
start = relevance.index('function provenance(id: string) {')
end = relevance.index('const emptyKnowledgeBase:', start)
replacement = r'''function verifiedSource(id: string, companyId: string, text: string) {
  return {
    id: `source-${id}`,
    companyId,
    extractedText: text,
    contentSha256: createHash("sha256").update(text, "utf8").digest("hex"),
    contentByteLength: Buffer.byteLength(text),
    integrityStatus: "VERIFIED" as const,
  };
}

function makeProject(
  id: string,
  name: string,
  sector: string,
  summary: string,
  serviceAreas: string[],
): CompanyKnowledgeSnapshot["projects"][number] {
  const companyId = "c1";
  const reviewedAt = new Date("2026-07-01T00:00:00.000Z");
  const sourceDocument = verifiedSource(id, companyId, `${name}. ${summary}. ${sector}. ${serviceAreas.join(" ")}`);
  const record = {
    id,
    companyId,
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
    sourceDocumentId: sourceDocument.id,
    reviewedBy: "reviewer-1",
    reviewedAt,
    sourceDocument,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const provenance = buildReviewProvenance({
    recordType: "PROJECT",
    sourceDocument,
    fields: projectReviewFields(record),
    reviewerId: record.reviewedBy,
    reviewedAt,
  });
  assert.equal(provenance.ok, true);
  if (!provenance.ok) throw new Error("project fixture provenance failed");
  return { ...record, reviewNotes: provenance.serialized };
}

function makeExpert(
  id: string,
  fullName: string,
  title: string,
  profile: string,
  disciplines: string[],
  sectors: string[],
): CompanyKnowledgeSnapshot["experts"][number] {
  const companyId = "c1";
  const reviewedAt = new Date("2026-07-01T00:00:00.000Z");
  const sourceDocument = verifiedSource(id, companyId, `${fullName}. ${title}. ${profile}. ${disciplines.join(" ")}. ${sectors.join(" ")}`);
  const record = {
    id,
    companyId,
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
    sourceDocumentId: sourceDocument.id,
    reviewedBy: "reviewer-1",
    reviewedAt,
    sourceDocument,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const provenance = buildReviewProvenance({
    recordType: "EXPERT",
    sourceDocument,
    fields: expertReviewFields(record),
    reviewerId: record.reviewedBy,
    reviewedAt,
  });
  assert.equal(provenance.ok, true);
  if (!provenance.ok) throw new Error("expert fixture provenance failed");
  return { ...record, reviewNotes: provenance.serialized };
}

'''
relevance = relevance[:start] + replacement + relevance[end:]
write(relevance_path, relevance)

strict_path = "tests/matching-strict-domain.test.ts"
strict = read(strict_path)
strict = strict.replace(
    'import { strict as assert } from "node:assert";\n',
    'import { strict as assert } from "node:assert";\nimport { createHash } from "node:crypto";\nimport { buildReviewProvenance, projectReviewFields } from "../lib/vault-review-provenance";\n',
    1,
)
strict_start = strict.index('function reviewedProject(')
strict_end = strict.index('const knowledge:', strict_start)
strict_replacement = r'''function reviewedProject(overrides: Partial<CompanyKnowledgeSnapshot["projects"][number]> & Pick<CompanyKnowledgeSnapshot["projects"][number], "id" | "name" | "sector" | "summary">): CompanyKnowledgeSnapshot["projects"][number] {
  const companyId = "c1";
  const reviewedAt = new Date("2026-07-01T00:00:00.000Z");
  const base = {
    companyId,
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
    return { ...base, sourceDocumentId: null, reviewNotes: "No durable source evidence." };
  }
  const sourceText = `${base.name}. ${base.summary}. ${base.sector}. ${base.serviceAreas}`;
  const sourceDocument = {
    id: `source-${base.id}`,
    companyId,
    extractedText: sourceText,
    contentSha256: createHash("sha256").update(sourceText, "utf8").digest("hex"),
    contentByteLength: Buffer.byteLength(sourceText),
    integrityStatus: "VERIFIED" as const,
  };
  const record = { ...base, sourceDocumentId: sourceDocument.id, sourceDocument };
  const provenance = buildReviewProvenance({
    recordType: "PROJECT",
    sourceDocument,
    fields: projectReviewFields(record),
    reviewerId: record.reviewedBy,
    reviewedAt,
  });
  assert.equal(provenance.ok, true);
  if (!provenance.ok) throw new Error("strict-domain fixture provenance failed");
  return { ...record, reviewNotes: provenance.serialized };
}

'''
strict = strict[:strict_start] + strict_replacement + strict[strict_end:]
write(strict_path, strict)
"""

if "Normalize matching relevance fixtures" not in text:
    text += fixture_patch
path.write_text(text, encoding="utf-8")

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

print("repair preflight applied")
