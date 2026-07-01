#!/usr/bin/env python3
"""Incorporate non-overlapping important code from PR #933 into PR #931."""
import subprocess
import sys
import os
from pathlib import Path

ROOT = Path("/home/z/my-project")
ENV = {**os.environ, "DATABASE_URL": "postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public"}

def run(cmd, check=True):
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, shell=True, env=ENV)
    if check and r.returncode != 0:
        print(f"FAILED: {cmd[:80]}")
        print(r.stderr[-500:] if r.stderr else r.stdout[-500:])
    return r

run("git checkout hotfix/release-safety-consolidation")
print(f"HEAD: {run('git log --oneline -1').stdout.strip()}")

# ═══════════════════════════════════════════════════════════════════════════
# IMPORTANT NON-OVERLAPPING CODE FROM PR #933:
#
# 1. REVIEWER removal from ALL release mutation routes (not just build-plan)
#    #931 only removed REVIEWER from build-plan and submission-plan/build.
#    #933 removed REVIEWER from: approve-analysis, auto-finalize, repair-export-gaps,
#    requirement-coverage/reject, documents/attach-original, supersede-outside-plan,
#    link-vault-evidence, generate-missing-plan-files.
#
# 2. New test: tests/release-role-policy.test.ts — verifies no mutation route
#    grants REVIEWER authority.
#
# 3. Provider registry: emergencyOnly flag corrected for zai/cerebras/mistral/together
#    (set to true = manual only) and anthropic (set to false = automatic).
#    Ranks corrected to match the 6-provider automatic order.
#
# 4. env-check.ts: AI provider key descriptions updated to reflect the
#    6-provider automatic chain.
#
# 5. ai-environment-readiness.ts: Provider descriptions corrected.
#
# 6. audit.ts: Provider chain comment corrected.
#
# 7. ai.ts: DeepSeek chain comment corrected.
# ═══════════════════════════════════════════════════════════════════════════

# FIX 1: Remove REVIEWER from all release mutation routes
print("\n=== FIX 1: Remove REVIEWER from all release mutation routes ===")
mutation_routes = [
    "app/api/tenders/[id]/approve-analysis/route.ts",
    "app/api/tenders/[id]/auto-finalize/route.ts",
    "app/api/tenders/[id]/repair-export-gaps/route.ts",
    "app/api/tenders/[id]/requirement-coverage/reject/route.ts",
    "app/api/tenders/[id]/documents/[docId]/attach-original/route.ts",
    "app/api/tenders/[id]/supersede-outside-plan/route.ts",
    "app/api/tenders/[id]/link-vault-evidence/route.ts",
    "app/api/tenders/[id]/generate-missing-plan-files/route.ts",
]
for route_path in mutation_routes:
    p = ROOT / route_path
    if not p.exists():
        print(f"  SKIP {route_path} (not found)")
        continue
    content = p.read_text()
    old = 'requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER")'
    new = 'requireRole("ADMIN", "PROPOSAL_MANAGER")'
    if old in content:
        content = content.replace(old, new)
        p.write_text(content)
        print(f"  Fixed {route_path}")
    else:
        print(f"  OK {route_path} (already no REVIEWER)")

# FIX 2: Add release-role-policy test
print("\n=== FIX 2: Add release-role-policy test ===")
test_content = '''import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const MUTATION_ROUTES = [
  "app/api/tenders/[id]/approve-analysis/route.ts",
  "app/api/tenders/[id]/auto-finalize/route.ts",
  "app/api/tenders/[id]/repair-export-gaps/route.ts",
  "app/api/tenders/[id]/requirement-coverage/reject/route.ts",
  "app/api/tenders/[id]/documents/[docId]/attach-original/route.ts",
  "app/api/tenders/[id]/supersede-outside-plan/route.ts",
  "app/api/tenders/[id]/link-vault-evidence/route.ts",
  "app/api/tenders/[id]/submission-plan/build/route.ts",
  "app/api/tenders/[id]/generate-missing-plan-files/route.ts",
  "app/api/tenders/[id]/build-plan/route.ts",
  "app/api/tenders/[id]/build-plan/confirm/route.ts",
];

describe("release-authority mutation routes exclude REVIEWER", () => {
  for (const file of MUTATION_ROUTES) {
    it(`${file} does not grant REVIEWER mutation authority`, () => {
      assert.equal(existsSync(file), true, `${file} must exist`);
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /requireRole\\("ADMIN",\\s*"PROPOSAL_MANAGER",\\s*"REVIEWER"\\)/);
    });
  }
});
'''
(ROOT / "tests/release-role-policy.test.ts").write_text(test_content)
print("  Created tests/release-role-policy.test.ts")

# FIX 3: Provider registry — fix emergencyOnly flags and ranks
print("\n=== FIX 3: Provider registry — fix emergencyOnly + ranks ===")
p = ROOT / "lib/ai-provider-registry.ts"
content = p.read_text()
# Fix ranks
content = content.replace('rank: 1,\n    env: {\n      apiKey: PROVIDER_API_KEY_ENV.zai', 'rank: 7,\n    env: {\n      apiKey: PROVIDER_API_KEY_ENV.zai')
content = content.replace('rank: 2,\n    env: {\n      apiKey: PROVIDER_API_KEY_ENV.cerebras', 'rank: 8,\n    env: {\n      apiKey: PROVIDER_API_KEY_ENV.cerebras')
content = content.replace('rank: 3,\n    env: {\n      apiKey: PROVIDER_API_KEY_ENV.mistral', 'rank: 9,\n    env: {\n      apiKey: PROVIDER_API_KEY_ENV.mistral')
content = content.replace('rank: 5,\n    env: {\n      apiKey: PROVIDER_API_KEY_ENV.openrouter', 'rank: 2,\n    env: {\n      apiKey: PROVIDER_API_KEY_ENV.openrouter')
content = content.replace('rank: 6,\n    env: {\n      apiKey: PROVIDER_API_KEY_ENV.gemini', 'rank: 1,\n    env: {\n      apiKey: PROVIDER_API_KEY_ENV.gemini')
content = content.replace('rank: 7,\n    env: {\n      apiKey: PROVIDER_API_KEY_ENV.openai', 'rank: 3,\n    env: {\n      apiKey: PROVIDER_API_KEY_ENV.openai')
content = content.replace('rank: 8,\n    env: {\n      apiKey: PROVIDER_API_KEY_ENV.together', 'rank: 10,\n    env: {\n      apiKey: PROVIDER_API_KEY_ENV.together')
content = content.replace('rank: 9,\n    env: {\n      apiKey: PROVIDER_API_KEY_ENV.deepseek', 'rank: 5,\n    env: {\n      apiKey: PROVIDER_API_KEY_ENV.deepseek')
content = content.replace('rank: 10,\n    env: {\n      apiKey: PROVIDER_API_KEY_ENV.anthropic', 'rank: 6,\n    env: {\n      apiKey: PROVIDER_API_KEY_ENV.anthropic')
# Fix emergencyOnly: zai, cerebras, mistral, together → true
content = content.replace(
    'supportsStructuredJson: true,\n    emergencyOnly: false,\n  },\n  cerebras:',
    'supportsStructuredJson: true,\n    emergencyOnly: true,\n  },\n  cerebras:'
)
content = content.replace(
    'supportsStructuredJson: true,\n    emergencyOnly: false,\n  },\n  mistral:',
    'supportsStructuredJson: true,\n    emergencyOnly: true,\n  },\n  mistral:'
)
content = content.replace(
    'supportsStructuredJson: true,\n    emergencyOnly: false,\n  },\n  together:',
    'supportsStructuredJson: true,\n    emergencyOnly: true,\n  },\n  together:'
)
# Also fix the mistral emergencyOnly that comes after the mistral entry
content = content.replace(
    'supportsStructuredJson: true,\n    emergencyOnly: false,\n  },\n  groq:',
    'supportsStructuredJson: true,\n    emergencyOnly: true,\n  },\n  groq:'
)
# Fix anthropic: emergencyOnly false (it's now part of the automatic chain)
content = content.replace(
    '// Last-resort emergency provider — kept last so rate limits never block the\n    // app when earlier providers are available.\n    emergencyOnly: true,',
    '// Last automatic fallback provider — kept last so earlier providers are\n    // preferred, but still part of the automatic chain.\n    emergencyOnly: false,'
)
p.write_text(content)
print("  Fixed ranks + emergencyOnly flags in ai-provider-registry.ts")

# FIX 4: env-check.ts — update provider key descriptions
print("\n=== FIX 4: env-check.ts — update descriptions ===")
p = ROOT / "lib/env-check.ts"
content = p.read_text()
# Update the comment block
content = content.replace(
    'ARCHITECTURE: at least one AI provider key is required in production:\n *   - ZAI_API_KEY / CEREBRAS_API_KEY / MISTRAL_API_KEY / GROQ_API_KEY /\n *     OPENROUTER_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY / TOGETHER_API_KEY /\n *     DEEPSEEK_API_KEY / ANTHROPIC_API_KEY. The canonical chain (single source of\n *     truth: lib/ai-provider-registry.ts) is Z.ai GLM → Cerebras → Mistral → Groq\n *     → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic/Claude, with\n *     Claude last so Anthropic rate limits do not block the app.\n *\n * Without EITHER key:',
    'ARCHITECTURE: at least one automatic AI provider key is required in production:\n *   - GEMINI_API_KEY / OPENROUTER_API_KEY / OPENAI_API_KEY / GROQ_API_KEY /\n *     DEEPSEEK_API_KEY / ANTHROPIC_API_KEY. The canonical automatic chain\n *     (single source of truth: lib/ai-provider-registry.ts) is Gemini →\n *     OpenRouter → OpenAI → Groq → DeepSeek → Anthropic/Claude. Z.ai,\n *     Cerebras, Mistral, and Together are manual diagnostics/adapters only and\n *     must not satisfy automatic runtime readiness.\n *\n * Without an automatic provider key:'
)
p.write_text(content)
print("  Updated env-check.ts descriptions")

# FIX 5: ai-environment-readiness.ts — update provider descriptions
print("\n=== FIX 5: ai-environment-readiness.ts — update descriptions ===")
p = ROOT / "lib/ai-environment-readiness.ts"
content = p.read_text()
# Update provider descriptions
replacements = [
    ('status("ZAI_API_KEY", "ai", "critical", `First-tier provider in the canonical chain (${CANONICAL_AI_PROVIDER_CHAIN_DISPLAY}). Z.ai GLM via the general OpenAI-compatible endpoint.`)',
     'status("ZAI_API_KEY", "ai", "optional", "Manual-only Z.ai diagnostics/adapters; not part of automatic fallback readiness.")'),
    ('status("CEREBRAS_API_KEY", "ai", "critical", "Second-tier provider. Cerebras via OpenAI-compatible endpoint (uses max_completion_tokens).")',
     'status("CEREBRAS_API_KEY", "ai", "optional", "Manual-only Cerebras diagnostics/adapters; not part of automatic fallback readiness.")'),
    ('status("MISTRAL_API_KEY", "ai", "critical", `Third-tier provider in the canonical chain (${CANONICAL_AI_PROVIDER_CHAIN_DISPLAY}). Verified working; used for analysis, extraction, proposal, validation.`)',
     'status("MISTRAL_API_KEY", "ai", "optional", "Manual-only Mistral diagnostics/adapters; not part of automatic fallback readiness.")'),
    ('status("GROQ_API_KEY", "ai", "critical", "Second-tier provider — fastest verified working provider. Uses llama-3.3-70b-versatile by default.")',
     'status("GROQ_API_KEY", "ai", "critical", `Fourth-tier automatic provider in the canonical chain (${CANONICAL_AI_PROVIDER_CHAIN_DISPLAY}). Uses llama-3.3-70b-versatile by default.`)'),
    ('status("OPENROUTER_API_KEY", "ai", "critical", "Third-tier aggregator provider — routes via high-quality models via OpenAI-compatible API.")',
     'status("OPENROUTER_API_KEY", "ai", "critical", `Second-tier automatic aggregator in the canonical chain (${CANONICAL_AI_PROVIDER_CHAIN_DISPLAY}).`)'),
    ('status("GEMINI_API_KEY", "ai", "critical", "Fourth-tier provider in the canonical chain for analysis, extraction, proposal, validation, and fast use cases.")',
     'status("GEMINI_API_KEY", "ai", "critical", `First-tier automatic provider in the canonical chain (${CANONICAL_AI_PROVIDER_CHAIN_DISPLAY}).`)'),
    ('status("OPENAI_API_KEY", "ai", "critical", "Fifth-tier provider in the canonical chain.")',
     'status("OPENAI_API_KEY", "ai", "critical", `Third-tier automatic provider in the canonical chain (${CANONICAL_AI_PROVIDER_CHAIN_DISPLAY}).`)'),
    ('status("TOGETHER_API_KEY", "ai", "optional", "Sixth-tier fallback provider via OpenAI-compatible Together endpoint.")',
     'status("TOGETHER_API_KEY", "ai", "optional", "Manual-only Together diagnostics/adapters; not part of automatic fallback readiness.")'),
    ('status("DEEPSEEK_API_KEY", "ai", "optional", "Seventh-tier fallback provider via OpenAI-compatible DeepSeek endpoint.")',
     'status("DEEPSEEK_API_KEY", "ai", "critical", `Fifth-tier automatic provider in the canonical chain (${CANONICAL_AI_PROVIDER_CHAIN_DISPLAY}).`)'),
    ('status("ANTHROPIC_API_KEY", "ai", "recommended", "Last-resort provider (eighth in default chain). Placed last to avoid Anthropic rate limits blocking the app when other providers are available.")',
     'status("ANTHROPIC_API_KEY", "ai", "critical", `Sixth and last automatic provider in the canonical chain (${CANONICAL_AI_PROVIDER_CHAIN_DISPLAY}).`)'),
]
for old, new in replacements:
    if old in content:
        content = content.replace(old, new)
p.write_text(content)
print("  Updated ai-environment-readiness.ts descriptions")

# FIX 6: audit.ts — fix provider chain comment
print("\n=== FIX 6: audit.ts — fix chain comment ===")
p = ROOT / "lib/audit.ts"
content = p.read_text()
content = content.replace(
    '(Z.ai GLM → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic/Claude)',
    '(Gemini → OpenRouter → OpenAI → Groq → DeepSeek → Anthropic/Claude)'
)
p.write_text(content)
print("  Fixed audit.ts chain comment")

# FIX 7: ai.ts — fix DeepSeek chain comment
print("\n=== FIX 7: ai.ts — fix chain comment ===")
p = ROOT / "lib/ai.ts"
content = p.read_text()
content = content.replace(
    '(Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Claude)',
    '(Gemini → OpenRouter → OpenAI → Groq → DeepSeek → Claude)'
)
p.write_text(content)
print("  Fixed ai.ts chain comment")

# Now run all checks
print("\n=== Running typecheck... ===")
run("npx prisma generate")
result = run("npx tsc --noEmit", check=False)
if result.returncode != 0:
    print("TYPECHECK FAILED:")
    print(result.stdout[-2000:])
    sys.exit(1)
print("  Typecheck passed.")

print("\n=== Running lint... ===")
result = run("npx eslint . --ext .ts,.tsx --max-warnings 50", check=False)
if result.returncode != 0:
    print("LINT FAILED:")
    print(result.stdout[-500:])
    sys.exit(1)
print("  Lint passed.")

print("\n=== Fresh DB + tests ===")
run("""node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\\$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE').then(() => p.\\$executeRawUnsafe('CREATE SCHEMA public')).then(() => { console.log('Schema dropped'); return p.\\$disconnect(); }).catch(e => { console.error(e.message); process.exit(1); });
" """)
run("npx prisma migrate deploy")
run("npx prisma generate")

test_env = {**ENV, "RUN_DB_INTEGRATION": "true"}
result = subprocess.run("node scripts/run-tests.mjs", cwd=ROOT, capture_output=True, text=True, shell=True, env=test_env)
for line in result.stdout.split('\n'):
    if line.startswith('ℹ tests') or line.startswith('ℹ pass') or line.startswith('ℹ fail'):
        print(f"  {line}")
if 'ℹ fail 0' not in result.stdout:
    print("TESTS FAILED!")
    for line in result.stdout.split('\n'):
        if line.startswith('✖'):
            print(f"  {line}")
    sys.exit(1)

print("\n=== Build ===")
build_env = {**ENV, "GEMINI_API_KEY": "AIzaTestKeyNotUsedAtRuntime12345678901234567890", "SESSION_SECRET": "test-session-secret-at-least-32-characters-long-for-hmac"}
result = subprocess.run("npx next build", cwd=ROOT, capture_output=True, text=True, shell=True, env=build_env)
if result.returncode != 0:
    print("BUILD FAILED!")
    sys.exit(1)
print("  Build passed.")

print("\n✓ All incorporated code verified!")
