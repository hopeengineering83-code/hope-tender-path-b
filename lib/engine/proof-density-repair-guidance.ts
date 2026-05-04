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
  "healthcare functional proof": "Add sector-specific functional workflow content matching the project type: clinical zones, patient flow, IPC (healthcare); hydraulic model, borehole log, pump station (water); road alignment, pavement layer, bridge deck (roads); ESIA matrix, mitigation plan, monitoring framework (environment); ICT architecture, data flow, user training plan (ICT); classroom layout, laboratory specification, accessibility compliance (education).",
  "biomedical / MEP proof": "Add technical systems integration content: medical equipment/gas, MEP, HVAC, radiation shielding (healthcare); hydraulic network, pipeline specifications, structural design (infrastructure); ICT network diagram, server architecture, bandwidth plan (ICT); laboratory equipment, workshop facilities, utility layout (education/industrial).",
  "sector-specific functional depth": "Add sector-specific functional workflow content matching the project type: clinical zones, patient flow (healthcare); hydraulic model, borehole log (water); road alignment, pavement layer (roads); ESIA matrix, mitigation plan (environment); ICT architecture, data flow (ICT); classroom layout, accessibility compliance (education).",
  "technical systems integration": "Add technical systems integration content appropriate to the sector: MEP, HVAC, biomedical equipment (healthcare); hydraulic network, pipeline specs, structural design (infrastructure); ICT network, server architecture (ICT); laboratory equipment, utility layout (education/industrial).",
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
