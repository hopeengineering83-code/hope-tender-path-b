export function generateRequestId(): string {
  return crypto.randomUUID();
}

export function extractRequestId(req: Request): string {
  return (
    req.headers.get("x-request-id") ??
    req.headers.get("x-correlation-id") ??
    generateRequestId()
  );
}
