import { tabletPrimaryTest as test, expect } from "./auth-helper";

type Settings = {
  defaultCurrency: string;
  aiStrictMode: boolean;
  allowBrandingDefault: boolean;
  allowSignatureDefault: boolean;
  allowStampDefault: boolean;
  exportFormat: string;
  pageNumbering: boolean;
  includeTableOfContents: boolean;
  language: string;
};

type SettingsResponse = {
  settings?: Partial<Settings> | null;
  presentationSemantics?: { description?: string; excludedTenderFacts?: string[] };
  changedFields?: string[];
  error?: string;
  fieldErrors?: Array<{ field: string; message: string }>;
};

async function readJson(response: import("@playwright/test").APIResponse): Promise<SettingsResponse> {
  return response.json().catch(() => ({})) as Promise<SettingsResponse>;
}

function completeSettings(settings: Partial<Settings> | null | undefined): Settings {
  return {
    defaultCurrency: settings?.defaultCurrency ?? "USD",
    aiStrictMode: settings?.aiStrictMode ?? true,
    allowBrandingDefault: settings?.allowBrandingDefault ?? true,
    allowSignatureDefault: settings?.allowSignatureDefault ?? true,
    allowStampDefault: settings?.allowStampDefault ?? true,
    exportFormat: settings?.exportFormat ?? "DOCX",
    pageNumbering: settings?.pageNumbering ?? true,
    includeTableOfContents: settings?.includeTableOfContents ?? false,
    language: settings?.language ?? "en",
  };
}

test.describe("settings API authorization, validation, ownership, and persistence", () => {
  test("GET exposes presentation semantics without tender facts", async ({ page }) => {
    const response = await page.request.get("/api/settings");
    expect(response.status()).toBe(200);
    const body = await readJson(response);
    expect(body.presentationSemantics?.description).toMatch(/presentation|authoring/i);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/tenderCurrency|clientName|submissionMethod|financialProposalRequired/);
  });

  test("invalid JSON, ZIP, tender-fact fields, and cross-company targeting fail before writes", async ({ page }) => {
    const beforeResponse = await page.request.get("/api/settings");
    expect(beforeResponse.status()).toBe(200);
    const before = completeSettings((await readJson(beforeResponse)).settings);

    const invalidJson = await page.request.fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      data: "{",
    });
    expect(invalidJson.status()).toBe(400);
    expect((await readJson(invalidJson)).error).toMatch(/valid JSON/i);

    for (const [field, value] of [
      ["tenderCurrency", "ETB"],
      ["submissionMethod", "EMAIL"],
      ["clientName", "Another client"],
      ["companyId", "another-company-id"],
    ] as const) {
      const response = await page.request.put("/api/settings", { data: { [field]: value } });
      expect(response.status(), field).toBe(400);
      const body = await readJson(response);
      expect(body.error, field).toBe("Validation failed");
      expect(body.fieldErrors?.some((item) => item.field === field), field).toBe(true);
    }

    const invalidCurrency = await page.request.put("/api/settings", { data: { defaultCurrency: "NOT_A_CURRENCY" } });
    expect(invalidCurrency.status()).toBe(400);
    expect((await readJson(invalidCurrency)).fieldErrors?.some((item) => item.field === "defaultCurrency")).toBe(true);

    const zipResponse = await page.request.put("/api/settings", { data: { exportFormat: "ZIP" } });
    expect(zipResponse.status()).toBe(400);
    const zipBody = await readJson(zipResponse);
    expect(zipBody.error).toBe("Validation failed");
    expect(zipBody.fieldErrors?.some((item) => item.field === "exportFormat" && /ZIP is a package-download mode/i.test(item.message))).toBe(true);

    const afterResponse = await page.request.get("/api/settings");
    expect(afterResponse.status()).toBe(200);
    expect(completeSettings((await readJson(afterResponse)).settings)).toEqual(before);
  });

  test("a valid own-company update is visible only after a server re-read and is restored", async ({ page }) => {
    const originalResponse = await page.request.get("/api/settings");
    expect(originalResponse.status()).toBe(200);
    const original = completeSettings((await readJson(originalResponse)).settings);
    const toggled = { ...original, pageNumbering: !original.pageNumbering };

    try {
      const updateResponse = await page.request.put("/api/settings", { data: toggled });
      expect(updateResponse.status()).toBe(200);
      const updateBody = await readJson(updateResponse);
      expect(updateBody.changedFields).toContain("pageNumbering");

      const refreshedResponse = await page.request.get("/api/settings");
      expect(refreshedResponse.status()).toBe(200);
      const refreshed = completeSettings((await readJson(refreshedResponse)).settings);
      expect(refreshed.pageNumbering).toBe(toggled.pageNumbering);
    } finally {
      const restoreResponse = await page.request.put("/api/settings", { data: original });
      expect(restoreResponse.status()).toBe(200);
      const restoredResponse = await page.request.get("/api/settings");
      expect(restoredResponse.status()).toBe(200);
      expect(completeSettings((await readJson(restoredResponse)).settings)).toEqual(original);
    }
  });
});
