"use client";

// Per-document review + comment thread panel (PR #247).
//
// Closes spec Module #16: "approve, reject, mark ready for export,
// maintain approval history, internal comments". Drops into the
// Generated Documents dashboard as a collapsible per-document panel.
//
// What it shows:
//   • Approval action buttons (Approve / Request Changes / Reject /
//     Mark Ready for Export) gated by the current user's role
//   • Full review-action audit trail (who did what, when, prior →
//     new status)
//   • Threaded comments with author, role badge, resolved state,
//     reply composer
//
// Wire-in: render inside the per-document row of
// app/dashboard/documents/page.tsx OR app/dashboard/tenders/[id]/...
// pass tenderId + docId + currentUserRole as props. Component
// fetches its own data on mount.

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon } from "./icons";

type Reviewer = {
  id: string;
  name: string | null;
  email: string;
  role: string;
};

type ReviewAction = {
  id: string;
  reviewerId: string;
  reviewer: Reviewer;
  action: string;
  notes: string | null;
  priorStatus: string;
  newStatus: string;
  createdAt: string;
};

type Comment = {
  id: string;
  documentId: string;
  authorId: string;
  author: Reviewer;
  body: string;
  parentId: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
  replies?: Comment[];
};

interface DocumentReviewPanelProps {
  tenderId: string;
  docId: string;
  docName: string;
  currentReviewStatus: string;
  // Role of the currently-logged-in user. Determines which action
  // buttons are shown. Read-only for VIEWER.
  currentUserRole: "ADMIN" | "PROPOSAL_MANAGER" | "REVIEWER" | "VIEWER" | string;
  // Called when an action mutates the document state so the parent
  // page can refresh its document list.
  onActionTaken?: () => void;
}

const REVIEW_ACTIONS: Array<{ key: string; label: string; status: string; color: string; description: string }> = [
  { key: "APPROVE", label: "Approve", status: "APPROVED", color: "bg-green-600 hover:bg-green-700", description: "Document is ready for evaluator submission" },
  { key: "READY_FOR_EXPORT", label: "Mark Ready", status: "READY_FOR_EXPORT", color: "bg-blue-600 hover:bg-blue-700", description: "Document approved for inclusion in the export ZIP" },
  { key: "REQUEST_CHANGES", label: "Request Changes", status: "CHANGES_REQUESTED", color: "bg-amber-600 hover:bg-amber-700", description: "Author needs to revise before re-review" },
  { key: "REJECT", label: "Reject", status: "REJECTED", color: "bg-red-600 hover:bg-red-700", description: "Document cannot be used as-is — regenerate" },
];

const STATUS_COLORS: Record<string, string> = {
  APPROVED: "bg-green-100 text-green-700",
  READY_FOR_EXPORT: "bg-blue-100 text-blue-700",
  CHANGES_REQUESTED: "bg-amber-100 text-amber-700",
  REJECTED: "bg-red-100 text-red-700",
  REJECTED_DUPLICATE: "bg-red-100 text-red-700",
  PENDING: "bg-slate-100 text-slate-500",
  NEEDS_REVISION: "bg-amber-100 text-amber-700",
  NEEDS_REVIEW: "bg-amber-100 text-amber-700",
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function roleBadge(role: string): string {
  if (role === "ADMIN") return "bg-purple-100 text-purple-700";
  if (role === "PROPOSAL_MANAGER") return "bg-blue-100 text-blue-700";
  if (role === "REVIEWER") return "bg-emerald-100 text-emerald-700";
  return "bg-slate-100 text-slate-600";
}

export function DocumentReviewPanel({
  tenderId,
  docId,
  docName,
  currentReviewStatus,
  currentUserRole,
  onActionTaken,
}: DocumentReviewPanelProps) {
  const [reviews, setReviews] = useState<ReviewAction[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [reviewStatus, setReviewStatus] = useState(currentReviewStatus);
  const [loading, setLoading] = useState(true);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState("");
  const [newCommentBody, setNewCommentBody] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [resolvingCommentId, setResolvingCommentId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const canReview = ["ADMIN", "PROPOSAL_MANAGER", "REVIEWER"].includes(currentUserRole);
  const canComment = canReview;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [docRes, commentsRes] = await Promise.all([
        fetch(`/api/tenders/${tenderId}/documents/${docId}`, { method: "GET" }),
        fetch(`/api/tenders/${tenderId}/documents/${docId}/comments`),
      ]);
      if (!docRes.ok) throw new Error(`Failed to load review history (${docRes.status})`);
      if (!commentsRes.ok) throw new Error(`Failed to load comments (${commentsRes.status})`);
      const docData = await docRes.json();
      const commentsData = await commentsRes.json();
      setReviews(docData.reviews ?? []);
      setReviewStatus(docData.document?.reviewStatus ?? currentReviewStatus);
      setComments(commentsData.comments ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load review data");
    } finally {
      setLoading(false);
    }
    router.refresh();
  }, [tenderId, docId, currentReviewStatus, router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function takeAction(action: typeof REVIEW_ACTIONS[number]) {
    setActionInFlight(action.key);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/documents/${docId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewStatus: action.status,
          reviewAction: action.key,
          reviewNotes: actionNote.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(errBody.error ?? `Action failed (${res.status})`);
      }
      setActionNote("");
      await refresh();
      onActionTaken?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionInFlight(null);
    }
  }

  async function postComment(parentId: string | null, body: string) {
    if (body.trim().length === 0) return;
    setError(null);
    setPostingComment(true);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/documents/${docId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, parentId }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(errBody.error ?? `Comment failed (${res.status})`);
      }
      if (parentId) {
        setReplyingTo(null);
        setReplyBody("");
      } else {
        setNewCommentBody("");
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comment failed");
    } finally {
      setPostingComment(false);
    }
  }

  async function toggleResolve(commentId: string, currentlyResolved: boolean) {
    setResolvingCommentId(commentId);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/documents/${docId}/comments?commentId=${commentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved: !currentlyResolved }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(errBody.error ?? `Resolve failed (${res.status})`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resolve failed");
    } finally {
      setResolvingCommentId(null);
    }
  }

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-900">Review &amp; Comments — {docName}</h3>
          <p className="mt-0.5 text-xs text-slate-500">Per-document approval audit trail and internal comment thread</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[reviewStatus] ?? "bg-slate-100 text-slate-600"}`}>
          {reviewStatus.replace(/_/g, " ")}
        </span>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>
      )}

      {/* Review action panel — only visible to roles that can review */}
      {canReview && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold text-slate-700">Take an action</p>
          <textarea
            placeholder="Optional reviewer note (visible in audit trail)…"
            value={actionNote}
            onChange={(e) => setActionNote(e.target.value)}
            rows={2}
            className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
            maxLength={1000}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {REVIEW_ACTIONS.map((a) => (
              <button
                key={a.key}
                type="button"
                disabled={actionInFlight !== null}
                onClick={() => takeAction(a)}
                title={a.description}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-60 ${a.color}`}
              >
                {actionInFlight === a.key ? "…" : a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Review action audit trail */}
      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Approval audit trail</p>
        {loading ? (
          <p className="mt-2 text-xs text-slate-400">Loading…</p>
        ) : reviews.length === 0 ? (
          <p className="mt-2 text-xs text-slate-400">No review actions yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {reviews.map((r) => (
              <li key={r.id} className="rounded-lg border border-slate-100 bg-white p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{r.reviewer.name ?? r.reviewer.email}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${roleBadge(r.reviewer.role)}`}>
                      {r.reviewer.role}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400">{formatDate(r.createdAt)}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-slate-700">
                  <span className="font-medium">{r.action}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-500">{r.priorStatus.replace(/_/g, " ")}</span>
                  <span className="text-slate-400"><ArrowRightIcon /></span>
                  <span className="text-slate-700 font-medium">{r.newStatus.replace(/_/g, " ")}</span>
                </div>
                {r.notes && <p className="mt-1.5 italic text-slate-600">&ldquo;{r.notes}&rdquo;</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Comment thread */}
      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Internal comments ({comments.length})</p>

        {canComment && (
          <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <textarea
              placeholder="Write an internal comment…"
              value={newCommentBody}
              onChange={(e) => setNewCommentBody(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
              maxLength={5000}
            />
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                disabled={newCommentBody.trim().length === 0 || postingComment}
                onClick={() => void postComment(null, newCommentBody)}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
              >
                {postingComment ? "Posting…" : "Post comment"}
              </button>
            </div>
          </div>
        )}

        {comments.length === 0 ? (
          <p className="mt-3 text-xs text-slate-400">No comments yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {comments.map((c) => (
              <li key={c.id} className="rounded-lg border border-slate-100 bg-white p-3">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{c.author.name ?? c.author.email}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${roleBadge(c.author.role)}`}>
                      {c.author.role}
                    </span>
                    {c.resolvedAt && (
                      <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                        Resolved
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-400">{formatDate(c.createdAt)}</span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700">{c.body}</p>

                {c.replies && c.replies.length > 0 && (
                  <ul className="mt-3 space-y-2 border-l-2 border-slate-100 pl-3">
                    {c.replies.map((r) => (
                      <li key={r.id} className="text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-900">{r.author.name ?? r.author.email}</span>
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${roleBadge(r.author.role)}`}>
                              {r.author.role}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-400">{formatDate(r.createdAt)}</span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-slate-700">{r.body}</p>
                      </li>
                    ))}
                  </ul>
                )}

                {canComment && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setReplyingTo(replyingTo === c.id ? null : c.id);
                        setReplyBody("");
                      }}
                      className="text-[11px] font-medium text-slate-600 hover:text-slate-900"
                    >
                      {replyingTo === c.id ? "Cancel reply" : "Reply"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleResolve(c.id, Boolean(c.resolvedAt))}
                      disabled={resolvingCommentId === c.id}
                      className="text-[11px] font-medium text-slate-600 hover:text-slate-900 disabled:opacity-60"
                    >
                      {resolvingCommentId === c.id ? "Saving…" : c.resolvedAt ? "Reopen thread" : "Mark resolved"}
                    </button>
                  </div>
                )}

                {replyingTo === c.id && (
                  <div className="mt-2">
                    <textarea
                      placeholder="Reply…"
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      rows={2}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-slate-300"
                      maxLength={5000}
                    />
                    <div className="mt-1 flex justify-end">
                      <button
                        type="button"
                        disabled={replyBody.trim().length === 0 || postingComment}
                        onClick={() => void postComment(c.id, replyBody)}
                        className="rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
                      >
                        {postingComment ? "Posting…" : "Post reply"}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
