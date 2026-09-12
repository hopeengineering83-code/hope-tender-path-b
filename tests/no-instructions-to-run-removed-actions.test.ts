import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["components", "app/dashboard"];

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

describe("normal workflow action vocabulary — manual AI Analyze / manual Run Engine", () => {
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

  it("uses real status owners for MANUAL AI Analyze and MANUAL Run Engine", () => {
    const workflow = readFileSync("components/workflow-step-links.tsx", "utf8");
    const aiPanel = readFileSync("components/ai-analyze-panel.tsx", "utf8");
    const matchingPanel = readFileSync("components/matching-selected-evidence-panel.tsx", "utf8");
    assert.match(aiPanel, /id="ai-analyze-section"/);
    assert.match(matchingPanel, /matching-selected-evidence/);
    // The workflow step links must NOT use the old "Processing automatically" message
    // that told users "No AI Analyze or Run Engine action is required."
    assert.doesNotMatch(workflow, /No AI Analyze or Run Engine action is required/);
    // The workflow must show truthful status messages.
    assert.match(workflow, /Run AI Analyze to continue/);
    assert.match(workflow, /Run Engine to continue/);
    assert.match(workflow, /Source extraction is running automatically/);
  });

  it("the AI Analyze panel contains a visible Run AI Analyze button", () => {
    const aiPanel = code(readFileSync("components/ai-analyze-panel.tsx", "utf8"));
    assert.match(aiPanel, /Run AI Analyze/);
    assert.match(aiPanel, /manual-ai-analyze/);
    // The button is disabled when conditions are not met.
    assert.match(aiPanel, /aria-disabled/);
    assert.match(aiPanel, /disabled=/);
  });

  it("the matching panel contains a visible Run Engine button", () => {
    const matchingPanel = code(readFileSync("components/matching-selected-evidence-panel.tsx", "utf8"));
    assert.match(matchingPanel, /Run Engine/);
    assert.match(matchingPanel, /\/api\/tenders\/\$\{tenderId\}\/engine/);
    assert.match(matchingPanel, /aria-disabled/);
    assert.match(matchingPanel, /disabled=/);
  });

  it("Build Plan is status-only and cannot become a third button", () => {
    const buildPlan = code(readFileSync("components/build-submission-plan-button.tsx", "utf8"));
    assert.doesNotMatch(buildPlan, /method:\s*"POST"/);
    assert.doesNotMatch(buildPlan, /<button/);
  });

  it("no UI file other than the two manual panels posts manual-ai-analyze or engine", () => {
    // Only ai-analyze-panel.tsx and matching-selected-evidence-panel.tsx may call
    // the manual mutation endpoints. All other UI files must not.
    const allowed = new Set([
      "components/ai-analyze-panel.tsx",
      "components/matching-selected-evidence-panel.tsx",
    ]);
    const offenders = uiFiles().filter((file) => {
      if (allowed.has(file)) return false;
      const src = code(readFileSync(file, "utf8"));
      return /manual-ai-analyze|\/api\/tenders\/\$\{[^}]+\}\/engine/.test(src);
    });
    assert.deepEqual(offenders, []);
  });
});
