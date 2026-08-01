import type { EngineRunOptions } from "./run-tender-engine";

export type EngineRequestOptions = Pick<EngineRunOptions, "safe" | "skipAiRematch" | "maxChars"> & {
  async: boolean;
};

export function parseEngineRequestOptions(requestUrl: string): EngineRequestOptions {
  const params = new URL(requestUrl).searchParams;
  const rawMaxChars = Number(params.get("maxChars"));
  return {
    async: params.get("async") === "true",
    safe: params.get("safe") === "true",
    skipAiRematch: params.get("skipAiRematch") === "true",
    maxChars: Number.isFinite(rawMaxChars) && rawMaxChars >= 5_000
      ? Math.min(Math.floor(rawMaxChars), 200_000)
      : undefined,
  };
}
