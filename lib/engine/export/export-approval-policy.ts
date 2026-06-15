export type ApprovalStatus = "BLOCKED" | "NEEDS_REVIEW" | "AUTHORITY_READY";

export type ExportApprovalDecision = {
  ok: boolean;
  status: ApprovalStatus;
  httpStatus: 200 | 422;
  code: "READY" | "REVIEW_BLOCKED" | "REVIEW_NOT_READY";
  message: string;
  nextAction: string;
};

export function evaluateExportApproval(status: ApprovalStatus): ExportApprovalDecision {
  if (status === "AUTHORITY_READY") {
    return {
      ok: true,
      status,
      httpStatus: 200,
      code: "READY",
      message: "Review is ready for final export.",
      nextAction: "Continue final ZIP export.",
    };
  }

  return {
    ok: false,
    status,
    httpStatus: 422,
    code: status === "BLOCKED" ? "REVIEW_BLOCKED" : "REVIEW_NOT_READY",
    message: "Final export is blocked until review status is AUTHORITY_READY.",
    nextAction: "Open the review panel, resolve all issues, refresh review, then retry ZIP export.",
  };
}
