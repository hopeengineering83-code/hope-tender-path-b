import { HEALTHCARE_UNWEIGHTED_CRITERIA } from "./criterion-coverage-model";

export const SANITIZED_HEALTHCARE_ACCEPTANCE_FIXTURE = Object.freeze({
  company: { name: "SYNTH Healthcare Engineering Ltd", reviewed: true, brandAsset: "SYNTH-logo.svg" },
  experts: [
    { id: "SYNTH-EXP-1", name: "Amina Example", discipline: "biomedical", reviewed: true },
    { id: "SYNTH-EXP-2", name: "Daniel Example", discipline: "medical_planning", reviewed: true },
  ],
  projects: [{ id: "SYNTH-PRJ-1", name: "Synthetic District Hospital", sector: "Healthcare", reviewed: true }],
  tender: {
    id: "SYNTH-TENDER-HEALTH-1", title: "Synthetic Hospital Equipment and Clinical Planning Services",
    sourceFiles: ["SYNTH-healthcare-rfp.pdf"], sourceRevision: "SYNTH-SOURCE-REV-1",
    mandatoryCriteria: [...HEALTHCARE_UNWEIGHTED_CRITERIA],
  },
});
