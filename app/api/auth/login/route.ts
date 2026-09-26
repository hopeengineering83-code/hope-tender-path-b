import { logger } from "../../../../lib/observability";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { createSession } from "../../../../lib/auth";
import { logAction } from "../../../../lib/audit";
import { repairLoginSchema } from "../../../../lib/login-schema-repair";
import {
  rateLimit,
  rateLimitPersistent,
  AUTH_RATE_LIMIT,
} from "../../../../lib/rate-limit";
import { getClientIp } from "../../../../lib/request-ip";
import { extractRequestId } from "../../../../lib/request-id";

const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  "hope-login-dummy-password-not-a-real-credential",
  12,
);

const PUBLIC_LOGIN_MESSAGES = {
  INVALID_CREDENTIALS: "The email or password is incorrect.",
  MISSING_CREDENTIALS: "Enter both email and password.",
  INVALID_LOGIN_REQUEST: "The sign-in request was invalid. Please try again.",
  AUTH_SERVICE_UNAVAILABLE: "Authentication is temporarily unavailable. Please try again shortly.",
  AUTH_DATABASE_SCHEMA_OUTDATED: "Sign-in is unavailable because the database is behind this deployment. The pending database migrations must be applied \u2014 retrying will not clear this.",
  LOGIN_RATE_LIMITED: "Too many sign-in attempts. Wait briefly, then try again.",
} as const;

type PublicLoginCode = keyof typeof PUBLIC_LOGIN_MESSAGES;
type ParsedLogin = { ok: true; email: string; password: string; nativeForm: boolean } | { ok: false; nativeForm: boolean };

function withPrivateAuthHeaders<T extends NextResponse>(response: T): T {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function isNativeFormRequest(req: Request): boolean {
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  return contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
}

async function parseLoginRequest(req: Request): Promise<ParsedLogin> {
  const nativeForm = isNativeFormRequest(req);
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();

  try {
    let emailValue: unknown;
    let passwordValue: unknown;

    if (nativeForm) {
      const form = await req.formData();
      emailValue = form.get("email");
      passwordValue = form.get("password");
    } else if (contentType.includes("application/json")) {
      const body = await req.json() as { email?: unknown; password?: unknown };
      emailValue = body.email;
      passwordValue = body.password;
    } else {
      return { ok: false, nativeForm };
    }

    return {
      ok: true,
      nativeForm,
      email: typeof emailValue === "string" ? emailValue.trim().toLowerCase() : "",
      password: typeof passwordValue === "string" ? passwordValue : "",
    };
  } catch (e) {
    // Login form parse failure — could indicate malformed request body or
    // attack attempt. Surface the failure so silent form-parse failures
    // are observable. Previously bare `catch {}`.
    logger.warn("[auth/login] parseLoginForm failed — returning ok:false", {
      detail: e,
    });
    return { ok: false, nativeForm };
  }
}

function redirectTo(req: Request, pathname: string, errorCode?: PublicLoginCode): NextResponse {
  const target = new URL(pathname, req.url);
  target.search = "";
  if (errorCode) target.searchParams.set("error", errorCode);
  return withPrivateAuthHeaders(NextResponse.redirect(target, 303));
}

function loginResult(
  req: Request,
  nativeForm: boolean,
  code: PublicLoginCode,
  status: number,
  extraHeaders?: HeadersInit,
  requestId?: string,
): NextResponse {
  if (nativeForm) {
    const response = redirectTo(req, "/login", code);
    if (extraHeaders) {
      new Headers(extraHeaders).forEach((value, key) => response.headers.set(key, value));
    }
    return response;
  }

  return withPrivateAuthHeaders(NextResponse.json(
    {
      error: PUBLIC_LOGIN_MESSAGES[code],
      code,
      ...(requestId ? { requestId } : {}),
    },
    { status, headers: extraHeaders },
  ));
}

/**
 * Prisma codes meaning the database does not match the deployed client:
 * P2021 a table is missing, P2022 a column is missing.
 *
 * Separated from a transient outage because the advice is the opposite. "Try
 * again shortly" tells the operator to wait, and waiting never fixes a missing
 * column. A real deployment sat in exactly this state after its DATABASE_URL
 * was repointed at a database that had the tables but not the latest
 * migrations: /api/health reported healthy, every sign-in returned 503, and
 * the message invited an endless retry against an error only a migration could
 * clear.
 */
const SCHEMA_DRIFT_PRISMA_CODES = new Set(["P2021", "P2022"]);

function isSchemaDrift(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && SCHEMA_DRIFT_PRISMA_CODES.has(code);
}

function authenticationUnavailable(req: Request, nativeForm: boolean, requestId: string, error?: unknown): NextResponse {
  const code = isSchemaDrift(error) ? "AUTH_DATABASE_SCHEMA_OUTDATED" : "AUTH_SERVICE_UNAVAILABLE";
  return loginResult(req, nativeForm, code, 503, undefined, requestId);
}

function tooManyAttempts(req: Request, nativeForm: boolean, resetAt: number): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return loginResult(
    req,
    nativeForm,
    "LOGIN_RATE_LIMITED",
    429,
    { "Retry-After": String(retryAfter) },
  );
}

async function recordFailedLogin(userId: string | undefined, email: string) {
  const crypto = require("node:crypto");
  const emailCorrelationHash = crypto
    .createHash("sha256")
    .update(email)
    .digest("hex")
    .slice(0, 16);
  await logAction({
    userId,
    action: "LOGIN_FAILED",
    entityType: "User",
    entityId: userId,
    description: `Failed login attempt for [redacted] (correlation: ${emailCorrelationHash})`,
  }).catch((error) => {
    logger.warn("[login] failed-attempt audit was not persisted", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
  });
}

export async function POST(req: Request) {
  const requestId = extractRequestId(req);
  const parsed = await parseLoginRequest(req);

  if (!parsed.ok) {
    return loginResult(req, parsed.nativeForm, "INVALID_LOGIN_REQUEST", 400);
  }

  const { email, password, nativeForm } = parsed;
  if (!email || !password) {
    return loginResult(req, nativeForm, "MISSING_CREDENTIALS", 400);
  }

  try {
    const clientIp = getClientIp(req);

    const localIpLimit = rateLimit(
      `login:local:ip:${clientIp}`,
      AUTH_RATE_LIMIT,
    );
    const localAccountLimit = rateLimit(
      `login:local:account:${email}`,
      AUTH_RATE_LIMIT,
    );
    if (!localIpLimit.allowed || !localAccountLimit.allowed) {
      return tooManyAttempts(
        req,
        nativeForm,
        Math.max(localIpLimit.resetAt, localAccountLimit.resetAt),
      );
    }

    try {
      await prismaReady;
      await repairLoginSchema(prisma);
    } catch (error) {
      logger.error("[login] database readiness failed", {
        requestId,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
        prismaCode: (error as { code?: unknown } | null)?.code ?? null,
      });
      return authenticationUnavailable(req, nativeForm, requestId, error);
    }

    let persistentIpLimit;
    let persistentAccountLimit;
    try {
      [persistentIpLimit, persistentAccountLimit] = await Promise.all([
        rateLimitPersistent(`login:ip:${clientIp}`, AUTH_RATE_LIMIT),
        rateLimitPersistent(`login:account:${email}`, AUTH_RATE_LIMIT),
      ]);
    } catch (error) {
      logger.error("[login] persistent rate limiter failed", {
        requestId,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
        prismaCode: (error as { code?: unknown } | null)?.code ?? null,
      });
      return authenticationUnavailable(req, nativeForm, requestId, error);
    }
    if (!persistentIpLimit.allowed || !persistentAccountLimit.allowed) {
      return tooManyAttempts(
        req,
        nativeForm,
        Math.max(persistentIpLimit.resetAt, persistentAccountLimit.resetAt),
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    const comparisonHash = user?.passwordHash || DUMMY_PASSWORD_HASH;
    let passwordOk = false;
    try {
      passwordOk = await bcrypt.compare(password, comparisonHash);
    } catch (error) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH).catch(() => false);
      logger.error("[login] stored password hash could not be verified", {
        requestId,
        userId: user?.id,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
      passwordOk = false;
    }

    // Audit C-5: a soft-deleted user must not be able to re-authenticate.
    // Deactivation revokes existing sessions atomically (app/api/users/[id]),
    // but that only removes the sessions the account already had — without this
    // check a deactivated user who still knows their password simply logs in
    // again and receives a brand-new session.
    //
    // Deliberately folded into the same branch as a wrong password: the
    // response, status and failure accounting are identical, so this cannot be
    // used to discover which accounts exist or which have been deactivated. The
    // bcrypt comparison above has already run, so the timing shape is unchanged.
    if (!user || !user.passwordHash || !passwordOk || user.deletedAt) {
      void recordFailedLogin(user?.id, email);
      return loginResult(req, nativeForm, "INVALID_CREDENTIALS", 401);
    }

    try {
      await createSession(user.id);
    } catch (error) {
      logger.error("[login] session creation failed", {
        requestId,
        userId: user.id,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
        prismaCode: (error as { code?: unknown } | null)?.code ?? null,
      });
      return authenticationUnavailable(req, nativeForm, requestId, error);
    }

    void logAction({
      userId: user.id,
      action: "LOGIN",
      entityType: "User",
      entityId: user.id,
      description: "User signed in successfully.",
    }).catch((error) => {
      logger.warn("[login] success audit was not persisted", {
        requestId,
        userId: user.id,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    });

    if (nativeForm) return redirectTo(req, "/dashboard");
    return withPrivateAuthHeaders(NextResponse.json({ success: true }));
  } catch (error) {
    logger.error("[login] unexpected failure", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      prismaCode: (error as { code?: unknown } | null)?.code ?? null,
    });
    return authenticationUnavailable(req, nativeForm, requestId, error);
  }
}
