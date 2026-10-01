import { logger } from "./observability";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma, prismaReady } from "./prisma";
import { hashResetToken } from "./reset-token";
import { rateLimitPersistent, PASSWORD_RESET_RATE_LIMIT } from "./rate-limit";
import { getClientIp } from "./request-ip";
import { validatePassword } from "./password-policy";
import { logAction } from "./audit";

const invalidReset = { error: "Invalid or expired reset link" };

export type ResetRow = {
  id: string;
  userId: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

export type ResetTokenState = "MISSING" | "CONSUMED" | "EXPIRED" | "ACTIVE";

export function classifyPasswordResetToken(row: ResetRow | null | undefined, now = new Date()): ResetTokenState {
  if (!row) return "MISSING";
  if (row.consumedAt) return "CONSUMED";
  if (new Date(row.expiresAt).getTime() <= now.getTime()) return "EXPIRED";
  return "ACTIVE";
}

export async function handleSecurePasswordReset(req: Request) {
  const body = await req.json().catch(() => ({})) as { token?: string; password?: string };
  const token = String(body.token ?? "");
  const newPassword = String(body.password ?? "");
  if (!token || !newPassword) {
    return NextResponse.json({ error: "token and password are required" }, { status: 400 });
  }

  const validation = validatePassword(newPassword);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  try {
    const tokenHash = hashResetToken(token);
    const client = getClientIp(req);
    const [clientLimit, tokenLimit] = await Promise.all([
      rateLimitPersistent(`reset-password:client:${client}`, PASSWORD_RESET_RATE_LIMIT),
      rateLimitPersistent(`reset-password:token:${tokenHash.slice(0, 24)}`, PASSWORD_RESET_RATE_LIMIT),
    ]);
    if (!clientLimit.allowed || !tokenLimit.allowed) {
      const retryAfter = Math.max(1, Math.ceil((Math.max(clientLimit.resetAt, tokenLimit.resetAt) - Date.now()) / 1000));
      return NextResponse.json(invalidReset, {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      });
    }

    await prismaReady;
    const nextHash = await bcrypt.hash(newPassword, 12);
    let changedUserId: string | null = null;
    // A plain outer `let` narrows to its initializer inside the closure
    // below for TypeScript's control-flow analysis; an object property
    // sidesteps that so the post-transaction check below sees the full
    // ResetTokenState union.
    const outcome: { tokenState: ResetTokenState } = { tokenState: "MISSING" };

    // The non-ACTIVE branch below must NOT throw inside this transaction:
    // Prisma rolls back every statement run through `tx` (including raw
    // queries) when the interactive-transaction callback throws, so the
    // opportunistic "mark this expired token consumed" UPDATE would never
    // actually commit. Returning normally instead lets that cleanup persist;
    // the caller decides the HTTP response from `outcome.tokenState` after.
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ResetRow[]>`
        SELECT "id", "userId", "expiresAt", "consumedAt"
        FROM "PasswordResetToken"
        WHERE "tokenHash" = ${tokenHash}
        FOR UPDATE
      `;
      const row = rows[0];
      const tokenState = classifyPasswordResetToken(row);
      outcome.tokenState = tokenState;
      if (tokenState !== "ACTIVE") {
        if (tokenState === "EXPIRED" && row) {
          await tx.$executeRaw`
            UPDATE "PasswordResetToken"
            SET "consumedAt" = NOW()
            WHERE "id" = ${row.id} AND "consumedAt" IS NULL
          `;
        }
        return;
      }

      changedUserId = row.userId;
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash: nextHash } });
      await tx.$executeRaw`
        UPDATE "PasswordResetToken"
        SET "consumedAt" = NOW()
        WHERE "id" = ${row.id} AND "consumedAt" IS NULL
      `;
      await tx.$executeRaw`
        DELETE FROM "PasswordResetToken"
        WHERE "userId" = ${row.userId} AND "id" <> ${row.id}
      `;
      await tx.session.deleteMany({ where: { userId: row.userId } });
    });

    if (outcome.tokenState !== "ACTIVE") {
      return NextResponse.json(invalidReset, { status: 400 });
    }

    if (changedUserId) {
      await logAction({
        userId: changedUserId,
        action: "UPDATE",
        entityType: "UserSecurity",
        entityId: changedUserId,
        description: "Password reset completed and active sessions revoked",
      });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("[password-reset] request failed", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json({ error: "Password reset is temporarily unavailable" }, { status: 503 });
  }
}
