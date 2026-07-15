// Browser-safe canonical AI provider environment-variable names.
//
// The single literal provider order lives in lib/ai-provider-catalog.cjs so
// Node scripts, server code, and browser/client copy all derive the same env
// list without importing runtime provider helpers that read process.env.

import { AI_PROVIDER_API_KEY_ENVS } from "./ai-provider-catalog.cjs";

export const CANONICAL_AI_PROVIDER_ENV_NAMES: readonly string[] = AI_PROVIDER_API_KEY_ENVS;

export const CANONICAL_AI_PROVIDER_ENV_LIST = CANONICAL_AI_PROVIDER_ENV_NAMES.join(", ");
