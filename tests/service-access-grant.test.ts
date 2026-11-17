// Pure-function tests for lib/service-access.ts (no database).
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  generateServiceToken,
  grantView,
  hashServiceToken,
  parseGrantCreateInput,
  parseServiceBearer,
  SERVICE_GRANT_DEFAULT_DAYS,
  SERVICE_GRANT_MAX_DAYS,
  TENDER_STATUS_SELECT,
} from "../lib/service-access";
import { getClientIp } from "../lib/request-ip";

describe("service access tokens", () => {
  it("are 256-bit, prefixed, and only their SHA-256 is meant for storage", () => {
    const a = generateServiceToken();
    const b = generateServiceToken();
    assert.match(a.token, /^hsa_[A-Za-z0-9_-]{43}$/);
    assert.notEqual(a.token, b.token);
    assert.equal(a.tokenHash, hashServiceToken(a.token));
    assert.match(a.tokenHash, /^[0-9a-f]{64}$/);
    assert.ok(!a.tokenHash.includes(a.token));
  });

  it("parse only an exact Bearer header", () => {
    const { token } = generateServiceToken();
    assert.equal(parseServiceBearer(`Bearer ${token}`), token);
    for (const bad of [null, "", token, `bearer ${token}`, `Bearer  ${token}`, `Bearer ${token} x`, `Basic ${token}`,
                       "Bearer hsa_short", `Bearer ${token.replace("hsa_", "hsx_")}`, `Bearer ${token}=`,
                       `Bearer ${"a".repeat(300)}`]) {
      assert.equal(parseServiceBearer(bad), null, String(bad));
    }
  });
});

describe("grant creation input", () => {
  it("defaults to 30 days and caps at 90", () => {
    assert.deepEqual(parseGrantCreateInput({}), { ok: true, value: { label: null, days: SERVICE_GRANT_DEFAULT_DAYS } });
    assert.deepEqual(parseGrantCreateInput({ label: "  HOPE ONE AGENT ", days: 90 }),
                     { ok: true, value: { label: "HOPE ONE AGENT", days: SERVICE_GRANT_MAX_DAYS } });
  });

  it("rejects anything else", () => {
    for (const bad of [null, [], "x", { days: 0 }, { days: 91 }, { days: 1.5 }, { days: "30" }, { label: 5 },
                       { label: "x".repeat(121) }, { scope: "tenders:write" }, { userId: "someone-else" },
                       { audience: "other" }]) {
      assert.equal(parseGrantCreateInput(bad).ok, false, JSON.stringify(bad));
    }
  });
});

describe("grant view", () => {
  it("never carries a token or hash, and reports activity honestly", () => {
    const now = new Date("2026-11-13T12:00:00Z");
    const base = { id: "g", label: null, audience: "hope-one-agent", scope: "tenders:status:read",
                   createdAt: new Date("2026-11-01T00:00:00Z"), revokedAt: null, lastUsedAt: null, useCount: 0 };
    const view = grantView({ ...base, expiresAt: new Date("2026-12-01T00:00:00Z") }, now);
    assert.equal(view.active, true);
    assert.ok(!("tokenHash" in view) && !("token" in view));
    assert.equal(grantView({ ...base, expiresAt: new Date("2026-11-12T00:00:00Z") }, now).active, false);
    assert.equal(grantView({ ...base, expiresAt: new Date("2026-12-01T00:00:00Z"), revokedAt: now }, now).active, false);
  });
});

describe("the service read surface", () => {
  it("selects exactly the minimal tender fields (adding one is a reviewed security change)", () => {
    assert.deepEqual(Object.keys(TENDER_STATUS_SELECT).sort(),
                     ["deadline", "id", "reference", "stage", "status", "title", "updatedAt"]);
  });
});

describe("the client address the service limits are keyed by", () => {
  const request = (headers: Record<string, string>) => new Request("https://tender.example/api/service/v1/tender-status", { headers });
  const keys = ["VERCEL", "VERCEL_ENV", "TRUST_PROXY"] as const;

  function withEnv(values: Partial<Record<(typeof keys)[number], string>>, check: () => void) {
    const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      for (const key of keys) delete process.env[key];
      Object.assign(process.env, values);
      check();
    } finally {
      for (const key of keys) {
        if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
      }
    }
  }

  it("ignores client-supplied forwarding headers unless a trusted proxy sets them", () => {
    withEnv({}, () => {
      assert.equal(getClientIp(request({ "x-forwarded-for": "198.51.100.9", "x-real-ip": "198.51.100.9" })), "unknown");
    });
    withEnv({ TRUST_PROXY: "false" }, () => {
      assert.equal(getClientIp(request({ "x-forwarded-for": "198.51.100.9" })), "unknown");
    });
  });

  it("on Vercel uses the address Vercel itself writes (it overwrites x-forwarded-for)", () => {
    withEnv({ VERCEL: "1" }, () => {
      assert.equal(getClientIp(request({ "x-forwarded-for": "198.51.100.9, 203.0.113.7" })), "198.51.100.9");
      assert.equal(getClientIp(request({ "x-forwarded-for": "x".repeat(65) })), "unknown");   // never an unbounded key
    });
  });
});
