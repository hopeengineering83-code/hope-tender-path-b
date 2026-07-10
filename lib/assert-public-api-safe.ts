import { FORBIDDEN_USER_FACING_METADATA_TERMS } from "./product-terms";

const RAW_ERROR_PATTERNS = [
  /PrismaClientKnownRequestError/i,
  /Invalid `prisma\./i,
  /\bat\s+[^\n]+\.(ts|js):\d+:\d+/i,
  /stack trace/i,
  /ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i,
];

export type PublicApiSafetyIssue = { path: string; value: string; reason: string };

export function collectPublicApiSafetyIssues(value: unknown, path = "$", issues: PublicApiSafetyIssue[] = []): PublicApiSafetyIssue[] {
  if (typeof value === "string") {
    for (const term of FORBIDDEN_USER_FACING_METADATA_TERMS) {
      if (value.includes(term)) issues.push({ path, value, reason: `Forbidden user-facing term: ${term}` });
    }
    for (const pattern of RAW_ERROR_PATTERNS) {
      if (pattern.test(value)) issues.push({ path, value, reason: `Raw server/Prisma error pattern: ${pattern}` });
    }
    return issues;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectPublicApiSafetyIssues(item, `${path}[${index}]`, issues));
    return issues;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      collectPublicApiSafetyIssues(nested, `${path}.${key}`, issues);
    }
  }
  return issues;
}

export function assertPublicApiSafe(value: unknown): void {
  const issues = collectPublicApiSafetyIssues(value);
  if (issues.length > 0) {
    throw new Error(`Unsafe public API payload:\n${issues.map((i) => `${i.path}: ${i.reason}`).join("\n")}`);
  }
}
