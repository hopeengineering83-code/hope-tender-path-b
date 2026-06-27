import re

with open('lib/ai.ts', 'r') as f:
    content = f.read()

# 1. Update imports from ai-provider-health
import_pattern = r'import \{.*\} from "./ai-provider-health";'
import_replacement = 'import { recordProviderSuccess, recordProviderFailure, recordProviderAnalysisSuccess, isProviderCooledDown, getProviderRuntimeSnapshot, getProviderStateSnapshot, getDeepSeekApiKey, isDeepSeekConfigured, getDeepSeekModel, getMistralApiKey, isMistralConfigured, getMistralProposalModel, getMistralAnalysisModel, getMistralFastModel, getMistralBaseUrl, getGroqApiKey, isGroqConfigured, getGroqModel, getGroqBaseUrl, getTogetherApiKey, isTogetherConfigured, getTogetherProposalModel, getTogetherAnalysisModel, getTogetherFastModel, getTogetherBaseUrl, getOpenRouterApiKey, isOpenRouterConfigured, getOpenRouterModel, getOpenRouterBaseUrl, getOpenRouterSiteUrl, getOpenRouterAppName, getAnthropicApiKey, isAnthropicConfigured, getGeminiApiKey, isGeminiConfigured, isProviderConfigured, type AiProviderName } from "./ai-provider-health";'
content = re.sub(import_pattern, import_replacement, content)

# 2. Remove top-level process.env reads
content = re.sub(r'const apiKey = process\.env\.GEMINI_API_KEY;', '', content)
content = re.sub(r'const anthropicApiKey = process\.env\.ANTHROPIC_API_KEY;', '', content)
content = re.sub(r'const DEFAULT_GEMINI_MODEL = process\.env\.GEMINI_MODEL \|\| "gemini-2.5-pro";', '', content)
content = re.sub(r'const FALLBACK_GEMINI_MODELS = \(process\.env\.GEMINI_FALLBACK_MODELS \|\| "gemini-2.5-flash,gemini-2.0-flash"\)\s+\.split\(","\)\s+\.map\(\(m\) => m\.trim\(\)\)\s+\.filter\(Boolean\);', '', content)

# 3. Remove CLAUDE_MAX_OUTPUT_TOKENS and CLAUDE_PROPOSAL_MODELS
content = re.sub(r'const _rawModels = \(process\.env\.ANTHROPIC_PROPOSAL_MODELS \|\| "claude-sonnet-4-5,claude-opus-4-1,claude-3-5-sonnet-latest,claude-3-5-haiku-latest"\)\s+\.split\(","\)\s+\.map\(normalizeClaudeModelName\)\s+\.filter\(Boolean\);\s+const CLAUDE_PROPOSAL_MODELS = _rawModels\.length > 0\s+\? _rawModels\s+: \["claude-sonnet-4-5", "claude-3-5-sonnet-latest"\];', '', content)
content = re.sub(r'const CLAUDE_MAX_OUTPUT_TOKENS = \(\(\) => \{[\s\S]*?\}\)\(\);', '', content)

# 4. Add getter functions after normalizeClaudeModelName
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
content = content.replace('return raw\n    .trim()\n    .toLowerCase()\n    .replace(/[._\\s]+/g, "-")\n    .replace(/-+/g, "-")\n    .replace(/^-+|-+$/g, "");\n}', 'return raw\n    .trim()\n    .toLowerCase()\n    .replace(/[._\\s]+/g, "-")\n    .replace(/-+/g, "-")\n    .replace(/^-+|-+$/g, "");\n}\n' + getters)

# 5. Update functions to use getters and new health markers
content = content.replace('if (!apiKey) throw new Error("GEMINI_API_KEY not configured");\n  return new GoogleGenerativeAI(apiKey);', '  const key = getGeminiApiKey();\n  if (!key) throw new Error("GEMINI_API_KEY not configured");\n  return new GoogleGenerativeAI(key);')
content = content.replace('function getModel(modelName = DEFAULT_GEMINI_MODEL) {\n  return getClient().getGenerativeModel({ model: modelName });\n}', 'function getModel(modelName?: string) {\n  return getClient().getGenerativeModel({ model: modelName || getGeminiDefaultModel() });\n}')
content = content.replace('function isClaudeEnabled() {\n  return Boolean(anthropicApiKey);\n}', 'function isClaudeEnabled() {\n  return isAnthropicConfigured();\n}')
content = content.replace('function isGeminiEnabled() {\n  return Boolean(process.env.GEMINI_API_KEY);\n}', 'function isGeminiEnabled() {\n  return isGeminiConfigured();\n}')
content = content.replace('export function isOpenAIEnabled() {\n  return Boolean(process.env.OPENAI_API_KEY);\n}', 'export function isOpenAIEnabled() {\n  return isOpenAIConfigured();\n}')
content = content.replace('if (!anthropicApiKey) return null;', '  const key = getAnthropicApiKey();\n  if (!key) return null;')
content = content.replace('apiKey: anthropicApiKey', 'apiKey: key')
content = content.replace('modelOverride ? [modelOverride] : CLAUDE_PROPOSAL_MODELS', 'modelOverride ? [modelOverride] : getClaudeProposalModels()')
content = content.replace('CLAUDE_MAX_OUTPUT_TOKENS', 'getClaudeMaxOutputTokens()')
content = content.replace('uniqueModels(modelName || DEFAULT_GEMINI_MODEL)', 'uniqueModels(modelName || getGeminiDefaultModel())')
content = content.replace('const openAiKey = process.env.OPENAI_API_KEY;\n  if (!openAiKey) return null;', '  const key = getOpenAIApiKey();\n  if (!key) return null;')
content = content.replace('Authorization: `Bearer ${openAiKey}`', 'Authorization: `Bearer ${key}`')
content = content.replace('function isProviderEnabled(name: AiProviderName): boolean {\n  switch (name) {\n    case "anthropic":  return isClaudeEnabled();\n    case "gemini":     return isGeminiEnabled();\n    case "openai":     return isOpenAIEnabled();\n    case "mistral":    return isMistralConfigured();\n    case "together":   return isTogetherConfigured();\n    case "deepseek":   return isDeepSeekConfigured();\n    case "groq":       return isGroqConfigured();\n    case "openrouter": return isOpenRouterConfigured();\n  }\n}', 'function isProviderEnabled(name: AiProviderName): boolean {\n  return isProviderConfigured(name);\n}')

# 6. Success markers in callProvider
# We need to be careful with replacements here to avoid duplicates or missing ones.
# Gemini is handled specifically because it's a try/catch.
content = content.replace('recordProviderSuccess("gemini");', 'if (opts?.useCase === "extraction") { recordProviderAnalysisSuccess("gemini"); } else { recordProviderSuccess("gemini"); }')

# For others:
for provider in ["anthropic", "openai", "mistral", "deepseek", "groq", "together", "openrouter"]:
    content = content.replace(f'recordProviderSuccess("{provider}");', f'if (opts?.useCase === "extraction") {{ recordProviderAnalysisSuccess("{provider}"); }} else {{ recordProviderSuccess("{provider}"); }}')

with open('lib/ai.ts', 'w') as f:
    f.write(content)
