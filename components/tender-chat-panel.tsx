"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clientLogger } from "@/lib/ui/client-logger";

// ─── Types ────────────────────────────────────────────────────────────────────

type Citation = {
  page: number | null;
  quote: string | null;
  field: string | null;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[] | null;
  createdAt: string;
};

// Optimistic message shown immediately before the server responds.
type OptimisticMessage = Omit<ChatMessage, "id" | "createdAt"> & {
  id: `optimistic-${string}`;
  createdAt: string;
};

type AnyMessage = ChatMessage | OptimisticMessage;

// ─── Component ────────────────────────────────────────────────────────────────

export function TenderChatPanel({ tenderId, canMutate = false }: { tenderId: string; canMutate?: boolean }) {
  const [messages, setMessages] = useState<AnyMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Load history on mount ─────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/copilot/messages`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Failed to load history (${res.status})`);
      }
      const data = await res.json() as { messages: ChatMessage[] };
      setMessages(data.messages ?? []);
    } catch (err) {
      // Non-fatal: the workbench still works, history is just empty.
      clientLogger.warn("[TenderChatPanel] Could not load history:", err instanceof Error ? { message: err.message } : { error: String(err) });
    } finally {
      setLoadingHistory(false);
    }
  }, [tenderId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // ── Auto-scroll to bottom ─────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Auto-resize textarea ──────────────────────────────────────────────────
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  // ── Send message ─────────────────────────────────────────────────────────
  async function sendMessage() {
    const trimmed = input.trim();
    if (trimmed.length < 3 || loading) return;

    setError(null);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    // Optimistic user message
    const optimisticId = `optimistic-${Date.now()}` as const;
    const optimisticUser: OptimisticMessage = {
      id: optimisticId,
      role: "user",
      content: trimmed,
      citations: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);
    setLoading(true);

    try {
      const res = await fetch(`/api/tenders/${tenderId}/copilot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = await res.json().catch(() => ({}) as Record<string, unknown>) as {
        error?: string;
        response?: {
          answer: string;
          evidenceUsed?: Array<{ id: string; snippet?: string; page?: number }>;
        };
      };
      if (!res.ok) throw new Error(data.error ?? `Copilot failed (${res.status})`);

      const aiResponse = data.response;
      if (!aiResponse) throw new Error("No response from copilot");

      // Build citations from evidenceUsed if present
      const citations: Citation[] | null =
        Array.isArray(aiResponse.evidenceUsed) && aiResponse.evidenceUsed.length > 0
          ? aiResponse.evidenceUsed.map((ev) => ({
              page: ev.page ?? null,
              quote: ev.snippet ?? null,
              field: ev.id,
            }))
          : null;

      const assistantMsg: OptimisticMessage = {
        id: `optimistic-${Date.now()}-assistant` as const,
        role: "assistant",
        content: aiResponse.answer,
        citations,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copilot failed");
      // Remove the optimistic user message on failure
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  // ── Clear history ─────────────────────────────────────────────────────────
  async function clearHistory() {
    if (!confirm("Clear all chat history for this tender?")) return;
    setClearing(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/copilot/messages`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Delete failed (${res.status})`);
      }
      setMessages([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear history");
    } finally {
      setClearing(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const canSend = input.trim().length >= 3 && !loading;

  return (
    <div className="flex flex-col rounded-2xl border bg-white shadow-sm" style={{ height: "600px" }}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Tender Assistant</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Persistent chat — ask strategic questions about this tender.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void clearHistory()}
          disabled={clearing || messages.length === 0}
          className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] text-slate-500 hover:bg-slate-50 disabled:opacity-60"
        >
          {clearing ? "Clearing…" : "Clear history"}
        </button>
      </div>

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {loadingHistory && (
          <p className="text-center text-xs text-slate-400 pt-4">Loading history…</p>
        )}
        {!loadingHistory && messages.length === 0 && (
          <p className="text-center text-xs text-slate-400 pt-8">
            No messages yet. Ask a question below.
          </p>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {loading && (
          <div className="flex items-start gap-2">
            <div className="max-w-[80%] rounded-2xl rounded-tl-sm border border-slate-100 bg-slate-50 px-3 py-2">
              <span className="flex gap-1 items-center text-xs text-slate-400">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-pulse" aria-hidden="true" />
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-pulse delay-100" aria-hidden="true" />
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-pulse delay-200" aria-hidden="true" />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Input bar */}
      <div className="border-t px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={canMutate ? "Ask a question… (Enter to send, Shift+Enter for newline)" : "Read-only — chat requires ADMIN or PROPOSAL_MANAGER role"}
            rows={1}
            disabled={loading || !canMutate}
            className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:opacity-60"
            style={{ maxHeight: "120px", overflowY: "auto" }}
          />
          {canMutate && (
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={!canSend}
            className="shrink-0 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {loading ? "…" : "Send"}
          </button>
          )}
        </div>
        <p className="mt-1.5 text-[10px] text-slate-400">
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  );
}

// ─── MessageBubble ─────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: AnyMessage }) {
  const isUser = message.role === "user";
  const citations = message.citations;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
          isUser
            ? "rounded-tr-sm bg-blue-600 text-white"
            : "rounded-tl-sm border border-slate-100 bg-white text-slate-800"
        }`}
      >
        <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>

        {/* Citations */}
        {!isUser && citations && citations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {citations.map((citation, i) => (
              <CitationPill key={i} citation={citation} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CitationPill ─────────────────────────────────────────────────────────────

function CitationPill({ citation }: { citation: Citation }) {
  const label = citation.page != null ? `p.${citation.page}` : (citation.field ?? "ref");
  const title = [
    citation.page != null ? `Page ${citation.page}` : null,
    citation.quote ? `"${citation.quote.slice(0, 120)}"` : null,
  ]
    .filter(Boolean)
    .join(" — ");

  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500"
    >
      {label}
    </span>
  );
}
