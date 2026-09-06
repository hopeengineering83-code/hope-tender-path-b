import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/share/[token]/page.tsx", "utf8");

describe("shared-link recovery experience", () => {
  it("rejects malformed tokens before database readiness or lookup", () => {
    const validationIndex = source.indexOf("if (!isValidTenderShareToken(token))");
    const prismaReadyIndex = source.indexOf("await prismaReady");
    assert.ok(validationIndex >= 0, "token format validation must exist");
    assert.ok(prismaReadyIndex > validationIndex, "malformed tokens must fail before database access");
  });

  it("provides precise states for unavailable, revoked, expired, and exhausted links", () => {
    assert.match(source, /Shared Link Unavailable/);
    assert.match(source, /Shared Link Revoked/);
    assert.match(source, /Shared Link Expired/);
    assert.match(source, /Shared Link Access Limit Reached/);
    assert.match(source, /reason="not-found"/);
    assert.match(source, /reason="revoked"/);
    assert.match(source, /reason="expired"/);
    assert.match(source, /reason="limit"/);
  });

  it("gives an actionable path instead of a dead-end error card", () => {
    assert.match(source, /How to regain access/);
    assert.match(source, /ask the sender/i);
    assert.match(source, /href="\/login"/);
    assert.match(source, /Sign in to Hope Tender/);
    assert.match(source, /href="\/"/);
    assert.match(source, /Return to home page/);
  });

  it("does not imply that signing in restores an expired or revoked public link", () => {
    assert.match(source, /Signing in does not restore this link/);
    assert.match(source, /Shared tender links are read-only/);
  });

  it("keeps recovery controls touch-sized and responsive", () => {
    assert.match(source, /min-h-11/);
    assert.match(source, /flex flex-col gap-2 sm:flex-row/);
    assert.match(source, /max-w-lg/);
  });

  it("does not render or interpolate the supplied token in recovery copy", () => {
    const messagePageBlock = source.match(/function MessagePage\([\s\S]*?\n\}/)?.[0] ?? "";
    assert.ok(messagePageBlock, "MessagePage must exist");
    assert.doesNotMatch(messagePageBlock, /\btoken\b/);
  });
});
