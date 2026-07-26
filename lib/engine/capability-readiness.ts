import { CANONICAL_AI_PROVIDER_ORDER, isProviderConfigured } from "../ai-provider-registry";

export type CapabilityKey = "analysis_ai" | "proposal_ai" | "ocr" | "storage" | "database" | "worker_dispatch";
export type CapabilityStatus = "READY" | "DEGRADED" | "BLOCKED";
export type CapabilityReadiness = {
  capability: CapabilityKey;
  status: CapabilityStatus;
  correctiveAction: string | null;
};

function configured(name: string): boolean {
  return Boolean((process.env[name] ?? "").trim());
}

/** Capability-specific truth: general AI availability never implies OCR or worker readiness. */
export function getCapabilityReadiness(): CapabilityReadiness[] {
  const aiReady = CANONICAL_AI_PROVIDER_ORDER.some((provider) => isProviderConfigured(provider));
  const ocrExplicitlyDisabled = /^(0|false|off|no)$/i.test(process.env.PDF_OCR_ENABLED ?? "");
  const ocrReady = !ocrExplicitlyDisabled && configured("ANTHROPIC_API_KEY");
  const externalStorage = configured("BLOB_READ_WRITE_TOKEN") || configured("S3_BUCKET") || configured("AWS_S3_BUCKET");
  const dbStorage = /^(1|true|yes)$/i.test(process.env.ALLOW_DB_FILE_STORAGE ?? "");

  return [
    { capability: "analysis_ai", status: aiReady ? "READY" : "BLOCKED", correctiveAction: aiReady ? null : "Configure at least one canonical AI provider." },
    { capability: "proposal_ai", status: aiReady ? "READY" : "BLOCKED", correctiveAction: aiReady ? null : "Configure at least one canonical AI provider." },
    { capability: "ocr", status: ocrReady ? "READY" : "BLOCKED", correctiveAction: ocrReady ? null : "Enable PDF OCR and configure the OCR provider key." },
    { capability: "storage", status: externalStorage ? "READY" : dbStorage ? "DEGRADED" : "BLOCKED", correctiveAction: externalStorage ? null : dbStorage ? "Configure durable external object storage before production scale." : "Configure external storage or explicitly allow database file storage." },
    { capability: "database", status: configured("DATABASE_URL") ? "READY" : "BLOCKED", correctiveAction: configured("DATABASE_URL") ? null : "Configure DATABASE_URL." },
    { capability: "worker_dispatch", status: configured("AI_JOBS_WORKER_SECRET") || configured("CRON_SECRET") ? "READY" : "BLOCKED", correctiveAction: configured("AI_JOBS_WORKER_SECRET") || configured("CRON_SECRET") ? null : "Configure worker or cron authentication." },
  ];
}
