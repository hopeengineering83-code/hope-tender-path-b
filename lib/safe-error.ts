/**
 * Safe API error response helper.
 *
 * Never exposes internal exception text (stack traces, database URLs,
 * file paths, provider error bodies) in API JSON responses. Returns
 * only a safe error code and a correlation ID that operators can use
 * to find the full error in server logs.
 */

import { randomUUID } from "node:crypto";
import { logger } from "./observability";

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
    // Use the structured logger so the error lands in Vercel's JSON log
    // drain with level filtering and request correlation. The previous
    // console.error call bypassed the logger and could leak PII via the
    // raw error.message string in unstructured stdout.
    logger.error(`[safe-error] code=${code}`, {
      correlationId,
      code,
      errorClass: originalError instanceof Error ? originalError.constructor.name : "UnknownError",
    });
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
