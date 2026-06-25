// Type declarations for the plain-CJS provider catalog (lib/ai-provider-catalog.cjs).
import type { AiProviderName } from "./ai-provider-registry";

export const CANONICAL_AI_PROVIDER_ORDER: readonly AiProviderName[];
export const PROVIDER_API_KEY_ENV: Readonly<Record<AiProviderName, string>>;
export const AI_PROVIDER_API_KEY_ENVS: readonly string[];
export const ZAI_FORBIDDEN_MODEL_OVERRIDES: readonly string[];
