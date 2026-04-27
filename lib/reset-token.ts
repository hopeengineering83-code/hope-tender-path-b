import { createHmac, timingSafeEqual } from "crypto";

function getSecret(): string {
  return process.env.SESSION_SECRET ?? "dev-secret-change-me";
}

export function makeResetToken(userId: string): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(JSON.stringify({ userId, exp, purpose: "reset" })).toString("base64url");
  const sig = createHmac("sha256", getSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyResetToken(token: string): { userId: string } | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot < 1) return null;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = createHmac("sha256", getSecret()).update(payload).digest("base64url");
    const sigBuf = Buffer.from(sig, "base64url");
    const expBuf = Buffer.from(expected, "base64url");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      userId: string; exp: number; purpose: string;
    };
    if (data.purpose !== "reset") return null;
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return { userId: data.userId };
  } catch {
    return null;
  }
}
