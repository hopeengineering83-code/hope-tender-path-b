/**
 * Safe API error response helper.
 *
 * Never exposes internal exception text (stack traces, database URLs,
 * file paths, provider error bodies) in API JSON responses. Returns
 * only a safe error code and a correlation ID that operators can use
 * to find the full error in server logs.
 */

import { randomUUID } from "node:crypto";

export type SafeErrorResponse = {
  error: string;
  code: string;
  correlationId: string;
};

/**
 * Build a safe error response body. The original error is logged
 * server-side with the correlation ID so operators can trace it.
 */
export function safeError(
  message: string,
  code: string,
  originalError?: unknown,
): SafeErrorResponse {
  const correlationId = randomUUID().slice(0, 8);
  // Log the full error server-side with the correlation ID.
  // Never include the error text in the response body.
  if (originalError) {
    const detail = originalError instanceof Error
      ? originalError.message
      : String(originalError);
    // Use console.error to avoid importing logger (which may not be
    // available in all contexts). The logger is used in routes that
    // have it; this is the fallback.
    console.error(
      `[safe-error] correlationId=${correlationId} code=${code}: ${detail}`,
    );
  }
  return {
    error: message,
    code,
    correlationId,
  };
}

/**
 * Log the full error detail server-side and return only the correlation
 * ID + safe code. Use this in catch blocks where you already have a
 * logger available.
 */
export function logSafeError(
  logger: { error: (msg: string, ctx?: Record<string, unknown>) => void },
  message: string,
  code: string,
  originalError: unknown,
  extraContext?: Record<string, unknown>,
): SafeErrorResponse {
  const correlationId = randomUUID().slice(0, 8);
  const detail = originalError instanceof Error
    ? originalError.message
    : String(originalError);
  logger.error(message, {
    correlationId,
    code,
    detail,
    ...extraContext,
  });
  return {
    error: message,
    code,
    correlationId,
  };
}
