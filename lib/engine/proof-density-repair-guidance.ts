export type ProofDensityRepairAction = {
  missingSignal: string;
  repairAction: string;
};

const REPAIR_ACTIONS: Record<string, string> = {
  "project names / project proof": "Move the strongest reviewed comparable project into the cover letter and executive summary. Include client, location, scope, services, value where supported, and relevance.",
  "client proof": "Add client names, client reference details, testimony/completion evidence, or bid-team confirmation actions for missing references.",
  "scope proof": "Rewrite generic methodology into scope-by-scope delivery: task, input, activity, output, responsible expert, QA gate, and client decision.",
  "value / scale proof": "Add contract value, project scale, size, duration, service volume, or mark value/scale as a bid-team confirmation item if unsupported.",
  "expert / CV proof": "Name selected experts and map each to role, discipline, qualification, prior comparable work, and responsibility for tender risks.",
  "appendix proof": "Add an evidence-based appendix register for CVs, certificates, registration, licences, photos, drawings, testimony, completion and tender forms.",
  "healthcare functional proof": "Add sector-specific healthcare workflow content: Emergency, OPD, In-patient, Laboratory, Imaging/Radiology, Pharmacy, IPC and patient/staff flow.",
  "biomedical / MEP proof": "Add biomedical and MEP integration: medical equipment, medical gas, electrical loads, HVAC, ICT/telehealth, radiation shielding and coordination review.",
  "approval / QA proof": "Add regulatory approval, QA/QC, staged review gates, document control, drawing revision control, and final submission control details.",
  "bid-review controls": "Add unsupported-claim controls and bid-team confirmation notes for any missing evidence instead of inventing proof.",
};

export function buildProofDensityRepairActions(missingSignals: string[]): ProofDensityRepairAction[] {
  return missingSignals.map((signal) => ({
    missingSignal: signal,
    repairAction: REPAIR_ACTIONS[signal] || "Add verified source evidence or create a bid-team confirmation action before final submission.",
  }));
}

export function proofDensityRepairSummary(missingSignals: string[]): string {
  const actions = buildProofDensityRepairActions(missingSignals);
  if (actions.length === 0) return "Proof-density repair actions: none.";
  return `Proof-density repair actions: ${actions.map((action) => `${action.missingSignal} => ${action.repairAction}`).join(" | ")}`;
}
