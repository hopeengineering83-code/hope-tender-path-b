export function getClientIp(req: Request): string {
  const trusted = Boolean(process.env.VERCEL || process.env.VERCEL_ENV) || process.env.TRUST_PROXY === "true";
  if (trusted) {
    const forwarded = req.headers.get("x-forwarded-for");
    const value = forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim();
    if (value && value.length <= 64) return value;
  }
  return "unknown";
}
