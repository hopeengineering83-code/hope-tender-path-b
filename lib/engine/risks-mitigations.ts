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
  if (/energy|power|solar|wind|grid|generation|transmission/.test(sector)) return [
    { risk: "Grid-code non-compliance causing energisation delay", impact: "High", likelihood: "Medium", mitigation: "Grid-code review performed at FEED stage; protection relay settings peer-reviewed by independent power systems specialist before energisation." },
    { risk: "Equipment long-lead times delaying commissioning", impact: "High", likelihood: "High", mitigation: "Equipment list issued to procurement team at detailed-design completion; early LOI for transformers, switchgear, and inverters where applicable." },
    { risk: "Demand-projection error causing under/over-sizing", impact: "High", likelihood: "Low", mitigation: "Load forecast uses minimum 5 years of metered consumption data, growth-projection model, and demand-side management assumptions clearly stated." },
    { risk: "Environmental approval delays for new transmission routes", impact: "Medium", likelihood: "Medium", mitigation: "Environmental screening initiated at concept stage; route alternatives documented; stakeholder consultation records retained for regulatory submission." },
  ];
  if (/agri|irrigation|farm|crop|livestock|rural develop/.test(sector)) return [
    { risk: "Water availability variability below design yield", impact: "High", likelihood: "Medium", mitigation: "Hydrological analysis uses a minimum 20-year flow record; climate-adjusted low-flow scenario included in design; carry-over storage designed accordingly." },
    { risk: "Beneficiary adoption shortfall (farmers do not use the scheme)", impact: "High", likelihood: "Medium", mitigation: "Community consultation at design stage; willingness-to-pay survey; water-user association established before handover; farmer training delivered." },
    { risk: "O&M incapacity after handover", impact: "High", likelihood: "Medium", mitigation: "O&M manual prepared in local language; operators trained before handover; spare-parts list and maintenance schedule included in handover package." },
    { risk: "Soil salinity build-up under irrigation", impact: "Medium", likelihood: "Low", mitigation: "Drainage design includes leaching fraction; salinity monitoring schedule included in ESMP; agronomist reviews crop rotation to reduce risk." },
  ];
  if (/mining|mineral|quarry|extracti/.test(sector)) return [
    { risk: "Geotechnical model error leading to slope instability", impact: "High", likelihood: "Medium", mitigation: "Independent geotechnical review at FEED stage; slope stability analysis uses three methods (LEM, numerical, empirical); monitoring instrumentation specified." },
    { risk: "Resource estimate downgrade after pre-feasibility", impact: "High", likelihood: "Low", mitigation: "JORC-compliant resource estimation with documented confidence classification; data quality QC programme reviewed by independent competent person." },
    { risk: "Tailings containment failure", impact: "High", likelihood: "Low", mitigation: "TSF designed to MAC/ANCOLD guidelines; annual dam-safety review; emergency action plan; closure provisions defined at design stage." },
    { risk: "Community opposition and social licence risk", impact: "High", likelihood: "Medium", mitigation: "ESIA and stakeholder engagement plan prepared before construction; grievance mechanism established; local employment and content plan documented." },
  ];
  if (/\bport\b|harbor|harbour|maritime|quay|berth|shipping terminal/.test(sector)) return [
    { risk: "Under-designed berth for actual vessel class", impact: "High", likelihood: "Low", mitigation: "Vessel-class parameters (LOA, DWT, draft) confirmed with port authority before design; mooring analysis uses design vessel in worst-case met-ocean conditions." },
    { risk: "Dredging spoil disposal regulatory non-compliance", impact: "High", likelihood: "Medium", mitigation: "Sediment characterisation completed before dredging; spoil disposal plan approved by environmental authority; monitoring plan in place during dredging." },
    { risk: "Throughput projections overstated — over-specification of infrastructure", impact: "High", likelihood: "Medium", mitigation: "Traffic demand study uses conservative, base, and optimistic scenarios; phased infrastructure investment tied to traffic triggers." },
    { risk: "Nautical safety incident during construction or initial operations", impact: "High", likelihood: "Low", mitigation: "Nautical simulation performed at design stage; pilotage procedures agreed with harbour master; ISPS compliance verified before handover." },
  ];
  if (/oil|gas|petroleum|pipeline|refinery|petrochemical/.test(sector)) return [
    { risk: "Process safety incident (loss of containment)", impact: "High", likelihood: "Low", mitigation: "HAZOP study at detailed-design stage with all action items tracked to close-out; LockOut-TagOut and PTW systems in place before start-up." },
    { risk: "P&ID change after HAZOP causing design rework", impact: "Medium", likelihood: "High", mitigation: "P&ID freeze protocol applied after HAZOP; all modifications go through formal management-of-change procedure with risk re-assessment." },
    { risk: "Vendor data delays cascading to engineering schedule", impact: "High", likelihood: "Medium", mitigation: "Vendor data requirements issued with purchase orders; weekly vendor data tracking; early LOI for long-lead items." },
    { risk: "Pipeline integrity failure in service", impact: "High", likelihood: "Low", mitigation: "Pipeline designed to API 1104 / ISO 3183; in-line inspection (ILI) programme specified at handover; cathodic protection system designed and commissioned." },
  ];
  if (/finance|bank|micro.?finance|insurance|credit|lending|investment fund/.test(sector)) return [
    { risk: "Regulatory non-compliance causing licence revocation", impact: "High", likelihood: "Low", mitigation: "Regulatory gap analysis at inception; compliance framework design reviewed by licensed local legal counsel; regulatory liaison built into engagement plan." },
    { risk: "Core-banking system integration failure", impact: "High", likelihood: "Medium", mitigation: "Integration architecture peer-reviewed at design stage; phased go-live with parallel-run period; rollback plan documented before cutover." },
    { risk: "Data migration errors corrupting client records", impact: "High", likelihood: "Medium", mitigation: "Full data-quality assessment before migration; test migration on extracted sample; reconciliation report signed off before go-live." },
    { risk: "Staff resistance to process changes (KYC/AML, credit policy)", impact: "Medium", likelihood: "High", mitigation: "Change-management plan integrated into project; train-the-trainer model; management champion identified at each business unit." },
  ];
  if (/telecom|broadband|spectrum|mobile network|isp/.test(sector)) return [
    { risk: "Spectrum licensing delay preventing network launch", impact: "High", likelihood: "Medium", mitigation: "Spectrum application submitted at project inception; regulatory liaison officer named; alternative frequency fallback assessed during planning." },
    { risk: "Site acquisition failure blocking base-station rollout", impact: "High", likelihood: "Medium", mitigation: "Site-siting report identifies two alternative locations per target site; lease negotiation tracked weekly with escalation to steering committee." },
    { risk: "Backhaul capacity insufficient for peak demand", impact: "High", likelihood: "Low", mitigation: "Backhaul dimensioned at 120% of peak throughput forecast; upgrade path specified in network design for additional capacity." },
    { risk: "QoS SLA breach in first operational year", impact: "High", likelihood: "Medium", mitigation: "Network KPI monitoring dashboard configured before go-live; hypercare optimisation period of 4–6 weeks after launch; SLA breach protocol agreed with client." },
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
