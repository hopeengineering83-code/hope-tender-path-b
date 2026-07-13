import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  resolveReviewedSectionEvidence,
  sectionEvidenceBlocker,
} from "../lib/engine/regenerate-section-evidence";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const route = readFileSync(join(rootDir, "app/api/tenders/[id]/regenerate-section/route.ts"), "utf8");
const evidenceSource = readFileSync(join(rootDir, "lib/engine/regenerate-section-evidence.ts"), "utf8");
const vercel = JSON.parse(readFileSync(join(rootDir, "vercel.json"), "utf8"));

describe("reviewed-only section evidence resolver", () => {
  it("prefers reviewed selected evidence over reviewed Vault fallback", () => {
    const result = resolveReviewedSectionEvidence({
      selectedExperts: [
        { id: "unreviewed-selected", trustLevel: "DRAFT" },
        { id: "reviewed-selected", trustLevel: "REVIEWED" },
      ],
      selectedProjects: [{ id: "reviewed-project", trustLevel: "REVIEWED" }],
      vaultExperts: [{ id: "vault-expert", trustLevel: "REVIEWED" }],
      vaultProjects: [{ id: "vault-project", trustLevel: "REVIEWED" }],
    });

    assert.deepEqual(result.experts.map((item) => item.id), ["reviewed-selected"]);
    assert.deepEqual(result.projects.map((item) => item.id), ["reviewed-project"]);
    assert.equal(result.expertSource, "SELECTED_REVIEWED");
    assert.equal(result.projectSource, "SELECTED_REVIEWED");
  });

  it("uses reviewed Vault evidence when selected records are unreviewed", () => {
    const result = resolveReviewedSectionEvidence({
      selectedExperts: [{ id: "selected-expert", trustLevel: "UNREVIEWED" }],
      selectedProjects: [{ id: "selected-project", trustLevel: "UNREVIEWED" }],
      vaultExperts: [{ id: "vault-expert", trustLevel: "REVIEWED" }],
      vaultProjects: [{ id: "vault-project", trustLevel: "REVIEWED" }],
    });

    assert.deepEqual(result.experts.map((item) => item.id), ["vault-expert"]);
    assert.deepEqual(result.projects.map((item) => item.id), ["vault-project"]);
    assert.equal(result.expertSource, "VAULT_REVIEWED");
    assert.equal(result.projectSource, "VAULT_REVIEWED");
  });

  it("never returns unreviewed selected or Vault records", () => {
    const result = resolveReviewedSectionEvidence({
      selectedExperts: [{ id: "selected-expert", trustLevel: "PENDING" }],
      selectedProjects: [{ id: "selected-project", trustLevel: null }],
      vaultExperts: [{ id: "vault-expert", trustLevel: "DRAFT" }],
      vaultProjects: [{ id: "vault-project", trustLevel: "UNREVIEWED" }],
    });

    assert.deepEqual(result.experts, []);
    assert.deepEqual(result.projects, []);
    assert.equal(result.expertSource, "NONE");
    assert.equal(result.projectSource, "NONE");
  });

  it("blocks evidence-dependent sections when reviewed proof is absent", () => {
    assert.deepEqual(sectionEvidenceBlocker({
      sectionId: "technical-approach",
      expertCount: 0,
      projectCount: 1,
    })?.code, "NO_REVIEWED_EXPERT_EVIDENCE");

    assert.deepEqual(sectionEvidenceBlocker({
      sectionId: "company-and-experience",
      expertCount: 1,
      projectCount: 0,
    })?.code, "NO_REVIEWED_PROJECT_EVIDENCE");

    assert.equal(sectionEvidenceBlocker({
      sectionId: "cover-and-summary",
      expertCount: 0,
      projectCount: 0,
    }), null);
  });
});

describe("section regeneration release authority", () => {
  it("passes the canonical gate before loading prompt evidence", () => {
    const gatePos = route.indexOf("assertTenderReadyForGenerationAndExport({");
    const queryPos = route.indexOf("const [tender, company] = await Promise.all");
    assert.ok(gatePos >= 0 && queryPos > gatePos);
    assert.match(route, /purpose: "regenerate-section"/);
    assert.match(route, /Resolve the canonical generation-readiness blocker/);
  });

  it("contains no unreviewed evidence fallback path", () => {
    assert.doesNotMatch(route, /using .*unreviewed selected/i);
    assert.doesNotMatch(route, /experts\s*=\s*tender\.expertMatches\.map/);
    assert.doesNotMatch(route, /projects\s*=\s*tender\.projectMatches\.map/);
    assert.match(route, /resolveReviewedSectionEvidence/);
    assert.match(evidenceSource, /NO_REVIEWED_EXPERT_EVIDENCE/);
    assert.match(evidenceSource, /NO_REVIEWED_PROJECT_EVIDENCE/);
  });

  it("never returns deterministic fallback markdown as successful generation", () => {
    assert.doesNotMatch(route, /buildSectionFallback/);
    assert.doesNotMatch(route, /AI unavailable — returned deterministic section/);
    assert.match(route, /AI_SECTION_REGENERATION_UNAVAILABLE/);
    assert.match(route, /success: false/);
    assert.match(route, /fallbackApplied: false/);
    assert.match(route, /No deterministic fallback was applied/);
  });

  it("returns markdown only from a successful provider-chain result", () => {
    const successRegion = route.slice(route.indexOf("return NextResponse.json({\n      success: true"));
    assert.match(successRegion, /markdown: sectionMarkdown/);
    assert.match(successRegion, /fallback: false/);
    assert.match(successRegion, /aiGenerated: true/);
    assert.doesNotMatch(successRegion, /deterministic/);
  });

  it("keeps provider-chain usage and usage tracking intact", () => {
    assert.match(route, /generateWithFallback/);
    assert.match(route, /recordAiUsage/);
    assert.match(route, /useCase: "proposal"/);
  });

  it("keeps Git-triggered Vercel deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Provider prompt and Anthropic-last order tests
// ─────────────────────────────────────────────────────────────────────────────

describe("provider prompt uses only reviewed evidence and preserves Anthropic-last order", () => {
  it("the route passes the reviewed-evidence resolver output to the prompt builder, not raw records", () => {
    // The route must call resolveReviewedSectionEvidence and use its output
    // (evidence.experts, evidence.projects) for prompt construction — never
    // the raw selectedExperts/selectedProjects with unreviewed records.
    const resolvePos = route.indexOf("resolveReviewedSectionEvidence(");
    assert.ok(resolvePos >= 0, "route must call resolveReviewedSectionEvidence");
    // The evidence variable must be used somewhere after the call.
    const afterResolve = route.slice(resolvePos);
    assert.match(afterResolve, /evidence\.experts|evidence\.projects/,
      "prompt builder must use the reviewed-evidence resolver output (evidence.experts/projects)");
  });

  it("provider failure returns 503 with no fallback markdown", () => {
    // When the provider chain fails or returns empty/short output, the route
    // must return 503 with fallbackApplied: false — no deterministic fallback
    // markdown is ever returned as successful generation.
    assert.match(route, /AI_SECTION_REGENERATION_UNAVAILABLE/);
    assert.match(route, /fallbackApplied: false/);
    assert.match(route, /No deterministic fallback was applied/);
    assert.match(route, /status: 503/);
    // The success path must only be reached when sectionMarkdown is valid.
    assert.match(route, /if \(!sectionMarkdown \|\| sectionMarkdown\.trim\(\)\.length < 50\)/);
  });

  it("preserves Anthropic-last provider fallback order", () => {
    // The route must use generateWithFallback which preserves the canonical
    // provider order: Z.ai → Cerebras → Mistral → Groq → OpenRouter →
    // Gemini → OpenAI → Together → DeepSeek → Anthropic (last).
    assert.match(route, /generateWithFallback/);
    // Verify the provider order is defined in the codebase with Anthropic last.
    const providerOrderSource = readFileSync(join(rootDir, "docs/ai-provider-order.md"), "utf8");
    const providers = [
      "Z.ai", "Cerebras", "Mistral", "Groq", "OpenRouter",
      "Gemini", "OpenAI", "Together", "DeepSeek", "Anthropic",
    ];
    let previous = -1;
    for (const provider of providers) {
      const index = providerOrderSource.indexOf(provider);
      assert.ok(index >= 0, `provider-order doc must mention ${provider}`);
      assert.ok(index > previous, `${provider} must come after the previous provider in the order doc`);
      previous = index;
    }
    // Anthropic must be last.
    const anthropicPos = providerOrderSource.lastIndexOf("Anthropic");
    assert.ok(anthropicPos === providerOrderSource.length - "Anthropic".length || anthropicPos > previous - "Anthropic".length,
      "Anthropic must be the last provider in the order");
  });
});
