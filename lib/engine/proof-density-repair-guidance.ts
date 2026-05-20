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
  "healthcare functional proof": "Add sector-specific functional workflow content matching the project type: clinical zones, patient flow, IPC (healthcare); hydraulic model, borehole log, pump station (water); road alignment, pavement layer, bridge deck (roads); ESIA matrix, mitigation plan, monitoring framework (environment); ICT architecture, data flow, user training plan (ICT); load-flow analysis, protection relay coordination, P50/P90 yield (energy); FAO Penman-Monteith crop-water, command-area mapping, WUA governance (agriculture); JORC resource estimate, TSF design, slope-stability analysis (mining); met-ocean analysis, nautical simulation, ISPS compliance (port/maritime); HAZOP study, P&ID, pipeline stress analysis (oil & gas); KYC/AML gap analysis, RBAC, data migration reconciliation (financial services); spectrum planning, RF coverage simulation, drive-test KPIs (telecoms).",
  "biomedical / MEP proof": "Add technical systems integration content: medical equipment/gas, MEP, HVAC, radiation shielding (healthcare); hydraulic network, pipeline specifications, structural design (infrastructure); ICT network diagram, server architecture, bandwidth plan (ICT); load-flow model, SCADA architecture, protection relay settings (energy); irrigation network design, diversion/weir structural details (agriculture); mine plan, geotechnical design, tailings facility design (mining); berth structural design, dredge disposal plan, shore-power layout (port); P&ID, cathodic protection, pipeline stress analysis (oil & gas); system architecture, integration plan, cybersecurity controls (financial); base-station siting, backhaul path design, EMR compliance (telecoms).",
  "sector-specific functional depth": "Add sector-specific functional workflow content matching the project type: clinical zones, patient flow (healthcare); hydraulic model, borehole log (water); road alignment, pavement layer (roads); ESIA matrix, mitigation plan (environment); ICT architecture, data flow (ICT); load-flow analysis, P50/P90 yield, grid-code compliance (energy); FAO Penman-Monteith crop-water, WUA governance (agriculture); JORC resource estimate, slope-stability analysis (mining); nautical simulation, dredge disposal plan (port); HAZOP study, LOPA, pipeline integrity (oil & gas); regulatory gap analysis, data migration plan (financial); RF coverage simulation, spectrum roadmap (telecoms).",
  "technical systems integration": "Add technical systems integration content appropriate to the sector: MEP, HVAC, biomedical equipment (healthcare); hydraulic network, pipeline specs, structural design (infrastructure); ICT network, server architecture (ICT); SCADA, protection relays, civil/structural (energy); irrigation network, WUA operations (agriculture); mine plan, TSF, geotechnical controls (mining); berth structure, dredge disposal, ISPS (port); P&ID, cathodic protection, HAZOP controls (oil & gas); regulatory reporting, RBAC, cybersecurity (financial); base-station network, backhaul, drive-test acceptance (telecoms).",
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
