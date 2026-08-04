import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["components", "app/dashboard"];
const CANONICAL_ACTION_OWNER = "components/workflow-step-links.tsx";

const REMOVED_ACTION_INSTRUCTIONS = [
  /\bRun\s+AI\s+Rematch\b/i,
  /\bRun\s+OCR\b/i,
  /\bClick\s+(?:Generate|Repair|Finalize|Validate)\b/i,
  /\bpress\s+(?:Generate|Repair)\b/i,
  /\buse\s+the\s+repair\s+tool\b/i,
];

function uiFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".tsx")) out.push(full);
    }
  };
  ROOTS.forEach(walk);
  return out;
}

function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("normal workflow action vocabulary", () => {
  it("does not instruct removed or nonexistent actions", () => {
    const offenders: string[] = [];
    for (const file of uiFiles()) {
      const src = code(readFileSync(file, "utf8"));
      for (const pattern of REMOVED_ACTION_INSTRUCTIONS) {
        if (pattern.test(src)) offenders.push(`${file} :: ${pattern}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it("has one UI owner for AI Analyze and Run Engine", () => {
    const owner = readFileSync(CANONICAL_ACTION_OWNER, "utf8");
    assert.match(owner, /manual-ai-analyze/);
    assert.match(owner, /\/api\/tenders\/\$\{tenderId\}\/engine/);
    assert.match(owner, /"AI Analyze"/);
    assert.match(owner, /"Run Engine"/);
  });

  it("no other UI file posts either canonical mutation", () => {
    const offenders = uiFiles()
      .filter((file) => file !== CANONICAL_ACTION_OWNER)
      .filter((file) => {
        const src = code(readFileSync(file, "utf8"));
        return /manual-ai-analyze|\/api\/tenders\/\$\{[^}]+\}\/engine/.test(src);
      });
    assert.deepEqual(offenders, []);
  });

  it("Build Plan is status-only and cannot become a third button", () => {
    const buildPlan = code(readFileSync("components/build-submission-plan-button.tsx", "utf8"));
    assert.doesNotMatch(buildPlan, /method:\s*"POST"/);
    assert.doesNotMatch(buildPlan, /<button/);
    assert.match(buildPlan, /Build Plan awaits Run Engine/);
  });
});
