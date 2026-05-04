/**
 * Risks and Mitigations table — sector-aware, evaluator-friendly.
 *
 * Evaluators give credit to firms that have thought through delivery
 * risks BEFORE awarding. The benchmark proposal demonstrates this through
 * an explicit risk register with named mitigations. The table built here
 * is sector-aware (different sectors have different top risks) and uses
 * the company's evidence (in-house capabilities, donor experience,
 * staged review process) to anchor mitigations.
 *
 * Conditional: emitted only when the upstream output does not already
 * contain a "Risk Register" or "Risks and Mitigations" heading.
 */

type SectorRisk = { risk: string; impact: "High" | "Medium" | "Low"; likelihood: "High" | "Medium" | "Low"; mitigation: string };

function escCell(text: string): string {
  return text.replace(/\r?\n+/g, " ").replace(/\|/g, "/").replace(/\s{2,}/g, " ").trim();
}

function risksForSector(primarySector: string): SectorRisk[] {
  const sector = primarySector.toLowerCase();
  if (/health|hospital|medical|clinic/.test(sector)) return [
    { risk: "Health Authority licensing delay due to documentation gaps", impact: "High", likelihood: "Medium", mitigation: "Documentation prepared to international donor standards (World Bank ESF / equivalent) which exceed Health Authority requirements. Pre-submission internal review against the licensing checklist." },
    { risk: "Late-stage discovery of clinical workflow conflicts (clean/dirty separation, IPC zoning)", impact: "High", likelihood: "Medium", mitigation: "IPC, patient/staff/supply flow, and medical waste pathways are mapped at schematic stage with three-stage internal review. Conflicts surface before detailed design." },
    { risk: "Imaging room shielding rework after equipment specification changes", impact: "High", likelihood: "Low", mitigation: "Biomedical specialist coordination from schematic stage; lead shielding specified per equipment vendor data; Phase-3.2 sign-off gate before structural finalisation." },
    { risk: "Medical-grade power and UPS sizing errors discovered during commissioning", impact: "High", likelihood: "Low", mitigation: "MEP Lead produces a documented load schedule with UPS, generator, and emergency-power discrimination calculations. Independent peer check at Stage 2." },
    { risk: "Operational handover gaps (O&M, equipment commissioning records)", impact: "Medium", likelihood: "Medium", mitigation: "Close-out package includes as-built drawings, O&M manuals, equipment commissioning records, and warranty register. No close-out without Project Principal sign-off." },
  ];
  if (/water|borehole|hydraulic|sanitary/.test(sector)) return [
    { risk: "Borehole yield below design demand", impact: "High", likelihood: "Medium", mitigation: "Step-drawdown and constant-rate yield testing with documented recovery analysis at each candidate site before final source selection." },
    { risk: "Water quality contamination risk during operations", impact: "High", likelihood: "Low", mitigation: "Sanitary protection zone established around source; chlorination dosing and residual monitoring schedule built into O&M." },
    { risk: "Pump performance degradation over time", impact: "Medium", likelihood: "Medium", mitigation: "Pump-curve matching during selection; spare-parts catalog and operator training included with handover." },
    { risk: "Community ownership and willingness-to-pay shortfall", impact: "High", likelihood: "Medium", mitigation: "Community consultation at planning stage; willingness-to-pay survey; community water management training before handover." },
    { risk: "Leakage and non-revenue water above target", impact: "Medium", likelihood: "Medium", mitigation: "Pressure-zone definition during design; pipe pressure testing during construction; commissioning leakage check before handover." },
  ];
  if (/road|bridge|highway|pavement|transport/.test(sector)) return [
    { risk: "Subgrade weaker than design assumption", impact: "High", likelihood: "Medium", mitigation: "Subgrade CBR testing during construction; contingency layer thickness built into pavement design; weakness rectification protocol agreed in advance with employer." },
    { risk: "Drainage failure during early monsoons", impact: "High", likelihood: "Medium", mitigation: "Cross-drainage and side-drain design uses return-period storms appropriate to road class; commissioning includes drainage flow test before opening." },
    { risk: "Cost / time overrun from variation orders", impact: "High", likelihood: "Medium", mitigation: "FIDIC variation control discipline with named approval authorities; weekly progress and cost reporting; early-warning notice protocol." },
    { risk: "Materials testing non-conformance", impact: "Medium", likelihood: "Medium", mitigation: "Documented materials testing programme (CBR, compaction, aggregate quality, Marshall mix design) with hold-points before pavement layers proceed." },
    { risk: "Road safety audit findings late in project", impact: "Medium", likelihood: "Low", mitigation: "Road safety audit completed before issue of working drawings; audit findings closed before construction starts." },
  ];
  if (/environmental|esia|esmp|safeguard/.test(sector)) return [
    { risk: "Donor safeguard non-acceptance of ESIA on first submission", impact: "High", likelihood: "Medium", mitigation: "ESIA prepared to World Bank ESF / IFC PS standard; pre-submission peer review against safeguard checklist; consultation records and disclosure documentation complete." },
    { risk: "Stakeholder grievance escalation during implementation", impact: "High", likelihood: "Medium", mitigation: "Grievance mechanism designed with documented intake, response, and escalation; vulnerable group consultation; named institutional responsibility." },
    { risk: "Mitigation measures inadequate for residual impact", impact: "High", likelihood: "Low", mitigation: "Mitigation hierarchy applied (avoid → minimise → restore → offset → compensate); ESMP includes monitoring indicators and named responsibilities." },
    { risk: "Resettlement / livelihood restoration delay", impact: "High", likelihood: "Medium", mitigation: "PAP census, valuation, and livelihood restoration plan prepared at appraisal stage; entitlement matrix disclosed to PAPs before construction starts." },
  ];
  if (/ict|software|digital|mis|erp/.test(sector)) return [
    { risk: "Scope drift during development", impact: "High", likelihood: "High", mitigation: "Documented business process review and functional specification with named sign-off authorities. Change requests follow formal CAB process." },
    { risk: "Data migration errors at go-live", impact: "High", likelihood: "Medium", mitigation: "Parallel-run cutover strategy; data validation and reconciliation protocol; named rollback path if reconciliation fails." },
    { risk: "Security incident (data breach, unauthorised access)", impact: "High", likelihood: "Medium", mitigation: "RBAC across application and data layers; encryption at rest and in transit; audit-log retention; periodic penetration testing." },
    { risk: "User adoption shortfall", impact: "High", likelihood: "Medium", mitigation: "Train-the-trainer programme; user manuals; dedicated change-management workstream; phased rollout with feedback incorporation." },
    { risk: "Vendor lock-in", impact: "Medium", likelihood: "Medium", mitigation: "Source code, data, and documentation handover at acceptance; standards-based integrations; SLA-defined exit clause." },
  ];
  if (/urban|master plan|municipal/.test(sector)) return [
    { risk: "Stakeholder disagreement blocking plan adoption", impact: "High", likelihood: "Medium", mitigation: "Multi-stakeholder consultation at baseline, scenario, and draft-plan stages; documented disclosure and feedback incorporation." },
    { risk: "Implementation funding shortfall", impact: "High", likelihood: "Medium", mitigation: "Phasing strategy ties priority projects to fundable horizons; investment framework summary supports municipal budget submissions and donor outreach." },
    { risk: "Regulatory non-alignment with municipal/regional/national frameworks", impact: "High", likelihood: "Low", mitigation: "Regulatory alignment checklist applied at scenario stage; pre-submission peer review against current planning law." },
    { risk: "Data quality gaps in baseline", impact: "Medium", likelihood: "Medium", mitigation: "Primary survey for highest-priority data; documented confidence levels for secondary data; sensitivity analysis where data is sparse." },
  ];
  if (/school|university|campus|education/.test(sector)) return [
    { risk: "Functional approval delay from education authority", impact: "High", likelihood: "Medium", mitigation: "Pre-design consultation with education authority; functional brief signed off; documentation prepared to authority's submission template." },
    { risk: "Pupil-ratio non-compliance for sanitation or learning space", impact: "High", likelihood: "Low", mitigation: "Space schedule audited against national pupil-ratio standards before detailed design; independent peer check at Stage 2." },
    { risk: "Long-life specification compromised by tight budget", impact: "Medium", likelihood: "Medium", mitigation: "Materials specified for school-life durability; lifecycle cost analysis presented to client during BOQ stage to justify long-life choices." },
    { risk: "Climate-responsive design under-performance", impact: "Medium", likelihood: "Low", mitigation: "Daylighting, ventilation, and thermal comfort modelled at concept stage; verified against Ethiopian Building Code climate zone requirements." },
  ];
  return [
    { risk: "Scope misalignment with client expectations", impact: "High", likelihood: "Medium", mitigation: "Documented scope confirmation at inception; named sign-off authority; change-control protocol agreed at contract signature." },
    { risk: "Resource availability shortfall during peak phases", impact: "High", likelihood: "Medium", mitigation: "Permanent-staff team confirmed in this proposal; backup specialists on standby; phased delivery to balance load." },
    { risk: "Quality non-conformance at deliverable stage", impact: "High", likelihood: "Low", mitigation: "Three-stage internal review (schematic, developed, pre-issue) with named reviewer sign-off catches issues before issue." },
    { risk: "Late-stage regulatory or approval blockers", impact: "High", likelihood: "Medium", mitigation: "Regulatory submissions prepared as a core project deliverable, not a separate later activity. Pre-check at Stage 2." },
    { risk: "Stakeholder communication breakdowns", impact: "Medium", likelihood: "Medium", mitigation: "Bi-weekly written progress reports; named single point of contact; documented escalation path." },
  ];
}

export function buildRisksMitigationsTable(opts: { primarySector: string; clientName: string }): string {
  const risks = risksForSector(opts.primarySector);
  const rows = risks.map((r) => `| ${escCell(r.risk)} | ${r.impact} | ${r.likelihood} | ${escCell(r.mitigation)} |`);

  return [
    "## C.5 Risk Register and Mitigation Strategy",
    `Top delivery risks identified for this assignment, with named mitigations grounded in ${opts.clientName === "the client" ? "the firm's" : `${opts.clientName}'s engagement and the firm's`} institutional controls. Risk and likelihood are scored on a three-point scale (High / Medium / Low).`,
    "",
    "| Risk | Impact | Likelihood | Mitigation |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}
