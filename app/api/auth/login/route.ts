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

const INVALID_CREDENTIALS = {
  error: "Invalid credentials",
  code: "INVALID_CREDENTIALS",
};

function authenticationUnavailable(requestId: string) {
  return NextResponse.json(
    {
      error: "Authentication is temporarily unavailable. Please try again.",
      code: "AUTH_SERVICE_UNAVAILABLE",
      requestId,
    },
    { status: 503 },
  );
}

function tooManyAttempts(resetAt: number) {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return NextResponse.json(
    {
      error: "Too many login attempts",
      code: "LOGIN_RATE_LIMITED",
    },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    },
  );
}

async function recordFailedLogin(userId: string | undefined, email: string) {
  // Do NOT log the plaintext email — it is PII and could expose user accounts
  // if audit logs are accessed by an attacker enumerating accounts. Use a
  // non-reversible SHA-256 hash prefix so security investigations can still
  // correlate repeated attempts against the same account without storing the
  // account identifier itself.
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

  try {
    let body: { email?: string; password?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        {
          error: "Invalid login request",
          code: "INVALID_LOGIN_REQUEST",
          detail: "Request body must be valid JSON.",
        },
        { status: 400 },
      );
    }

    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!email || !password) {
      return NextResponse.json(
        {
          error: "Missing credentials",
          code: "MISSING_CREDENTIALS",
          detail: "Enter both email and password.",
        },
        { status: 400 },
      );
    }

    const clientIp = getClientIp(req);

    // Apply separate local buckets before any database work. A combined
    // IP+email key can be bypassed by rotating either dimension.
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
      });
      return authenticationUnavailable(requestId);
    }

    // Persistent buckets enforce the same two dimensions across serverless
    // instances. They run only after database readiness succeeds, while the
    // local buckets above protect the readiness path itself.
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
      });
      return authenticationUnavailable(requestId);
    }
    if (!persistentIpLimit.allowed || !persistentAccountLimit.allowed) {
      return tooManyAttempts(
        Math.max(persistentIpLimit.resetAt, persistentAccountLimit.resetAt),
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    // Always perform a bcrypt comparison. Missing users and users with a
    // missing hash use a valid dummy hash so response shape and work factor do
    // not reveal whether the account exists or how it is configured.
    const comparisonHash = user?.passwordHash || DUMMY_PASSWORD_HASH;
    let passwordOk = false;
    try {
      passwordOk = await bcrypt.compare(password, comparisonHash);
    } catch (error) {
      // An invalid stored hash must not expose account state. Perform the dummy
      // comparison before returning the same generic invalid-credentials result.
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH).catch(() => false);
      logger.error("[login] stored password hash could not be verified", {
        requestId,
        userId: user?.id,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
      passwordOk = false;
    }

    if (!user || !user.passwordHash || !passwordOk) {
      void recordFailedLogin(user?.id, email);
      return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
    }

    try {
      await createSession(user.id);
    } catch (error) {
      logger.error("[login] session creation failed", {
        requestId,
        userId: user.id,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
      return authenticationUnavailable(requestId);
    }

    // A post-authentication audit failure must not report login failure after a
    // valid session cookie has already been created.
    void logAction({
      userId: user.id,
      action: "LOGIN",
      description: `User ${user.email} logged in`,
    }).catch((error) => {
      logger.warn("[login] success audit was not persisted", {
        requestId,
        userId: user.id,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("[login] unexpected failure", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return authenticationUnavailable(requestId);
  }
}
