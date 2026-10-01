import type { AiProviderName } from "./ai-provider-registry";
export const CANONICAL_AI_PROVIDER_ORDER: readonly AiProviderName[];
export const ALL_CONFIGURED_PROVIDERS: readonly AiProviderName[];
export const EMERGENCY_ONLY_PROVIDERS: readonly AiProviderName[];
export const NON_AUTOMATIC_PROVIDERS: readonly AiProviderName[];
export const PROVIDER_API_KEY_ENV: Readonly<Record<AiProviderName, string>>;
export const AI_PROVIDER_API_KEY_ENVS: readonly string[];
export const ALL_PROVIDER_API_KEY_ENVS: readonly string[];
export function automaticProviderOrder(): readonly AiProviderName[];
