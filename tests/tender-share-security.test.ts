import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTenderShareToken,
  isValidTenderShareToken,
  parseTenderShareCreateInput,
} from "../lib/tender-share-security";

const now = new Date("2026-06-17T00:00:00.000Z");

describe("tender share bearer tokens", () => {
  it("creates high-entropy base64url tokens", () => {
    const first = createTenderShareToken();
    const second = createTenderShareToken();
    assert.match(first, /^[A-Za-z0-9_-]{43}$/);
    assert.match(second, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(first, second);
  });

  it("accepts current and legacy token shapes but rejects malformed input", () => {
    assert.equal(isValidTenderShareToken("a".repeat(43)), true);
    assert.equal(isValidTenderShareToken("legacy_cuid-style-token_123"), true);
    assert.equal(isValidTenderShareToken("short"), false);
    assert.equal(isValidTenderShareToken("a".repeat(129)), false);
    assert.equal(isValidTenderShareToken("token/with/slashes/that/is/not/allowed"), false);
  });
});

describe("tender share creation input", () => {
  it("normalizes a valid request", () => {
    const result = parseTenderShareCreateInput({
      label: "  External reviewer  ",
      expiresAt: "2026-06-20T00:00:00.000Z",
      maxDownloads: 5,
    }, now);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.label, "External reviewer");
    assert.equal(result.value.expiresAt?.toISOString(), "2026-06-20T00:00:00.000Z");
    assert.equal(result.value.maxDownloads, 5);
  });

  it("accepts omitted optional fields", () => {
    const result = parseTenderShareCreateInput({}, now);
    assert.deepEqual(result, { ok: true, value: { label: null, expiresAt: null, maxDownloads: null } });
  });

  it("rejects past, invalid, and excessive expirations", () => {
    for (const expiresAt of ["invalid", "2026-06-16T23:59:59.000Z", "2028-01-01T00:00:00.000Z"]) {
      assert.equal(parseTenderShareCreateInput({ expiresAt }, now).ok, false);
    }
  });

  it("rejects invalid access limits", () => {
    for (const maxDownloads of [0, -1, 1.5, 10_001, "abc", {}, []]) {
      assert.equal(parseTenderShareCreateInput({ maxDownloads }, now).ok, false);
    }
  });

  it("rejects oversized and non-text labels", () => {
    assert.equal(parseTenderShareCreateInput({ label: "x".repeat(121) }, now).ok, false);
    assert.equal(parseTenderShareCreateInput({ label: 123 }, now).ok, false);
  });

  it("rejects non-object request bodies", () => {
    for (const input of [null, undefined, "text", [], 1]) {
      assert.equal(parseTenderShareCreateInput(input, now).ok, false);
    }
  });
});
