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
  "healthcare functional proof": "Add sector-specific functional workflow content matching the project type: clinical zones, patient flow, IPC (healthcare); hydraulic model, borehole log, pump station (water); road alignment, pavement layer, bridge deck (roads); ESIA matrix, mitigation plan, monitoring framework (environment); ICT architecture, data flow, user training plan (ICT); classroom layout, laboratory specification, accessibility compliance (education); load forecast, SLD, grid-code compliance (energy); FAO Penman-Monteith, WUA governance (agriculture); JORC resource estimation, slope stability analysis (mining); berth design, dredging plan, ISPS (port); P&ID, HAZOP, pipeline integrity (oil & gas); KYC/AML, data migration, UAT protocol (financial); RF propagation, backhaul budget, NOC dashboard (telecoms).",
  "biomedical / MEP proof": "Add technical systems integration content: medical equipment/gas, MEP, HVAC, radiation shielding (healthcare); hydraulic network, pipeline specifications, structural design (infrastructure); ICT network diagram, server architecture, bandwidth plan (ICT); laboratory equipment, workshop facilities, utility layout (education/industrial); protection relay, SCADA, cathodic protection (energy/oil & gas); vessel traffic, shore power, mooring analysis (port); core-banking integration, RBAC, encryption (financial); RF link budget, core network dimensioning (telecoms).",
  "sector-specific functional depth": "Add sector-specific functional workflow content matching the project type: clinical zones, patient flow (healthcare); hydraulic model, borehole log (water); road alignment, pavement layer (roads); ESIA matrix, mitigation plan (environment); ICT architecture, data flow (ICT); classroom layout, accessibility compliance (education); load forecast, grid-code review (energy); FAO Penman-Monteith irrigation scheduling (agriculture); JORC resource report, tailings design (mining); berth layout, dredging scope (port); HAZOP study, P&ID development (oil & gas); KYC/AML framework, data migration (financial); spectrum plan, RF propagation model (telecoms).",
  "technical systems integration": "Add technical systems integration content appropriate to the sector: MEP, HVAC, biomedical equipment (healthcare); hydraulic network, pipeline specs, structural design (infrastructure); ICT network, server architecture (ICT); laboratory equipment, utility layout (education/industrial); protection relay, SCADA, equipment schedules (energy); mooring analysis, dredging plan (port); P&ID, instrumentation (oil & gas); system integration APIs, RBAC (financial); link budget, core network (telecoms).",
  "systems / infrastructure integration proof": "Add technical systems integration content appropriate to the sector: MEP, HVAC, biomedical equipment (healthcare); hydraulic network, pipeline specs (infrastructure); ICT network, server architecture (ICT); protection relay, SCADA (energy); mooring analysis, ISPS (port); P&ID, HAZOP, pipeline integrity (oil & gas); RBAC, APIs, data migration (financial); link budget, core network dimensioning (telecoms).",
  "sector-specific technical depth": "Add sector-specific technical vocabulary: clinical zoning, IPC (healthcare); EPANET, WaterCAD, yield test (water); CBR, AASHTO, Marshall mix (roads); ESIA, ESMP, mitigation hierarchy (environment); load forecast, grid-code, SCADA (energy); JORC, slope stability, tailings (mining); berth design, dredging, ISPS (port); HAZOP, P&ID, pipeline integrity (oil & gas); KYC/AML, Basel, IFRS (financial); spectrum, RF propagation, backhaul (telecoms); FAO Penman, irrigation scheme, WUA (agriculture).",
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
