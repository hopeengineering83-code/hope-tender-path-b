/**
 * CLI wrapper for the portfolio enrichment service.
 *
 * Brings rows that were written before the ingestion fixes up to the same
 * standard: portfolio numbers derived from each record's own reference text,
 * and a `country` column that actually holds a country.
 *
 * Safety:
 * - dry-run unless --apply is explicit;
 * - --apply is refused when VERCEL_ENV is production;
 * - soft-deleted rows are excluded;
 * - no column is ever blanked, and no populated column is overwritten except a
 *   `country` value the resolver proves is not a country;
 * - a row whose own evidence cannot settle its country is skipped and listed.
 *
 * Usage:
 *   npx tsx scripts/enrich-project-portfolio-facts.ts
 *   npx tsx scripts/enrich-project-portfolio-facts.ts --apply
 *   npx tsx scripts/enrich-project-portfolio-facts.ts --company <companyId> --limit 50
 */

import { enrichProjectPortfolio, type EnrichableProject } from "../lib/engine/project-portfolio-enrichment";
import { prisma, prismaReady } from "../lib/prisma";

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const isApply = process.argv.includes("--apply");
  const companyId = flagValue("--company");
  const limitRaw = flagValue("--limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  if (limitRaw && (!Number.isSafeInteger(limit) || (limit as number) < 1)) {
    throw new Error("--limit must be a positive integer.");
  }

  if (isApply && process.env.VERCEL_ENV === "production") {
    throw new Error("--apply is refused against production. Run it against Preview.");
  }

  await prismaReady;
  try {
    const projects = (await prisma.project.findMany({
      where: { deletedAt: null, ...(companyId ? { companyId } : {}) },
      select: {
        id: true,
        name: true,
        clientName: true,
        country: true,
        sector: true,
        summary: true,
        contractValue: true,
        currency: true,
        startDate: true,
        endDate: true,
        trustLevel: true,
      },
      orderBy: { createdAt: "asc" },
      ...(limit ? { take: limit } : {}),
    })) as EnrichableProject[];

    const result = await enrichProjectPortfolio({
      projects,
      client: prisma.project,
      apply: isApply,
    });

    const { before, after } = result;
    const line = (label: string, b: number, a: number) =>
      `${label.padEnd(28)} ${String(b).padStart(6)} -> ${String(a).padStart(6)}${b === a ? "" : "   CHANGED"}`;

    console.log(isApply ? "=== APPLIED ===" : "=== DRY RUN (no writes) ===");
    console.log(line("total projects", before.totalProjects, after.totalProjects));
    console.log(line("SOURCE_VERIFIED", before.sourceVerified, after.sourceVerified));
    console.log(line("country populated", before.countryPopulated, after.countryPopulated));
    console.log(line("country valid", before.countryValid, after.countryValid));
    console.log(line("country malformed", before.countryMalformed, after.countryMalformed));
    console.log(line("contractValue populated", before.contractValuePopulated, after.contractValuePopulated));
    console.log(line("currency populated", before.currencyPopulated, after.currencyPopulated));
    console.log(line("startDate populated", before.startDatePopulated, after.startDatePopulated));
    console.log(line("endDate populated", before.endDatePopulated, after.endDatePopulated));
    console.log(line("both dates populated", before.bothDatesPopulated, after.bothDatesPopulated));
    console.log("");
    console.log(`rows examined              ${result.rowsExamined}`);
    console.log(`rows modified              ${result.rowsModified}`);
    console.log(`rows unchanged             ${result.rowsUnchanged}`);
    console.log(`rows skipped for ambiguity ${result.rowsSkippedForAmbiguity}`);
    console.log(`country corrected          ${result.countryCorrected}`);
    console.log(`contractValue filled       ${result.contractValueFilled}`);
    console.log(`currency filled            ${result.currencyFilled}`);
    console.log(`startDate filled           ${result.startDateFilled}`);
    console.log(`endDate filled             ${result.endDateFilled}`);
    console.log(`clientName filled          ${result.clientNameFilled}`);
    console.log(`sector filled              ${result.sectorFilled}`);

    if (result.unresolvedCountries.length > 0) {
      console.log("");
      console.log(`--- ${result.unresolvedCountries.length} row(s) whose country the record's own evidence cannot settle ---`);
      for (const row of result.unresolvedCountries.slice(0, 40)) {
        console.log(`  ${row.name}: stored=${JSON.stringify(row.stored)} — ${row.reason}`);
      }
      if (result.unresolvedCountries.length > 40) {
        console.log(`  ... and ${result.unresolvedCountries.length - 40} more`);
      }
    }

    console.log("");
    console.log("=== JSON Summary ===");
    console.log(
      JSON.stringify(
        {
          applied: result.applied,
          before,
          after,
          rowsExamined: result.rowsExamined,
          rowsModified: result.rowsModified,
          rowsUnchanged: result.rowsUnchanged,
          rowsSkippedForAmbiguity: result.rowsSkippedForAmbiguity,
          countryCorrected: result.countryCorrected,
          contractValueFilled: result.contractValueFilled,
          currencyFilled: result.currencyFilled,
          startDateFilled: result.startDateFilled,
          endDateFilled: result.endDateFilled,
          clientNameFilled: result.clientNameFilled,
          sectorFilled: result.sectorFilled,
        },
        null,
        2,
      ),
    );

    if (!isApply) console.log("\nTo write these changes, rerun with --apply.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("Portfolio enrichment failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
