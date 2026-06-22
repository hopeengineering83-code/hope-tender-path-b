import type { AiProviderName } from "./ai-provider-health";

export const CANONICAL_AI_PROVIDER_ORDER: readonly AiProviderName[] = [
  "zai",
  "cerebras",
  "mistral",
  "groq",
  "openrouter",
  "gemini",
  "openai",
  "together",
  "deepseek",
  "anthropic",
] as const;

export type CanonicalAiProvider = AiProviderName;

export type AiUseCase = "analysis" | "proposal" | "fast" | "default" | "extraction" | "validation" | "reasoning";

export interface ProviderMetadata {
  id: AiProviderName;
  displayName: string;
  rank: number;
  envVars: {
    apiKey: string;
    baseUrl?: string;
    models: Partial<Record<AiUseCase, string>>;
  };
  defaults: {
    baseUrl?: string;
    models: Partial<Record<AiUseCase, string>>;
  };
  outputCaps: Partial<Record<AiUseCase, number>>;
  timeoutMs: number;
  maxRetries: number;
  supportsJson: boolean;
  emergencyOnly: boolean;
  isOpenAiCompatible: boolean;
}

export const AI_PROVIDER_REGISTRY: Record<AiProviderName, ProviderMetadata> = {
  zai: {
    id: "zai",
    displayName: "Z.ai GLM",
    rank: 1,
    envVars: {
      apiKey: "ZAI_API_KEY",
      baseUrl: "ZAI_BASE_URL",
      models: {
        analysis: "ZAI_ANALYSIS_MODEL",
        proposal: "ZAI_PROPOSAL_MODEL",
        fast: "ZAI_FAST_MODEL",
      },
    },
    defaults: {
      baseUrl: "https://api.z.ai/api/paas/v4",
      models: {
        analysis: "glm-4.7-flash",
        proposal: "glm-4.7-flash",
        fast: "glm-4.7-flash",
      },
    },
    outputCaps: {
      analysis: 3000,
      proposal: 4000,
      fast: 1200,
    },
    timeoutMs: 30000,
    maxRetries: 2,
    supportsJson: true,
    emergencyOnly: false,
    isOpenAiCompatible: true,
  },
  cerebras: {
    id: "cerebras",
    displayName: "Cerebras",
    rank: 2,
    envVars: {
      apiKey: "CEREBRAS_API_KEY",
      baseUrl: "CEREBRAS_BASE_URL",
      models: {
        analysis: "CEREBRAS_ANALYSIS_MODEL",
        proposal: "CEREBRAS_PROPOSAL_MODEL",
        fast: "CEREBRAS_FAST_MODEL",
      },
    },
    defaults: {
      baseUrl: "https://api.cerebras.ai/v1",
      models: {
        analysis: "gpt-oss-120b",
        proposal: "gpt-oss-120b",
        fast: "gpt-oss-120b",
      },
    },
    outputCaps: {
      analysis: 3000,
      proposal: 4000,
      fast: 1200,
    },
    timeoutMs: 30000,
    maxRetries: 2,
    supportsJson: true,
    emergencyOnly: false,
    isOpenAiCompatible: true,
  },
  mistral: {
    id: "mistral",
    displayName: "Mistral",
    rank: 3,
    envVars: {
      apiKey: "MISTRAL_API_KEY",
      baseUrl: "MISTRAL_BASE_URL",
      models: {
        analysis: "MISTRAL_ANALYSIS_MODEL",
        proposal: "MISTRAL_PROPOSAL_MODEL",
        fast: "MISTRAL_FAST_MODEL",
      },
    },
    defaults: {
      baseUrl: "https://api.mistral.ai/v1",
      models: {
        analysis: "mistral-small-latest",
        proposal: "mistral-small-latest",
        fast: "mistral-small-latest",
      },
    },
    outputCaps: {
      analysis: 3000,
      proposal: 4000,
      fast: 1200,
    },
    timeoutMs: 30000,
    maxRetries: 2,
    supportsJson: true,
    emergencyOnly: false,
    isOpenAiCompatible: true,
  },
  groq: {
    id: "groq",
    displayName: "Groq",
    rank: 4,
    envVars: {
      apiKey: "GROQ_API_KEY",
      baseUrl: "GROQ_BASE_URL",
      models: {
        analysis: "GROQ_MODEL",
        proposal: "GROQ_MODEL",
        fast: "GROQ_MODEL",
      },
    },
    defaults: {
      baseUrl: "https://api.groq.com/openai/v1",
      models: {
        analysis: "llama-3.3-70b-versatile",
        proposal: "llama-3.3-70b-versatile",
        fast: "llama-3.3-70b-versatile",
      },
    },
    outputCaps: {
      analysis: 3000,
      proposal: 4000,
      fast: 1200,
    },
    timeoutMs: 30000,
    maxRetries: 2,
    supportsJson: true,
    emergencyOnly: false,
    isOpenAiCompatible: true,
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    rank: 5,
    envVars: {
      apiKey: "OPENROUTER_API_KEY",
      baseUrl: "OPENROUTER_BASE_URL",
      models: {
        analysis: "OPENROUTER_MODEL",
        proposal: "OPENROUTER_MODEL",
        fast: "OPENROUTER_MODEL",
      },
    },
    defaults: {
      baseUrl: "https://openrouter.ai/api/v1",
      models: {
        analysis: "mistralai/mistral-7b-instruct:free",
        proposal: "mistralai/mistral-7b-instruct:free",
        fast: "mistralai/mistral-7b-instruct:free",
      },
    },
    outputCaps: {
      analysis: 3000,
      proposal: 4000,
      fast: 1200,
    },
    timeoutMs: 30000,
    maxRetries: 2,
    supportsJson: true,
    emergencyOnly: false,
    isOpenAiCompatible: true,
  },
  gemini: {
    id: "gemini",
    displayName: "Gemini",
    rank: 6,
    envVars: {
      apiKey: "GEMINI_API_KEY",
      models: {
        analysis: "GEMINI_MODEL",
        proposal: "GEMINI_MODEL",
        fast: "GEMINI_MODEL",
      },
    },
    defaults: {
      models: {
        analysis: "gemini-2.5-pro",
        proposal: "gemini-2.5-pro",
        fast: "gemini-2.5-flash",
      },
    },
    outputCaps: {
      analysis: 4000,
      proposal: 8000,
      fast: 2000,
    },
    timeoutMs: 60000,
    maxRetries: 1,
    supportsJson: true,
    emergencyOnly: false,
    isOpenAiCompatible: false,
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    rank: 7,
    envVars: {
      apiKey: "OPENAI_API_KEY",
      models: {
        analysis: "OPENAI_ANALYSIS_MODEL",
        proposal: "OPENAI_PROPOSAL_MODEL",
        fast: "OPENAI_FAST_MODEL",
      },
    },
    defaults: {
      models: {
        analysis: "gpt-4o",
        proposal: "gpt-4o",
        fast: "gpt-4o-mini",
      },
    },
    outputCaps: {
      analysis: 4000,
      proposal: 4000,
      fast: 2000,
    },
    timeoutMs: 60000,
    maxRetries: 1,
    supportsJson: true,
    emergencyOnly: true,
    isOpenAiCompatible: true,
  },
  together: {
    id: "together",
    displayName: "Together",
    rank: 8,
    envVars: {
      apiKey: "TOGETHER_API_KEY",
      baseUrl: "TOGETHER_BASE_URL",
      models: {
        analysis: "TOGETHER_ANALYSIS_MODEL",
        proposal: "TOGETHER_PROPOSAL_MODEL",
        fast: "TOGETHER_FAST_MODEL",
      },
    },
    defaults: {
      baseUrl: "https://api.together.xyz/v1",
      models: {
        analysis: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        proposal: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        fast: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      },
    },
    outputCaps: {
      analysis: 3000,
      proposal: 4000,
      fast: 1200,
    },
    timeoutMs: 30000,
    maxRetries: 2,
    supportsJson: true,
    emergencyOnly: true,
    isOpenAiCompatible: true,
  },
  deepseek: {
    id: "deepseek",
    displayName: "DeepSeek",
    rank: 9,
    envVars: {
      apiKey: "DEEPSEEK_API_KEY",
      models: {
        analysis: "DEEPSEEK_MODEL",
        proposal: "DEEPSEEK_MODEL",
        fast: "DEEPSEEK_MODEL",
      },
    },
    defaults: {
      models: {
        analysis: "deepseek-chat",
        proposal: "deepseek-chat",
        fast: "deepseek-chat",
      },
    },
    outputCaps: {
      analysis: 4000,
      proposal: 4000,
      fast: 2000,
    },
    timeoutMs: 60000,
    maxRetries: 1,
    supportsJson: true,
    emergencyOnly: true,
    isOpenAiCompatible: true,
  },
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic / Claude",
    rank: 10,
    envVars: {
      apiKey: "ANTHROPIC_API_KEY",
      models: {
        analysis: "ANTHROPIC_ANALYSIS_MODEL",
        proposal: "ANTHROPIC_PROPOSAL_MODEL",
        fast: "ANTHROPIC_FAST_MODEL",
      },
    },
    defaults: {
      models: {
        analysis: "claude-3-7-sonnet-latest",
        proposal: "claude-3-7-sonnet-latest",
        fast: "claude-3-5-haiku-latest",
      },
    },
    outputCaps: {
      analysis: 4000,
      proposal: 4000,
      fast: 2000,
    },
    timeoutMs: 60000,
    maxRetries: 1,
    supportsJson: true,
    emergencyOnly: true,
    isOpenAiCompatible: false,
  },
};

export const CANONICAL_AI_PROVIDER_LABELS = CANONICAL_AI_PROVIDER_ORDER.map(
  (id) => AI_PROVIDER_REGISTRY[id].displayName,
);

export const CANONICAL_AI_PROVIDER_DISPLAY = CANONICAL_AI_PROVIDER_LABELS.join(" → ");

export function getProviderConfig(provider: AiProviderName, env: NodeJS.ProcessEnv = process.env) {
  const meta = AI_PROVIDER_REGISTRY[provider];
  if (!meta) throw new Error(`Unknown provider: ${provider}`);
  const apiKey = env[meta.envVars.apiKey]?.trim();
  const baseUrl = (meta.envVars.baseUrl ? env[meta.envVars.baseUrl]?.trim() : undefined) || meta.defaults.baseUrl;

  const models: Record<string, string> = {};
  for (const useCase of ["analysis", "proposal", "fast", "default", "extraction", "validation", "reasoning"]) {
      models[useCase] = (env[meta.envVars.models[useCase as AiUseCase]!]?.trim() || meta.defaults.models[useCase as AiUseCase]!) || meta.defaults.models.proposal!;
  }

  return {
    apiKey,
    baseUrl,
    models,
    meta,
  };
}

export function isProviderConfigured(provider: AiProviderName, env: NodeJS.ProcessEnv = process.env): boolean {
  const config = getProviderConfig(provider, env);
  if (!config.apiKey) return false;

  if (provider === "openrouter") {
    const model = config.models.proposal;
    if (model === "openrouter/auto" || !model.endsWith(":free")) {
      return false;
    }
  }

  return true;
}

export function configuredCanonicalProviders(env: NodeJS.ProcessEnv = process.env): AiProviderName[] {
  return CANONICAL_AI_PROVIDER_ORDER.filter((provider) => isProviderConfigured(provider, env));
}

export function preferredCanonicalProvider(env: NodeJS.ProcessEnv = process.env): AiProviderName | null {
  return configuredCanonicalProviders(env)[0] ?? null;
}

export function canonicalProviderLabel(provider: AiProviderName): string {
  return AI_PROVIDER_REGISTRY[provider]?.displayName ?? provider;
}
