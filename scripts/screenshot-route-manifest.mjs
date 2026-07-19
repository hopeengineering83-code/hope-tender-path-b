import fs from "node:fs/promises";
import path from "node:path";

function isDynamicPattern(pattern) {
  return /\[[^\]]+\]/.test(pattern);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function patternToRegex(pattern) {
  if (pattern === "/") return /^\/$/;
  const parts = pattern.split("/").filter(Boolean);
  let source = "^";
  for (const part of parts) {
    if (/^\[\[\.\.\.[^\]]+\]\]$/.test(part)) source += "(?:/.*)?";
    else if (/^\[\.\.\.[^\]]+\]$/.test(part)) source += "/.+";
    else if (/^\[[^\]]+\]$/.test(part)) source += "/[^/]+";
    else source += `/${escapeRegex(part)}`;
  }
  return new RegExp(`${source}/?$`);
}

export function pathnameOnly(route, baseUrl) {
  try {
    return new URL(route, baseUrl).pathname;
  } catch {
    return String(route || "").split(/[?#]/, 1)[0] || "/";
  }
}

async function listFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(absolute));
    else files.push(absolute);
  }
  return files;
}

function pageFileToPattern(appRoot, file) {
  const relative = path.relative(appRoot, file).replaceAll(path.sep, "/");
  if (!/(^|\/)page\.(?:js|jsx|ts|tsx)$/.test(relative)) return null;

  const directory = relative.replace(/(?:^|\/)page\.(?:js|jsx|ts|tsx)$/, "");
  if (!directory) return "/";

  const routeSegments = [];
  for (const rawSegment of directory.split("/")) {
    if (!rawSegment || rawSegment.startsWith("@")) continue;
    if (/^\([^/]+\)$/.test(rawSegment)) continue;
    const segment = rawSegment.replace(/^\(\.\.\.\)|^\(\.\.\)|^\(\.\)/, "");
    if (segment) routeSegments.push(segment);
  }
  return `/${routeSegments.join("/")}`.replace(/\/{2,}/g, "/");
}

function dynamicValue(name, pattern, fixtures) {
  const normalized = name.replace(/^\.{3}/, "").toLowerCase();
  if (normalized === "token") return "invalid-screenshot-token";
  if (normalized.includes("document")) return fixtures.primaryDocumentId;
  if (normalized.includes("file")) return fixtures.primaryFileId;
  if (normalized.includes("tender")) return fixtures.primaryTenderId;
  if (normalized === "id" && pattern.startsWith("/dashboard/tenders/")) return fixtures.primaryTenderId;
  if (normalized === "id" && pattern.startsWith("/dashboard/documents/")) return fixtures.primaryDocumentId;
  if (normalized === "slug") return "screenshot-fixture";
  return null;
}

function instantiatePattern(pattern, fixtures) {
  if (!isDynamicPattern(pattern)) return pattern;
  const resolved = [];
  for (const part of pattern.split("/").filter(Boolean)) {
    const optionalCatchAll = part.match(/^\[\[\.\.\.([^\]]+)\]\]$/);
    if (optionalCatchAll) continue;
    const catchAll = part.match(/^\[\.\.\.([^\]]+)\]$/);
    const dynamic = part.match(/^\[([^\]]+)\]$/);
    const name = catchAll?.[1] || dynamic?.[1];
    if (!name) {
      resolved.push(part);
      continue;
    }
    const value = dynamicValue(name, pattern, fixtures);
    if (!value) return null;
    resolved.push(value);
  }
  return `/${resolved.join("/")}`;
}

export async function discoverPageManifest({ appRoot, fixtures }) {
  const grouped = new Map();
  for (const file of await listFiles(appRoot)) {
    const pattern = pageFileToPattern(appRoot, file);
    if (!pattern) continue;
    const source = path.relative(process.cwd(), file).replaceAll(path.sep, "/");
    if (!grouped.has(pattern)) grouped.set(pattern, []);
    grouped.get(pattern).push(source);
  }

  return Array.from(grouped.entries())
    .map(([pattern, sources]) => ({
      pattern,
      sources: sources.sort(),
      dynamic: isDynamicPattern(pattern),
      representativeRoute: instantiatePattern(pattern, fixtures),
      authenticated: pattern === "/dashboard" || pattern.startsWith("/dashboard/"),
    }))
    .sort((a, b) => a.pattern.localeCompare(b.pattern));
}

export function coverageForManifest({ routeManifest, allRecords, viewports, baseUrl }) {
  const coverage = [];
  for (const viewport of viewports) {
    const records = allRecords.filter((record) => record.viewport === viewport.name);
    for (const entry of routeManifest) {
      const matcher = patternToRegex(entry.pattern);
      const matches = records.filter((record) =>
        matcher.test(pathnameOnly(record.requestedRoute, baseUrl)) ||
        matcher.test(pathnameOnly(record.finalPath, baseUrl)),
      );
      coverage.push({
        viewport: viewport.name,
        pattern: entry.pattern,
        sources: entry.sources,
        dynamic: entry.dynamic,
        representativeRoute: entry.representativeRoute,
        covered: matches.length > 0,
        matchedRoutes: Array.from(new Set(matches.map((record) => record.requestedRoute))).sort(),
      });
    }
  }
  return coverage;
}
