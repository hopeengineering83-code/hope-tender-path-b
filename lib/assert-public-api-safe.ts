import { FORBIDDEN_USER_FACING_METADATA_TERMS } from "./product-terms";

const RAW_ERROR_PATTERNS = [
  /PrismaClientKnownRequestError/i,
  /Invalid `prisma\./i,
  /\bat\s+[^\n]+\.(ts|js):\d+:\d+/i,
  /stack trace/i,
  /ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i,
];

// Forbidden payload KEYS (case-insensitive). These are internal field names
// that must never appear in public API responses — they expose the old
// "metadata" product concept to users.
const FORBIDDEN_PAYLOAD_KEYS = [
  "metadata",
  "metadatastatus",
  "metadatareadiness",
  "criticalmetadataok",
  "metadatacontaminated",
  "metadatacompletenessratio",
  "metadataplaceholdercount",
  "metadataissues",
  "metadataoverrides",
  "metadataoverview",
  "metadatablocker",
];

export type PublicApiSafetyIssue = { path: string; value: string; reason: string };

function keyContainsForbiddenMetadata(key: string): string | null {
  const lower = key.toLowerCase();
  for (const forbidden of FORBIDDEN_PAYLOAD_KEYS) {
    if (lower === forbidden || lower.includes(forbidden)) {
      return forbidden;
    }
  }
  return null;
}

export function collectPublicApiSafetyIssues(value: unknown, path = "$", issues: PublicApiSafetyIssue[] = []): PublicApiSafetyIssue[] {
  if (typeof value === "string") {
    // Check string values for forbidden user-facing terms (case-insensitive)
    for (const term of FORBIDDEN_USER_FACING_METADATA_TERMS) {
      if (value.toLowerCase().includes(term.toLowerCase())) {
        issues.push({ path, value, reason: `Forbidden user-facing term: ${term}` });
      }
    }
    // Check for raw server error patterns
    for (const pattern of RAW_ERROR_PATTERNS) {
      if (pattern.test(value)) {
        issues.push({ path, value, reason: `Raw server/Prisma error pattern: ${pattern}` });
      }
    }
    return issues;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectPublicApiSafetyIssues(item, `${path}[${index}]`, issues));
    return issues;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const nestedPath = `${path}.${key}`;
      // Check payload KEYS for forbidden metadata terms (case-insensitive)
      const forbiddenKey = keyContainsForbiddenMetadata(key);
      if (forbiddenKey) {
        issues.push({ path: nestedPath, value: key, reason: `Forbidden payload key (case-insensitive): "${forbiddenKey}"` });
      }
      // Recursively check nested values
      collectPublicApiSafetyIssues(nested, nestedPath, issues);
    }
  }
  return issues;
}

export function assertPublicApiSafe(value: unknown): void {
  const issues = collectPublicApiSafetyIssues(value);
  if (issues.length > 0) {
    const diagnostic = issues.map((i) => `  ${i.path}: ${i.reason} (value: ${typeof i.value === "string" ? i.value.slice(0, 80) : i.value})`).join("\n");
    throw new Error(`Unsafe public API payload:\n${diagnostic}`);
  }
}
