/**
 * Company Vault document deletion response classifier.
 *
 * Extracted from app/dashboard/company/page.tsx deleteDoc() so the logic
 * can be tested without React/DOM. The component imports and uses this
 * function; tests import the same function — no duplicated logic.
 */

export type DeleteResponse = {
  ok: boolean;
  status: number;
  code?: string;
  retryable?: boolean;
};

export type DeleteActionResult = {
  /** User-facing message (empty string = no message needed). */
  message: string;
  /** Whether to reload the authoritative document list from the server. */
  shouldReload: boolean;
  /** Whether to optimistically remove the row from local state. */
  shouldRemoveRow: boolean;
  /** Whether to disable the row's actions (Download/Re-extract/Delete). */
  shouldDisableRow: boolean;
  /** Whether to close the delete confirmation panel. */
  shouldCloseConfirmation: boolean;
  /** Whether this is an error state (not a successful/pending outcome). */
  isError: boolean;
};

/**
 * Classify a DELETE response and determine the UI action.
 *
 * @param res - The parsed DELETE response from /api/company/documents/[id]
 * @param refreshSucceeded - Whether loadDocs() succeeded after the delete
 *   (only relevant when shouldReload would be true — if reload fails, the
 *   UI must fall back to optimistic local state updates).
 */
export function classifyDeleteResponse(
  res: DeleteResponse,
  refreshSucceeded: boolean,
): DeleteActionResult {
  if (res.ok) {
    // Success: server confirmed deletion.
    if (!refreshSucceeded) {
      return {
        message: "The document was deleted successfully, but the document list could not be refreshed. Please refresh the page to see the updated list.",
        shouldReload: false,
        shouldRemoveRow: true,
        shouldDisableRow: false,
        shouldCloseConfirmation: true,
        isError: false,
      };
    }
    return {
      message: "",
      shouldReload: true,
      shouldRemoveRow: false,
      shouldDisableRow: false,
      shouldCloseConfirmation: true,
      isError: false,
    };
  }

  // NOT_FOUND (404) — idempotent
  if (res.status === 404 || res.code === "NOT_FOUND") {
    if (!refreshSucceeded) {
      return {
        message: "The document was deleted, but the document list could not be refreshed. Please refresh the page to see the current list.",
        shouldReload: false,
        shouldRemoveRow: true,
        shouldDisableRow: false,
        shouldCloseConfirmation: true,
        isError: false,
      };
    }
    return {
      message: "",
      shouldReload: true,
      shouldRemoveRow: false,
      shouldDisableRow: false,
      shouldCloseConfirmation: true,
      isError: false,
    };
  }

  // REVIEWED_PROVENANCE_DEPENDENCY (409) — preserve row
  if (res.code === "REVIEWED_PROVENANCE_DEPENDENCY") {
    return {
      message: "Deletion blocked because reviewed experts or projects still depend on this source document. Remove or un-review the dependent records first.",
      shouldReload: false,
      shouldRemoveRow: false,
      shouldDisableRow: false,
      shouldCloseConfirmation: false,
      isError: true,
    };
  }

  // Retryable 502 — pending deletion
  if (res.retryable || res.code === "STORAGE_DELETE_FAILED" || res.code === "DELETE_FINALIZATION_FAILED") {
    if (!refreshSucceeded) {
      return {
        message: "Document deletion is in progress but has not completed yet. The document has been marked for pending deletion and its download/re-extract actions are disabled. It will be removed automatically when storage cleanup completes.",
        shouldReload: false,
        shouldRemoveRow: false,
        shouldDisableRow: true,
        shouldCloseConfirmation: true,
        isError: false,
      };
    }
    return {
      message: "Document deletion is in progress but has not completed yet. The document has been marked for pending deletion and its download/re-extract actions are disabled. It will be removed automatically when storage cleanup completes.",
      shouldReload: true,
      shouldRemoveRow: false,
      shouldDisableRow: false,
      shouldCloseConfirmation: true,
      isError: false,
    };
  }

  // Unknown error
  return {
    message: "We could not delete that Company Vault document. Please retry, or refresh to check whether it was already removed.",
    shouldReload: false,
    shouldRemoveRow: false,
    shouldDisableRow: false,
    shouldCloseConfirmation: false,
    isError: true,
  };
}
