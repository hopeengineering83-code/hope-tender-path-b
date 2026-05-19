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
    { risk: "Climate-responsive design under-performance", impact: "Medium", likelihood: "Low", mitigation: "Daylighting, ventilation, and thermal comfort modelled at concept stage; verified against applicable building code climate zone requirements." },
  ];
  if (/energy|solar|hydropower|substation|transmission|generation|electrification|scada/.test(sector)) return [
    { risk: "Protection relay settings rejected at utility interconnection review", impact: "High", likelihood: "Medium", mitigation: "Protection coordination study peer-reviewed by independent power-systems engineer before utility submission; all relay settings documented in a relay setting schedule issued with 100% design package." },
    { risk: "Solar/wind yield lower than forecast — energy production target missed", impact: "High", likelihood: "Medium", mitigation: "P50/P90 yield estimates using ≥ 10 years of validated irradiance/wind data; conservative degradation factor applied; HOMER sensitivity analysis documented before financial close." },
    { risk: "Grid-code compliance failure at energisation", impact: "High", likelihood: "Low", mitigation: "Grid-code obligations confirmed at design-basis stage; load-flow and short-circuit analysis completed using SKM/ETAP before equipment specification; utility pre-approval obtained at 80% design." },
    { risk: "SCADA commissioning delay — FAT/SAT failure", impact: "Medium", likelihood: "Medium", mitigation: "Factory acceptance test (FAT) protocol prepared and agreed with vendor before manufacture; SAT checklist issued with commissioning plan; SCADA handover training for operator included." },
    { risk: "Soil suitability / civil works overrun for substation or plant", impact: "Medium", likelihood: "Medium", mitigation: "Geotechnical investigation completed before equipment sizing; foundation design contingency in BOQ; weekly progress reporting against construction programme." },
  ];
  if (/agri|irrigation|wua|command.*area|rural.*develop/.test(sector)) return [
    { risk: "Hydrological source flow lower than design demand — scheme undersized", impact: "High", likelihood: "Medium", mitigation: "Minimum 20-year flow record analysis; conservative safe-yield factor applied; back-up source or storage identified at inception stage before design proceeds." },
    { risk: "WUA governance collapse — scheme unused after commissioning", impact: "High", likelihood: "High", mitigation: "WUA readiness assessment at inception; governance structure established and trained before construction starts; O&M and tariff model agreed with community before handover." },
    { risk: "Canal or pipe network seepage — water-use efficiency below target", impact: "Medium", likelihood: "Medium", mitigation: "Lining design specified for soil classification; commissioning seepage test at each canal section before backfill; NRW target set and monitored post-handover." },
    { risk: "Agronomy recommendations misaligned with local crop calendar", impact: "Medium", likelihood: "Medium", mitigation: "On-site agronomy baseline using primary field data (not desktop); FAO Penman-Monteith crop-water calculation validated with local agronomist before scheme sizing." },
  ];
  if (/mining|mineral.*resource|jorc|tailings|ore.*body|mine.*plan/.test(sector)) return [
    { risk: "Resource estimate downgraded at independent competent-person review", impact: "High", likelihood: "Medium", mitigation: "Block-model resource estimation includes sensitivity analysis; competent-person review engaged before report issue; JORC compliance checklist applied throughout." },
    { risk: "Tailings storage facility overtopping or slope failure", impact: "High", likelihood: "Low", mitigation: "TSF design to MAC/ANCOLD guidelines; slope-stability analysis using three independent methods; instrumentation programme installed and monitored from first raise." },
    { risk: "Environmental permit delayed — mine plan unable to proceed", impact: "High", likelihood: "Medium", mitigation: "Environmental baseline and ESIA prepared in parallel with mine plan; regulatory pre-consultation at scoping stage; permit application package prepared as a project deliverable." },
    { risk: "Geotechnical pit slope failure — safety incident and production loss", impact: "High", likelihood: "Low", mitigation: "Slope-stability analysis includes deterministic and probabilistic methods; design-sector specific inter-ramp angles; blasting plan and vibration monitoring included in mine plan." },
  ];
  if (/port|berth|quay|maritime|dredging|harbour/.test(sector)) return [
    { risk: "Met-ocean conditions exceed design assumptions — berth unusable at design utilisation", impact: "High", likelihood: "Medium", mitigation: "Met-ocean analysis uses ≥ 20-year validated data set; fast-time nautical simulation conducted before berth layout is finalised; downtime analysis confirms design utilisation." },
    { risk: "Dredge material characterisation fails — disposal site rejected by environmental authority", impact: "High", likelihood: "Medium", mitigation: "Sediment characterisation (bulk chemistry, elutriate testing) completed before dredge volumes are estimated; disposal site pre-approved by environmental authority before mobilisation." },
    { risk: "Quay wall differential settlement — structural damage to berth", impact: "High", likelihood: "Low", mitigation: "Geotechnical investigation to design depth before structural design; settlement analysis included in foundation design; monitoring prisms installed on structure during and after construction." },
    { risk: "ISPS certification delayed — port cannot receive international vessels", impact: "Medium", likelihood: "Medium", mitigation: "ISPS compliance documentation prepared as a project deliverable; pre-certification audit against ISPS Code at commissioning; port security officer trained before first vessel call." },
  ];
  if (/pipeline|oil.*facilit|gas.*facilit|hazop|p&id|refinery|petrochemical/.test(sector)) return [
    { risk: "Outstanding HAZOP actions not closed before construction — safety incident risk", impact: "High", likelihood: "Medium", mitigation: "HAZOP action register managed to full close-out before detailed design is released; LOPA completed for all high-severity nodes; process safety information (PSI) documented and version-controlled." },
    { risk: "Pipeline stress analysis non-compliance — piping system failure", impact: "High", likelihood: "Low", mitigation: "Pipeline stress analysis using Caesar II or equivalent; compliance with applicable code (ASME B31.4/B31.8); independent peer review of stress report before construction." },
    { risk: "Cathodic protection system failure — pipeline corrosion and leak", impact: "High", likelihood: "Low", mitigation: "Cathodic protection design to NACE/ISO standard; soil resistivity survey before design; close-interval potential survey (CIPS) within 12 months of commissioning." },
    { risk: "Pre-commissioning hydrotest failure — project delay and cost overrun", impact: "Medium", likelihood: "Medium", mitigation: "Hydrotest protocol prepared before construction; pressure rating confirmed in P&ID; commissioning supervisor hold-points at all weld inspections and pre-hydrotest stages." },
  ];
  if (/kyc|aml|core.*banking|microfinance|ifrs|basel|prudential|fintech/.test(sector)) return [
    { risk: "Regulatory gap analysis incomplete — non-compliance finding post-go-live", impact: "High", likelihood: "Medium", mitigation: "Regulatory gap analysis reviewed by licensed local legal counsel before system design; compliance attestation included in handover documentation; no go-live without legal sign-off." },
    { risk: "Data migration errors at go-live — reconciliation failure", impact: "High", likelihood: "High", mitigation: "Parallel-run cutover strategy; data reconciliation protocol signed off before go-live; named rollback path documented and tested before cutover window." },
    { risk: "Cyber security breach — client data exposed", impact: "High", likelihood: "Medium", mitigation: "Pre-go-live penetration test and remediation; RBAC across application and data layers; encryption at rest and in transit; audit-log retention aligned to regulatory minimum." },
    { risk: "User adoption shortfall — system unused after go-live", impact: "High", likelihood: "Medium", mitigation: "Train-the-trainer programme with competency assessment; dedicated change-management workstream; hypercare period with named support contact for 60 days post-go-live." },
  ];
  if (/spectrum|broadband|lte|5g|base.*station|backhaul|mobile.*network|telecoms/.test(sector)) return [
    { risk: "Spectrum licensing delayed — network cannot be activated", impact: "High", likelihood: "Medium", mitigation: "Spectrum licensing roadmap prepared at project inception; frequency assignment application submitted with regulatory authority's required technical data; site engineering does not commence until licence in-principle approval received." },
    { risk: "Coverage simulation underperforms — dead zones in target areas", impact: "High", likelihood: "Medium", mitigation: "Coverage simulation uses calibrated propagation model with field-measured correction factors; drive-test acceptance against coverage KPIs before commercial launch; antenna tilt and power adjustments within SAT protocol." },
    { risk: "Backhaul capacity insufficient — network congestion at peak load", impact: "High", likelihood: "Medium", mitigation: "Traffic demand model uses peak-hour busy-hour traffic at 95th percentile; backhaul capacity sized with minimum 1.5× headroom; expansion pathway documented in network architecture." },
    { risk: "EMR non-compliance — site permit refused or revoked", impact: "Medium", likelihood: "Low", mitigation: "EMR calculations per ICNIRP or national standard completed for each site before antenna installation; exclusion zones marked on site drawings; certificates filed with regulator." },
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
