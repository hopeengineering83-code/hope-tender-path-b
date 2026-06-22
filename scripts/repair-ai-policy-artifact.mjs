import { readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";

const aiPath = "lib/ai.ts";
let ai = readFileSync(aiPath, "utf8");

const enabledPattern = /export function isAIEnabled\(\) \{[\s\S]*?\n\}/;
const enabledReplacement = `export function isAIEnabled() {
  return Boolean(
    isMistralConfigured()
    || isGroqConfigured()
    || isOpenRouterConfigured()
    || apiKey
    || process.env.OPENAI_API_KEY
    || isTogetherConfigured()
    || isDeepSeekConfigured()
    || anthropicApiKey
  );
}`;
if (!enabledPattern.test(ai)) throw new Error("Unable to find isAIEnabled()");
ai = ai.replace(enabledPattern, enabledReplacement);

function replaceBetween(source, afterMarker, startMarker, endMarker, replacement) {
  const anchor = source.indexOf(afterMarker);
  if (anchor < 0) throw new Error(`Missing anchor: ${afterMarker}`);
  const start = source.indexOf(startMarker, anchor);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start) throw new Error(`Unable to isolate ${startMarker}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

const proposalBlock = `  // Mistral — first tier
  if (isMistralEnabled() && !isProviderCooledDown("mistral")) {
    const result = await generateWithMistral(prompt).catch((error) => {
      recordProviderFailure("mistral", error);
      console.warn(\`[ai] Mistral failed for proposal: \${error instanceof Error ? error.message : String(error)}\`);
      return null;
    });
    if (result) { recordProviderSuccess("mistral"); lastProposalProvider = "mistral"; return result; }
  }

  // Groq — second tier
  if (isGroqEnabled() && !isProviderCooledDown("groq")) {
    const result = await generateWithGroq(prompt).catch((error) => {
      recordProviderFailure("groq", error);
      console.warn(\`[ai] Groq failed for proposal: \${error instanceof Error ? error.message : String(error)}\`);
      return null;
    });
    if (result) { recordProviderSuccess("groq"); lastProposalProvider = "groq"; return result; }
  }

  // OpenRouter — third tier
  if (isOpenRouterEnabled() && !isProviderCooledDown("openrouter")) {
    const result = await generateWithOpenRouter(prompt).catch((error) => {
      recordProviderFailure("openrouter", error);
      console.warn(\`[ai] OpenRouter failed for proposal: \${error instanceof Error ? error.message : String(error)}\`);
      return null;
    });
    if (result) { recordProviderSuccess("openrouter"); lastProposalProvider = "openrouter"; return result; }
  }

  // Gemini — fourth tier
  if (apiKey && !isProviderCooledDown("gemini")) {
    try {
      const result = await generateWithBestModel(prompt);
      recordProviderSuccess("gemini");
      lastProposalProvider = "gemini";
      return result;
    } catch (error) {
      recordProviderFailure("gemini", error);
      console.warn(\`[ai] Gemini failed for proposal: \${error instanceof Error ? error.message : String(error)}\`);
    }
  }

  // OpenAI — fifth tier
  if (isOpenAIEnabled() && !isProviderCooledDown("openai")) {
    const result = await generateWithOpenAI(prompt).catch((error) => {
      recordProviderFailure("openai", error);
      console.warn(\`[ai] OpenAI failed for proposal: \${error instanceof Error ? error.message : String(error)}\`);
      return null;
    });
    if (result) { recordProviderSuccess("openai"); lastProposalProvider = "openai"; return result; }
  }

  // Together — sixth tier
  if (isTogetherEnabled() && !isProviderCooledDown("together")) {
    const result = await generateWithTogether(prompt).catch((error) => {
      recordProviderFailure("together", error);
      console.warn(\`[ai] Together failed for proposal: \${error instanceof Error ? error.message : String(error)}\`);
      return null;
    });
    if (result) { recordProviderSuccess("together"); lastProposalProvider = "together"; return result; }
  }

  // DeepSeek — seventh tier
  if (isDeepSeekEnabled() && !isProviderCooledDown("deepseek")) {
    const result = await generateWithDeepSeek(prompt).catch((error) => {
      recordProviderFailure("deepseek", error);
      console.warn(\`[ai] DeepSeek failed for proposal: \${error instanceof Error ? error.message : String(error)}\`);
      return null;
    });
    if (result) { recordProviderSuccess("deepseek"); lastProposalProvider = "deepseek"; return result; }
  }

`;
ai = replaceBetween(
  ai,
  "  // Provider chain for proposal generation:",
  "  // Gemini — first tier",
  "  // Claude (Anthropic) — last resort",
  proposalBlock,
);

const sectionBlock = `  // Mistral — first tier
  if (isMistralEnabled() && !isProviderCooledDown("mistral")) {
    try {
      const text = await Promise.race([
        generateWithMistral(spec.userPrompt, spec.systemPrompt, spec.maxOutputTokens ?? 4096, "proposal"),
        makeSectionTimeout(),
      ]);
      if (text && text.trim().length > 0) {
        recordProviderSuccess("mistral");
        return { id: spec.id, title: spec.title, markdown: text, source: "mistral", durationMs: Date.now() - t0 };
      }
    } catch (error) {
      recordProviderFailure("mistral", error);
      console.warn(\`[ai] section "\${spec.id}" Mistral failed (\${error instanceof Error ? error.message : String(error)}) — trying Groq.\`);
    }
  }

  // Groq — second tier
  if (isGroqEnabled() && !isProviderCooledDown("groq")) {
    try {
      const text = await Promise.race([generateWithGroq(spec.userPrompt, spec.systemPrompt), makeSectionTimeout()]);
      if (text && text.trim().length > 0) {
        recordProviderSuccess("groq");
        return { id: spec.id, title: spec.title, markdown: text, source: "groq", durationMs: Date.now() - t0 };
      }
    } catch (error) {
      recordProviderFailure("groq", error);
      console.warn(\`[ai] section "\${spec.id}" Groq failed (\${error instanceof Error ? error.message : String(error)}) — trying OpenRouter.\`);
    }
  }

  // OpenRouter — third tier
  if (isOpenRouterEnabled() && !isProviderCooledDown("openrouter")) {
    try {
      const text = await Promise.race([generateWithOpenRouter(spec.userPrompt, spec.systemPrompt), makeSectionTimeout()]);
      if (text && text.trim().length > 0) {
        recordProviderSuccess("openrouter");
        return { id: spec.id, title: spec.title, markdown: text, source: "openrouter", durationMs: Date.now() - t0 };
      }
    } catch (error) {
      recordProviderFailure("openrouter", error);
      console.warn(\`[ai] section "\${spec.id}" OpenRouter failed (\${error instanceof Error ? error.message : String(error)}) — trying Gemini.\`);
    }
  }

  // Gemini — fourth tier
  if (apiKey && !isProviderCooledDown("gemini")) {
    try {
      const geminiPrompt = \`\${spec.systemPrompt}\\n\\n---\\n\\n\${spec.userPrompt}\`;
      const text = await Promise.race([generateWithBestModel(geminiPrompt), makeSectionTimeout()]);
      if (text && text.trim().length > 0) {
        recordProviderSuccess("gemini");
        return { id: spec.id, title: spec.title, markdown: text, source: "gemini", durationMs: Date.now() - t0 };
      }
    } catch (error) {
      recordProviderFailure("gemini", error);
      console.warn(\`[ai] section "\${spec.id}" Gemini failed (\${error instanceof Error ? error.message : String(error)}) — trying OpenAI.\`);
    }
  }

  // OpenAI — fifth tier
  if (isOpenAIEnabled() && !isProviderCooledDown("openai")) {
    try {
      const text = await Promise.race([
        generateWithOpenAI(spec.userPrompt, spec.systemPrompt, spec.maxOutputTokens ?? 4096),
        makeSectionTimeout(),
      ]);
      if (text && text.trim().length > 0) {
        recordProviderSuccess("openai");
        return { id: spec.id, title: spec.title, markdown: text, source: "openai", durationMs: Date.now() - t0 };
      }
    } catch (error) {
      recordProviderFailure("openai", error);
      console.warn(\`[ai] section "\${spec.id}" OpenAI failed (\${error instanceof Error ? error.message : String(error)}) — trying Together.\`);
    }
  }

  // Together — sixth tier
  if (isTogetherEnabled() && !isProviderCooledDown("together")) {
    try {
      const text = await Promise.race([
        generateWithTogether(spec.userPrompt, spec.systemPrompt, spec.maxOutputTokens ?? 4096, "proposal"),
        makeSectionTimeout(),
      ]);
      if (text && text.trim().length > 0) {
        recordProviderSuccess("together");
        return { id: spec.id, title: spec.title, markdown: text, source: "together", durationMs: Date.now() - t0 };
      }
    } catch (error) {
      recordProviderFailure("together", error);
      console.warn(\`[ai] section "\${spec.id}" Together failed (\${error instanceof Error ? error.message : String(error)}) — trying DeepSeek.\`);
    }
  }

  // DeepSeek — seventh tier
  if (isDeepSeekEnabled() && !isProviderCooledDown("deepseek")) {
    try {
      const text = await Promise.race([
        generateWithDeepSeek(spec.userPrompt, spec.systemPrompt, spec.maxOutputTokens ?? 4096),
        makeSectionTimeout(),
      ]);
      if (text && text.trim().length > 0) {
        recordProviderSuccess("deepseek");
        return { id: spec.id, title: spec.title, markdown: text, source: "deepseek", durationMs: Date.now() - t0 };
      }
    } catch (error) {
      recordProviderFailure("deepseek", error);
      console.warn(\`[ai] section "\${spec.id}" DeepSeek failed (\${error instanceof Error ? error.message : String(error)}) — trying Claude.\`);
    }
  }

`;
ai = replaceBetween(
  ai,
  "  // Provider chain for sections:",
  "  // Gemini — first tier",
  "  // Claude — last resort",
  sectionBlock,
);

const envPath = ".env.example";
let env = readFileSync(envPath, "utf8");
const oldHeader = `# Default order: OpenAI → Gemini → Mistral → DeepSeek → Groq → Together →
# OpenRouter → Claude/Anthropic. Analysis/extraction: Gemini → OpenAI →
# Mistral → Together → DeepSeek → Groq → OpenRouter → Claude.`;
const newHeader = `# Canonical order for analysis, extraction, proposal, validation, fast, and reasoning:
# Z.ai GLM → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic / Claude.
# The first configured and healthy provider is used; cooled-down providers are skipped.`;
// Tolerant of the header already being fixed in source (e.g. by PR #782 which
// permanently fixed the stale provider-order header in .env.example). When the
// stale header is no longer present, the .env.example patch is a no-op rather
// than a hard error — the script's job for this file is already done.
if (env.includes(oldHeader)) {
  env = env.replace(oldHeader, newHeader);
}
const oldGeminiNote = "# Gemini is the primary analysis/extraction provider and second provider in\n# the default proposal chain.";
const newGeminiNote = "# Gemini is the fourth provider in the canonical chain. It remains a high-quality\n# analysis, extraction, and proposal fallback after Mistral, Groq, and OpenRouter.";
if (env.includes(oldGeminiNote)) {
  env = env.replace(oldGeminiNote, newGeminiNote);
}
env = env.replace(
  '# BLOB_READ_WRITE_TOKEN=""',
  '# BLOB_READ_WRITE_TOKEN=""\n# When Blob is absent, files up to 5 MiB use the bounded database fallback by default.\n# Set false only after durable Blob storage is configured and verified.\n# ALLOW_DB_FILE_STORAGE="true"',
);

mkdirSync("repair-artifact/lib", { recursive: true });
writeFileSync("repair-artifact/lib/ai.ts", ai);
writeFileSync("repair-artifact/.env.example", env);
cpSync("tests/ai-provider-chain-policy.test.ts", "repair-artifact/ai-provider-chain-policy.test.ts");
console.log("Generated deterministic AI policy repair artifact.");
