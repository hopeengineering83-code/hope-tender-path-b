import { test } from "node:test";
import assert from "node:assert";
import { PrismaClient } from "@prisma/client";
import { TenderEvidenceSelector } from "../lib/engine/tender-evidence-selector";

test("TenderEvidenceSelector logic - finding best expert", async (t) => {
  const prisma = new PrismaClient();
  const selector = (new TenderEvidenceSelector(prisma)) as any;

  const experts = [
    { id: "1", fullName: "John Doe", title: "Civil Engineer", profile: "Expert in bridges", disciplines: "['Civil']", sectors: "['Infrastructure']", yearsExperience: 5, isActive: true },
    { id: "2", fullName: "Jane Smith", title: "Architect", profile: "Expert in hospitals", disciplines: "['Architecture']", sectors: "['Healthcare']", yearsExperience: 15, isActive: true }
  ];

  const best = selector.findBestExpert("Hospital architecture design", experts, "Healthcare sector tender");
  assert.strictEqual(best.fullName, "Jane Smith");
  assert.ok(best.relevanceScore > 0.3);
});

test("TenderEvidenceSelector logic - finding best project", async (t) => {
  const prisma = new PrismaClient();
  const selector = (new TenderEvidenceSelector(prisma)) as any;

  const projects = [
    { id: "1", name: "Bridge over Nile", summary: "Large infrastructure project", sector: "Infrastructure", serviceAreas: "['Construction']", contractValue: 2000000, endDate: new Date(), evidences: [] },
    { id: "2", name: "City Hospital", summary: "Healthcare facility design", sector: "Healthcare", serviceAreas: "['Design']", contractValue: 500000, endDate: new Date(), evidences: [] }
  ];

  const best = selector.findBestProject("Large scale infrastructure construction", projects, "Infrastructure project in Egypt");
  assert.strictEqual(best.projectName, "Bridge over Nile");
  assert.ok(best.relevanceScore > 0.3);
});
