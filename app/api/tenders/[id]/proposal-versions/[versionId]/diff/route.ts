// GET /api/tenders/[id]/proposal-versions/[versionId]/diff?compare_to=[otherVersionId]
//
// Returns a line-level diff between two proposal versions so the UI can
// render a "what changed" comparison without the user having to eyeball
// two raw markdown previews.
//
// Response shape:
//   { added: number; removed: number; hunks: Array<{ type: "add"|"remove"|"context"; lines: string[] }> }

import { NextResponse } from "next/server";
import { getSession } from "../../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../../lib/prisma";

export const dynamic = "force-dynamic";

type DiffHunk = { type: "add" | "remove" | "context"; lines: string[] };

function computeDiff(baseText: string, newText: string): { added: number; removed: number; hunks: DiffHunk[] } {
  const baseLines = baseText.split("\n");
  const newLines = newText.split("\n");

  // Simple LCS-based diff: produce a minimal edit script then group into hunks.
  // For proposals (500–3000 lines) this runs in well under 100ms.
  const m = baseLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (baseLines[i] === newLines[j]) dp[i][j] = 1 + dp[i + 1][j + 1];
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Traceback
  const ops: Array<{ type: "add" | "remove" | "equal"; line: string }> = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && baseLines[i] === newLines[j]) {
      ops.push({ type: "equal", line: baseLines[i] });
      i++; j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      ops.push({ type: "add", line: newLines[j] });
      j++;
    } else {
      ops.push({ type: "remove", line: baseLines[i] });
      i++;
    }
  }

  // Group into hunks with 3-line context around changes
  const CONTEXT = 3;
  const changeIndices = ops.reduce<number[]>((acc, op, idx) => { if (op.type !== "equal") acc.push(idx); return acc; }, []);
  if (changeIndices.length === 0) return { added: 0, removed: 0, hunks: [] };

  const hunks: DiffHunk[] = [];
  let added = 0, removed = 0;

  let pos = 0;
  while (pos < changeIndices.length) {
    const start = Math.max(0, changeIndices[pos] - CONTEXT);
    let end = changeIndices[pos] + CONTEXT + 1;
    // Merge adjacent change windows
    while (pos + 1 < changeIndices.length && changeIndices[pos + 1] <= end + CONTEXT) {
      pos++;
      end = changeIndices[pos] + CONTEXT + 1;
    }
    end = Math.min(ops.length, end);

    const hunkOps = ops.slice(start, end);
    // Split into sub-hunks by type
    let cur: DiffHunk | null = null;
    for (const op of hunkOps) {
      const t: "add" | "remove" | "context" = op.type === "equal" ? "context" : op.type;
      if (!cur || cur.type !== t) {
        if (cur) hunks.push(cur);
        cur = { type: t, lines: [] };
      }
      cur.lines.push(op.line);
      if (op.type === "add") added++;
      if (op.type === "remove") removed++;
    }
    if (cur) hunks.push(cur);
    pos++;
  }

  return { added, removed, hunks };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id, versionId } = await params;
  const compareToId = new URL(req.url).searchParams.get("compare_to");
  if (!compareToId) return NextResponse.json({ error: "compare_to query parameter is required" }, { status: 400 });

  const tender = await prisma.tender.findFirst({ where: { id, userId }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const pv = (prisma as any).proposalVersion;
  const [base, next] = await Promise.all([
    pv.findFirst({ where: { id: versionId, tenderId: id }, select: { id: true, version: true, markdown: true } }) as Promise<{ id: string; version: number; markdown: string | null } | null>,
    pv.findFirst({ where: { id: compareToId, tenderId: id }, select: { id: true, version: true, markdown: true } }) as Promise<{ id: string; version: number; markdown: string | null } | null>,
  ]);
  if (!base) return NextResponse.json({ error: "Base version not found" }, { status: 404 });
  if (!next) return NextResponse.json({ error: "compare_to version not found" }, { status: 404 });

  const diff = computeDiff(base.markdown ?? "", next.markdown ?? "");

  return NextResponse.json({
    baseVersion: base.version,
    compareVersion: next.version,
    ...diff,
  });
}
