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
  if (/heritage|conserv.*historic|historic.*building|monument.*restor|adaptive.*reuse/.test(sector)) return [
    { risk: "Heritage authority rejection of conservation approach at design stage", impact: "High", likelihood: "Medium", mitigation: "Pre-application consultation with the heritage authority at Conservation Management Plan stage; ICOMOS minimal-intervention and reversibility principles documented before design freeze; philosophy approved before procurement of specialist contractors." },
    { risk: "Material incompatibility discovered during repair works causing damage to historic fabric", impact: "High", likelihood: "Medium", mitigation: "Material-compatibility testing (XRF analysis, petrographic) conducted before specifying repair mortars or render systems; sample panel installed and approved before full application." },
    { risk: "Structural investigation revealing unexpected deterioration beyond scope", impact: "High", likelihood: "Medium", mitigation: "Provisional quantities in BOQ for structural intervention; contingency sum agreed with client; preliminary investigation completed before final design." },
    { risk: "Subcontractor lacking specialist conservation skills", impact: "High", likelihood: "Medium", mitigation: "Contractor pre-qualification includes demonstrated heritage conservation experience; NCR register for every non-conforming intervention; specialist's CV approved before commencement." },
    { risk: "Photogrammetric / measured survey data insufficient for working drawings", impact: "Medium", likelihood: "Low", mitigation: "Point-cloud processing verified against traditional measurement before design progresses; supplementary survey triggered if deviations exceed threshold." },
  ];
  if (/industrial|manufactur|factory|processing.*plant|production.*facilit/.test(sector)) return [
    { risk: "Process-flow changes late in design requiring major structural re-design", impact: "High", likelihood: "Medium", mitigation: "Process brief signed off by client and process engineer before structural design commences; formal change-control procedure for any post-sign-off modifications." },
    { risk: "Environmental permit delayed due to incomplete EIA", impact: "High", likelihood: "Medium", mitigation: "Environmental baseline and EIA prepared in parallel with scheme design; regulatory pre-consultation at scoping stage; permit application package included as a project deliverable." },
    { risk: "Equipment procurement delays cascading to commissioning schedule", impact: "High", likelihood: "High", mitigation: "Equipment long-lead list issued to procurement team at 60% design; early letters of intent for critical items; two-week float built into construction programme for equipment installation." },
    { risk: "FAT/SAT failure delaying plant start-up", impact: "High", likelihood: "Medium", mitigation: "FAT protocol prepared and agreed with equipment vendor before manufacture; witnessed by resident engineer; corrective-action register from FAT cleared before SAT commences." },
    { risk: "Utility load calculations underestimating peak demand", impact: "Medium", likelihood: "Medium", mitigation: "Utility demand schedule prepared at concept stage with 20% contingency; verified against equipment vendor data at 60% design; load management plan included in O&M manual." },
  ];
  if (/high.?rise|tall.*build|tower.*build|multi.?stor.*build|\bG\+\d{2,}\b/.test(sector)) return [
    { risk: "Structural design non-compliance with seismic code rejected by authority", impact: "High", likelihood: "Medium", mitigation: "Structural calculations prepared to EBCS-8/EN 1998 using ETABS/SAP2000; submitted to authority in prescribed format; independent peer review by registered structural engineer before submission." },
    { risk: "BIM coordination clashes discovered late causing re-design cost", impact: "High", likelihood: "Medium", mitigation: "LOD 300 BIM coordination model with weekly clash-detection report; MEP routing confirmed against structural layout before shop drawings are issued." },
    { risk: "Curtain-wall water infiltration failure during first rainy season", impact: "High", likelihood: "Low", mitigation: "Curtain-wall performance specification includes air-water-structural test protocol (ASTM E330/E331/E283); mock-up panel tested before bulk fabrication; architect's site review at every level." },
    { risk: "Transfer structure capacity error causing structural failure risk", impact: "High", likelihood: "Low", mitigation: "Transfer beam/slab analysis peer-reviewed by independent structural engineer before construction commences; hold-point inspection at formwork, rebar, and concrete pour stages." },
    { risk: "Lift acceptance test failure delaying occupancy certificate", impact: "Medium", likelihood: "Medium", mitigation: "Lift specification includes load test protocol and authority inspection requirements; contractor's QA plan includes pre-acceptance test checklist reviewed by project engineer." },
  ];
  if (/hospital|hotel|resort|hospitality|lodge|serviced.*apart/.test(sector)) return [
    { risk: "Brand-operator approval delayed at design development stage", impact: "High", likelihood: "Medium", mitigation: "Brand-standard compliance matrix embedded in design brief from concept stage; mock guestroom constructed and signed off before full fit-out commences; brand-operator review milestones in programme." },
    { risk: "FF&E procurement lead-time overrun causing delayed opening", impact: "High", likelihood: "High", mitigation: "FF&E procurement schedule prepared at design development with lead-time tracking; early orders placed for long-lead items; mock room approved before bulk orders placed." },
    { risk: "Pre-opening MEP commissioning failure (HVAC, hot water, AV)", impact: "High", likelihood: "Medium", mitigation: "Pre-opening commissioning plan prepared 3 months before opening; room-by-room snagging protocol; brand-operator final punch list clearance before soft opening." },
    { risk: "Occupancy-certificate delay due to fire-safety non-compliance", impact: "High", likelihood: "Medium", mitigation: "Fire-safety strategy agreed with authority at design stage; compartmentation, detection, and suppression design peer-reviewed before construction; pre-occupancy fire inspection staged." },
    { risk: "Sustainability shortfall — operator ESG commitment not met", impact: "Medium", likelihood: "Medium", mitigation: "Water consumption target ≤200 L/guest-night designed-in through water-efficient fittings and recirculation; GSTC criteria alignment report issued at handover." },
  ];
  if (/supervis|contract.*admin|resident.*engineer|site.*supervis/.test(sector)) return [
    { risk: "Contractor quality non-conformances not caught before structural pour", impact: "High", likelihood: "Medium", mitigation: "Inspection and Test Plan (ITP) issued and approved before any concrete work commences; hold-point inspections at rebar installation and before pour; NCR issued within 24 hours of non-conformance." },
    { risk: "Variation-order disputes escalating to formal claims", impact: "High", likelihood: "Medium", mitigation: "FIDIC Clause 13 variation-control discipline enforced; all engineer's instructions issued in writing; variation-order register maintained; early-warning notices issued as soon as potential variations are identified." },
    { risk: "Payment certificate errors causing contractor cash-flow disputes", impact: "High", likelihood: "Medium", mitigation: "Measurement and valuation conducted jointly with contractor; interim payment certificate prepared within 28 days of measurement date; certified quantities cross-checked against BOQ." },
    { risk: "Schedule overrun due to inadequate progress monitoring", impact: "High", likelihood: "Medium", mitigation: "Contractor's programme reviewed and accepted at mobilisation; monthly S-curve and critical-path review; early-warning mechanism triggered when 2+ weeks of float is consumed." },
    { risk: "Defects liability period management failure — client left with unrectified defects", impact: "Medium", likelihood: "Medium", mitigation: "Defects register maintained throughout construction; pre-DLP inspection 4 weeks before expiry; retention not released until all notified defects are certified as corrected." },
  ];
  if (/geotech|soil.*invest|borehole|ground.*invest|site.*invest|subsoil/.test(sector)) return [
    { risk: "Borehole obstructed by boulders — programme delayed and scope changed", impact: "High", likelihood: "Medium", mitigation: "Rotary percussion drilling rig on standby; alternative borehole locations pre-agreed with client; programme float of 10% built in for drilling obstructions." },
    { risk: "Laboratory test results outside acceptance criteria — additional sampling required", impact: "High", likelihood: "Low", mitigation: "Samples dispatched to accredited laboratory within 48 hours of extraction; initial index tests reviewed before advanced shear-strength tests commissioned; contingency samples stored." },
    { risk: "Groundwater encountered above anticipated level — affects foundation design", impact: "High", likelihood: "Medium", mitigation: "Standpipe piezometers installed in minimum 20% of boreholes; readings taken at 4-hour intervals and 24 hours after drilling; seasonal groundwater levels discussed in report." },
    { risk: "Bearing capacity lower than anticipated — foundations more expensive than estimated", impact: "High", likelihood: "Medium", mitigation: "Preliminary bearing capacity estimate provided with results of each borehole as drilling progresses; client notified immediately if results indicate a change in foundation type; options-analysis section in report." },
    { risk: "Report peer review identifies errors — resubmission required", impact: "Medium", likelihood: "Low", mitigation: "Internal technical review by senior geotechnical engineer before report issue; independent peer review checklist applied to bearing capacity and settlement calculations; one-pass revision cycle built into programme." },
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
