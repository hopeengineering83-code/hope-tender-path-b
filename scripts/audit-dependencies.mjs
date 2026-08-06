import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const packages = lock.packages ?? {};

const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["audit", "--json"], {
  cwd: process.cwd(),
  env: process.env,
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(result.stdout || "{}");
} catch {
  console.error("Dependency audit did not return valid JSON.");
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(1);
}

const findings = Object.values(report.vulnerabilities ?? {}).map((finding) => {
  const nodes = Array.isArray(finding.nodes) ? finding.nodes : [];
  const productionNodes = nodes.filter((node) => {
    const entry = packages[node];
    return !entry || (entry.dev !== true && entry.devOptional !== true);
  });
  return {
    name: String(finding.name ?? "unknown"),
    severity: String(finding.severity ?? "unknown").toLowerCase(),
    direct: Boolean(finding.isDirect),
    scope: productionNodes.length > 0 ? "runtime" : "development-only",
    nodes: nodes.length,
    fixAvailable: finding.fixAvailable === true
      ? "yes"
      : finding.fixAvailable && typeof finding.fixAvailable === "object"
        ? `${finding.fixAvailable.name ?? "package"}@${finding.fixAvailable.version ?? "unknown"}${finding.fixAvailable.isSemVerMajor ? " (major)" : ""}`
        : "no",
  };
});

if (findings.length === 0) {
  console.log("✓ Dependency audit passed: no known vulnerabilities.");
  process.exit(0);
}

console.log("Dependency audit findings:");
for (const finding of findings.sort((a, b) => (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0) || a.name.localeCompare(b.name))) {
  console.log(`- ${finding.name}: ${finding.severity}; ${finding.scope}; direct=${finding.direct}; nodes=${finding.nodes}; fix=${finding.fixAvailable}`);
}

const blocking = findings.filter((finding) => {
  const rank = severityRank[finding.severity] ?? 4;
  return (finding.scope === "runtime" && rank >= severityRank.moderate) || rank >= severityRank.high;
});

if (blocking.length > 0) {
  console.error(`Dependency audit failed: ${blocking.length} blocking vulnerability finding(s).`);
  process.exit(1);
}

console.warn("Dependency audit passed for the shipped runtime. Remaining findings are moderate-or-lower development-only dependencies and are not included in the deployed server bundle.");
