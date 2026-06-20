import re

with open('lib/ai.ts', 'r') as f:
    content = f.read()

# Replace top-level process.env reads
content = re.sub(r'const apiKey = process\.env\.GEMINI_API_KEY;', '', content)
content = re.sub(r'const anthropicApiKey = process\.env\.ANTHROPIC_API_KEY;', '', content)
content = re.sub(r'const DEFAULT_GEMINI_MODEL = process\.env\.GEMINI_MODEL \|\| "gemini-2.5-pro";', '', content)
content = re.sub(r'const FALLBACK_GEMINI_MODELS = \(process\.env\.GEMINI_FALLBACK_MODELS \|\| "gemini-2.5-flash,gemini-2.0-flash"\)\s+\.split\(","\)\s+\.map\(\(m\) => m\.trim\(\)\)\s+\.filter\(Boolean\);', '', content)

# Remove CLAUDE_MAX_OUTPUT_TOKENS and CLAUDE_PROPOSAL_MODELS
content = re.sub(r'const _rawModels = \(process\.env\.ANTHROPIC_PROPOSAL_MODELS \|\| "claude-sonnet-4-5,claude-opus-4-1,claude-3-5-sonnet-latest,claude-3-5-haiku-latest"\)\s+\.split\(","\)\s+\.map\(normalizeClaudeModelName\)\s+\.filter\(Boolean\);\s+const CLAUDE_PROPOSAL_MODELS = _rawModels\.length > 0\s+\? _rawModels\s+: \["claude-sonnet-4-5", "claude-3-5-sonnet-latest"\];', '', content)

content = re.sub(r'const CLAUDE_MAX_OUTPUT_TOKENS = \(\(\) => \{[\s\S]*?\}\)\(\);', '', content)

# Add getter functions
getters = """
function getGeminiDefaultModel() {
  return process.env.GEMINI_MODEL || "gemini-2.5-pro";
}

function getGeminiFallbackModels() {
  return (process.env.GEMINI_FALLBACK_MODELS || "gemini-2.5-flash,gemini-2.0-flash")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

function getClaudeProposalModels() {
  const _rawModels = (process.env.ANTHROPIC_PROPOSAL_MODELS || "claude-sonnet-4-5,claude-opus-4-1,claude-3-5-sonnet-latest,claude-3-5-haiku-latest")
    .split(",")
    .map(normalizeClaudeModelName)
    .filter(Boolean);
  return _rawModels.length > 0
    ? _rawModels
    : ["claude-sonnet-4-5", "claude-3-5-sonnet-latest"];
}

function getClaudeMaxOutputTokens() {
  const raw = Number(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS);
  if (Number.isFinite(raw) && raw > 0) return Math.min(raw, 64000);
  const tier = (process.env.ANTHROPIC_TIER || "").trim();
  return tier === "1" ? 8000 : 16000;
}
"""

# Insert getters after normalizeClaudeModelName
content = content.replace('return raw\n    .trim()\n    .toLowerCase()\n    .replace(/[._\\s]+/g, "-")\n    .replace(/-+/g, "-")\n    .replace(/^-+|-+$/g, "");\n}', 'return raw\n    .trim()\n    .toLowerCase()\n    .replace(/[._\\s]+/g, "-")\n    .replace(/-+/g, "-")\n    .replace(/^-+|-+$/g, "");\n}\n' + getters)

# Update getClient and getModel
content = content.replace('if (!apiKey) throw new Error("GEMINI_API_KEY not configured");\n  return new GoogleGenerativeAI(apiKey);', '  const key = getGeminiApiKey();\n  if (!key) throw new Error("GEMINI_API_KEY not configured");\n  return new GoogleGenerativeAI(key);')
content = content.replace('function getModel(modelName = DEFAULT_GEMINI_MODEL) {\n  return getClient().getGenerativeModel({ model: modelName });\n}', 'function getModel(modelName?: string) {\n  return getClient().getGenerativeModel({ model: modelName || getGeminiDefaultModel() });\n}')

# Update isClaudeEnabled and isGeminiEnabled
content = content.replace('function isClaudeEnabled() {\n  return Boolean(anthropicApiKey);\n}', 'function isClaudeEnabled() {\n  return isAnthropicConfigured();\n}')
content = content.replace('function isGeminiEnabled() {\n  return Boolean(process.env.GEMINI_API_KEY);\n}', 'function isGeminiEnabled() {\n  return isGeminiConfigured();\n}')

# Update generateWithClaude
content = content.replace('if (!anthropicApiKey) return null;', '  const key = getAnthropicApiKey();\n  if (!key) return null;')
content = content.replace('apiKey: anthropicApiKey', 'apiKey: key')
content = content.replace('modelOverride ? [modelOverride] : CLAUDE_PROPOSAL_MODELS', 'modelOverride ? [modelOverride] : getClaudeProposalModels()')
content = content.replace('CLAUDE_MAX_OUTPUT_TOKENS', 'getClaudeMaxOutputTokens()')

# Update generate
content = content.replace('uniqueModels(modelName || DEFAULT_GEMINI_MODEL)', 'uniqueModels(modelName || getGeminiDefaultModel())')

# Update generateWithOpenAI
content = content.replace('const openAiKey = process.env.OPENAI_API_KEY;\n  if (!openAiKey) return null;', '  const key = getOpenAIApiKey();\n  if (!key) return null;')
content = content.replace('Authorization: `Bearer ${openAiKey}`', 'Authorization: `Bearer ${key}`')

# Update isOpenAIEnabled
content = content.replace('export function isOpenAIEnabled() {\n  return Boolean(process.env.OPENAI_API_KEY);\n}', 'export function isOpenAIEnabled() {\n  return isOpenAIConfigured();\n}')

# Update isProviderEnabled
content = content.replace(
    'function isProviderEnabled(name: AiProviderName): boolean {\n  switch (name) {\n    case "anthropic":  return isClaudeEnabled();\n    case "gemini":     return isGeminiEnabled();\n    case "openai":     return isOpenAIEnabled();\n    case "mistral":    return isMistralConfigured();\n    case "together":   return isTogetherConfigured();\n    case "deepseek":   return isDeepSeekConfigured();\n    case "groq":       return isGroqConfigured();\n    case "openrouter": return isOpenRouterConfigured();\n  }\n}',
    'function isProviderEnabled(name: AiProviderName): boolean {\n  return isProviderConfigured(name);\n}'
)

# Update callProvider success markers
content = content.replace(
    'if (r) { recordProviderSuccess("anthropic"); return r; }',
    'if (r) { if (opts?.useCase === "extraction") { recordProviderAnalysisSuccess("anthropic"); } else { recordProviderSuccess("anthropic"); } return r; }'
)
content = content.replace(
    'recordProviderSuccess("gemini");',
    'if (opts?.useCase === "extraction") { recordProviderAnalysisSuccess("gemini"); } else { recordProviderSuccess("gemini"); }'
)
content = content.replace(
    'if (r) { recordProviderSuccess("openai"); return r; }',
    'if (r) { if (opts?.useCase === "extraction") { recordProviderAnalysisSuccess("openai"); } else { recordProviderSuccess("openai"); } return r; }'
)
content = content.replace(
    'if (r) { recordProviderSuccess("mistral"); return r; }',
    'if (r) { if (opts?.useCase === "extraction") { recordProviderAnalysisSuccess("mistral"); } else { recordProviderSuccess("mistral"); } return r; }'
)
content = content.replace(
    'if (r) { recordProviderSuccess("deepseek"); return r; }',
    'if (r) { if (opts?.useCase === "extraction") { recordProviderAnalysisSuccess("deepseek"); } else { recordProviderSuccess("deepseek"); } return r; }'
)
content = content.replace(
    'if (r) { recordProviderSuccess("groq"); return r; }',
    'if (r) { if (opts?.useCase === "extraction") { recordProviderAnalysisSuccess("groq"); } else { recordProviderSuccess("groq"); } return r; }'
)
content = content.replace(
    'if (r) { recordProviderSuccess("together"); return r; }',
    'if (r) { if (opts?.useCase === "extraction") { recordProviderAnalysisSuccess("together"); } else { recordProviderSuccess("together"); } return r; }'
)
content = content.replace(
    'if (r) { recordProviderSuccess("openrouter"); return r; }',
    'if (r) { if (opts?.useCase === "extraction") { recordProviderAnalysisSuccess("openrouter"); } else { recordProviderSuccess("openrouter"); } return r; }'
)

with open('lib/ai.ts', 'w') as f:
    f.write(content)
