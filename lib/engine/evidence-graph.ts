import {
  capabilityOverlapScore,
  classifyUniversalTender,
  isUnsafeSectorMismatch,
  sectorOverlapScore,
  type TenderForm,
  type UniversalTenderProfile,
} from "./universal-tender-taxonomy";

export type EvidenceGraphEntityType = "PROJECT" | "EXPERT";
export type EvidenceClass = "DIRECT" | "TRANSFERABLE" | "SUPPORTING" | "UNFIT";

export type EvidenceGraphScore = {
  capabilityFit: number;
  sectorFit: number;
  tenderFormFit: number;
  evidenceProof: number;
  roleFit: number;
  recency: number;
  reviewedSignal: number;
  riskPenalty: number;
  total: number;
};

export type EvidenceGraphNode = {
  id: string;
  entityType: EvidenceGraphEntityType;
  text: string;
  profile: UniversalTenderProfile;
  score: EvidenceGraphScore;
  evidenceClass: EvidenceClass;
  directness: "SAME_SCOPE" | "TRANSFERABLE_SCOPE" | "GENERAL_SUPPORT" | "DO_NOT_USE";
  riskFlags: string[];
  guidance: string;
};

export type EvidenceGraph = {
  tenderProfile: UniversalTenderProfile;
  nodes: EvidenceGraphNode[];
  summary: {
    totalProjects: number;
    totalExperts: number;
    directProjects: number;
    directExperts: number;
    transferableProjects: number;
    transferableExperts: number;
    unfitProjects: number;
    unfitExperts: number;
    unsafeMismatchCount: number;
    topProjectId: string | null;
    topExpertId: string | null;
  };
};

function clean(value?: string | null): string {
  return (value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp100(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function overlap<T extends string>(required: T[], candidate: T[]): number {
  if (required.length === 0) return 1;
  if (candidate.length === 0) return 0;
  const set = new Set(candidate);
  return required.filter((item) => set.has(item)).length / required.length;
}

function tenderFormFit(required: TenderForm[], candidate: TenderForm[]): number {
  if (required.length === 0) return 0.65;
  if (candidate.length === 0) return 0.45;
  return overlap(required, candidate);
}

function evidenceProofScore(text: string): number {
  const value = text.toLowerCase();
  let score = 20;
  if (/reviewed|verified|approved|signed|certified|certificate|completion|acceptance|client\s+letter/i.test(text)) score += 25;
  if (/client|employer|authority|ministry|university|hospital|agency|corporation/i.test(text)) score += 15;
  if (/contract|agreement|po\b|purchase\s+order|reference|ref\b|project\s+id/i.test(text)) score += 15;
  if (/etb|usd|gbp|eur|\$|birr|value|amount|budget|fee/i.test(text) && /\d/.test(text)) score += 10;
  if (/20(1[5-9]|2[0-9])/.test(value)) score += 10;
  if (text.length > 180) score += 5;
  return clamp100(score);
}

function recencyScore(text: string): number {
  const years = [...text.matchAll(/\b(20\d{2}|19\d{2})\b/g)].map((m) => Number(m[1])).filter((year) => year >= 1990 && year <= 2030);
  if (years.length === 0) return 45;
  const latest = Math.max(...years);
  if (latest >= 2023) return 90;
  if (latest >= 2020) return 75;
  if (latest >= 2017) return 60;
  if (latest >= 2012) return 45;
  return 30;
}

function reviewedSignalScore(text: string): number {
  if (/reviewed|verified|approved|source\s+checked|cv\s+checked|selected|validated/i.test(text)) return 90;
  if (/cv|certificate|completion|reference|client|contract|license|licence|registration/i.test(text)) return 70;
  return 45;
}

function roleFitScore(entityType: EvidenceGraphEntityType, tenderText: string, candidateText: string): number {
  const t = tenderText.toLowerCase();
  const c = candidateText.toLowerCase();
  if (entityType === "PROJECT") {
    let score = 45;
    if (/similar|reference|experience|past\s+project|completion|assignment/i.test(t)) score += 20;
    if (/design|supervision|contract\s+administration|geotechnical|urban|asset|interior/i.test(c)) score += 20;
    if (/lead|prime|main\s+consultant|consultant|designer|supervisor|engineer/i.test(c)) score += 10;
    return clamp100(score);
  }
  let score = 40;
  if (/cv|expert|key\s+personnel|staff|team|professional|qualification/i.test(t)) score += 20;
  if (/architect|engineer|planner|geotechnical|supervisor|contract\s+admin|quantity\s+surveyor|asset\s+manager|interior/i.test(c)) score += 25;
  if (/senior|lead|principal|resident|manager|director|head/i.test(c)) score += 10;
  return clamp100(score);
}

function riskFlags(required: UniversalTenderProfile, candidate: UniversalTenderProfile, text: string): string[] {
  const flags: string[] = [];
  if (isUnsafeSectorMismatch(required, candidate)) flags.push("UNSAFE_SECTOR_MISMATCH");
  if (required.serviceCapabilities.length > 0 && capabilityOverlapScore(required.serviceCapabilities, candidate.serviceCapabilities) === 0) flags.push("NO_SERVICE_CAPABILITY_OVERLAP");
  if (required.sectorDomains.length > 0 && candidate.sectorDomains.length > 0 && sectorOverlapScore(required.sectorDomains, candidate.sectorDomains) === 0) flags.push("NO_SECTOR_OVERLAP");
  if (!/reviewed|verified|certificate|completion|client|contract|cv|license|licence|registration/i.test(text)) flags.push("WEAK_PROOF_SIGNAL");
  if (/placeholder|sample|lorem|to\s+be\s+confirmed|tbc|unknown/i.test(text)) flags.push("PLACEHOLDER_OR_UNCONFIRMED");
  return flags;
}

function classifyEvidence(score: EvidenceGraphScore, flags: string[]): EvidenceClass {
  if (flags.includes("UNSAFE_SECTOR_MISMATCH") || flags.includes("PLACEHOLDER_OR_UNCONFIRMED") || score.total < 35) return "UNFIT";
  if (score.capabilityFit >= 70 && score.sectorFit >= 65 && score.evidenceProof >= 55 && score.total >= 70) return "DIRECT";
  if (score.capabilityFit >= 55 && score.total >= 58 && !flags.includes("UNSAFE_SECTOR_MISMATCH")) return "TRANSFERABLE";
  return "SUPPORTING";
}

function directness(evidenceClass: EvidenceClass): EvidenceGraphNode["directness"] {
  if (evidenceClass === "DIRECT") return "SAME_SCOPE";
  if (evidenceClass === "TRANSFERABLE") return "TRANSFERABLE_SCOPE";
  if (evidenceClass === "SUPPORTING") return "GENERAL_SUPPORT";
  return "DO_NOT_USE";
}

function guidance(entityType: EvidenceGraphEntityType, evidenceClass: EvidenceClass, flags: string[]): string {
  if (evidenceClass === "UNFIT") return flags.includes("UNSAFE_SECTOR_MISMATCH")
    ? `Do not use this ${entityType.toLowerCase()} as primary evidence; sector mismatch can mislead the evaluator.`
    : `Do not use this ${entityType.toLowerCase()} for strong proposal claims until proof and fit are corrected.`;
  if (evidenceClass === "DIRECT") return `Use this ${entityType.toLowerCase()} as primary evidence and cite reviewed proof in the proposal.`;
  if (evidenceClass === "TRANSFERABLE") return `Use this ${entityType.toLowerCase()} as transferable evidence; explicitly explain what matches and what differs.`;
  return `Use this ${entityType.toLowerCase()} only as supporting evidence, not as the main proof point.`;
}

function buildNode(params: {
  id: string;
  entityType: EvidenceGraphEntityType;
  text: string;
  tenderText: string;
  tenderProfile: UniversalTenderProfile;
}): EvidenceGraphNode {
  const profile = classifyUniversalTender(params.text);
  const flags = riskFlags(params.tenderProfile, profile, params.text);
  const capabilityFit = clamp100(capabilityOverlapScore(params.tenderProfile.serviceCapabilities, profile.serviceCapabilities) * 100);
  const sectorFit = clamp100(sectorOverlapScore(params.tenderProfile.sectorDomains, profile.sectorDomains) * 100);
  const formFit = clamp100(tenderFormFit(params.tenderProfile.tenderForms, profile.tenderForms) * 100);
  const evidenceProof = evidenceProofScore(params.text);
  const roleFit = roleFitScore(params.entityType, params.tenderText, params.text);
  const recency = recencyScore(params.text);
  const reviewedSignal = reviewedSignalScore(params.text);
  const riskPenalty = flags.includes("UNSAFE_SECTOR_MISMATCH") ? 35 : flags.includes("NO_SERVICE_CAPABILITY_OVERLAP") ? 22 : flags.includes("NO_SECTOR_OVERLAP") ? 14 : flags.includes("WEAK_PROOF_SIGNAL") ? 8 : 0;
  const weighted = capabilityFit * 0.27 + sectorFit * 0.20 + formFit * 0.06 + evidenceProof * 0.16 + roleFit * 0.15 + recency * 0.08 + reviewedSignal * 0.08 - riskPenalty;
  const total = flags.includes("UNSAFE_SECTOR_MISMATCH") ? Math.min(39, weighted) : weighted;
  const score = {
    capabilityFit,
    sectorFit,
    tenderFormFit: formFit,
    evidenceProof,
    roleFit,
    recency,
    reviewedSignal,
    riskPenalty,
    total: clamp100(total),
  };
  const evidenceClass = classifyEvidence(score, flags);
  return {
    id: params.id,
    entityType: params.entityType,
    text: clean(params.text),
    profile,
    score,
    evidenceClass,
    directness: directness(evidenceClass),
    riskFlags: flags,
    guidance: guidance(params.entityType, evidenceClass, flags),
  };
}

function bestId(nodes: EvidenceGraphNode[], entityType: EvidenceGraphEntityType): string | null {
  const candidates = nodes
    .filter((node) => node.entityType === entityType && node.evidenceClass !== "UNFIT")
    .sort((a, b) => b.score.total - a.score.total);
  return candidates[0]?.id ?? null;
}

export function buildEvidenceGraph(input: {
  tenderTitle: string;
  requirements: string[];
  projectLines: string[];
  expertLines: string[];
}): EvidenceGraph {
  const tenderText = `${input.tenderTitle}\n${input.requirements.join("\n")}`;
  const tenderProfile = classifyUniversalTender(tenderText);
  const projectNodes = input.projectLines.map((line, index) => buildNode({
    id: `PROJECT-${index + 1}`,
    entityType: "PROJECT",
    text: line,
    tenderText,
    tenderProfile,
  }));
  const expertNodes = input.expertLines.map((line, index) => buildNode({
    id: `EXPERT-${index + 1}`,
    entityType: "EXPERT",
    text: line,
    tenderText,
    tenderProfile,
  }));
  const nodes = [...projectNodes, ...expertNodes].sort((a, b) => b.score.total - a.score.total);
  return {
    tenderProfile,
    nodes,
    summary: {
      totalProjects: projectNodes.length,
      totalExperts: expertNodes.length,
      directProjects: projectNodes.filter((node) => node.evidenceClass === "DIRECT").length,
      directExperts: expertNodes.filter((node) => node.evidenceClass === "DIRECT").length,
      transferableProjects: projectNodes.filter((node) => node.evidenceClass === "TRANSFERABLE").length,
      transferableExperts: expertNodes.filter((node) => node.evidenceClass === "TRANSFERABLE").length,
      unfitProjects: projectNodes.filter((node) => node.evidenceClass === "UNFIT").length,
      unfitExperts: expertNodes.filter((node) => node.evidenceClass === "UNFIT").length,
      unsafeMismatchCount: nodes.filter((node) => node.riskFlags.includes("UNSAFE_SECTOR_MISMATCH")).length,
      topProjectId: bestId(nodes, "PROJECT"),
      topExpertId: bestId(nodes, "EXPERT"),
    },
  };
}

export function renderEvidenceGraph(input: { graph: EvidenceGraph }): string {
  const rows = [
    "| ID | Type | Class | Total | Capability | Sector | Proof | Role | Risks | Guidance |",
    "|---|---|---|---:|---:|---:|---:|---:|---|---|",
  ];
  for (const node of input.graph.nodes.slice(0, 16)) {
    rows.push(`| ${node.id} | ${node.entityType} | ${node.evidenceClass} | ${node.score.total}% | ${node.score.capabilityFit}% | ${node.score.sectorFit}% | ${node.score.evidenceProof}% | ${node.score.roleFit}% | ${node.riskFlags.join(", ") || "None"} | ${node.guidance} |`);
  }
  return [
    "## Evidence Graph Selection Model",
    `Evidence graph summary: ${input.graph.summary.directProjects} direct project(s), ${input.graph.summary.transferableProjects} transferable project(s), ${input.graph.summary.unfitProjects} unfit project(s); ${input.graph.summary.directExperts} direct expert(s), ${input.graph.summary.transferableExperts} transferable expert(s), ${input.graph.summary.unfitExperts} unfit expert(s). Unsafe mismatches: ${input.graph.summary.unsafeMismatchCount}. Top project: ${input.graph.summary.topProjectId ?? "none"}. Top expert: ${input.graph.summary.topExpertId ?? "none"}.`,
    rows.join("\n"),
  ].join("\n\n");
}
