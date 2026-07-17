export const SETTINGS_PRESENTATION_SEMANTICS = {
  scope: "PRESENTATION_DEFAULTS",
  affectsTenderFacts: false,
  affectsSubmissionRequirements: false,
  affectsEvidence: false,
  affectsClientData: false,
  description:
    "These values are authoring and presentation preferences only. Tender-extracted facts and submission requirements always take precedence.",
} as const;

export type SettingsPresentationSemantics = typeof SETTINGS_PRESENTATION_SEMANTICS;
