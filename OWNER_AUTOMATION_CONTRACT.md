# Owner Automation Contract

This file records the current owner-directed normal workflow.

## Normal workflow

The owner provides only:

1. Company Vault documents and Brand Assets once.
2. Tender source files for each tender.

After verified source persistence, the workflow proceeds as follows:

### Automatic stages (no user action required)

- **Tender upload and extraction** — automatic. After upload, the EXTRACT_TEXT durable worker extracts text from the tender source files. The browser may nudge the EXTRACT_TEXT worker for responsiveness, but the scheduled worker remains the authoritative fallback.

### Manual stages (require authorized user click)

- **AI Analyze** — MANUAL. After extraction completes, the user must click "Run AI Analyze" (`POST /api/tenders/:id/manual-ai-analyze`). This action is durable, idempotent, tenant-safe, double-click-safe, and truthful after reload. The browser NEVER triggers AI Analyze automatically — not through upload handlers, workers, cron, browser continuation, or recovery logic.
- **Run Engine** — MANUAL. After successful current-revision AI Analyze, the user must click "Run Engine" (`POST /api/tenders/:id/engine`). This action is durable, idempotent, tenant-safe, double-click-safe, and truthful after reload. The browser NEVER triggers Run Engine automatically.

### Automatic stages after Run Engine (no user action required)

After successful Run Engine, the following stages continue automatically through durable workers with no additional routine approvals or buttons:

- **Matching** — automatic.
- **Generation** — automatic.
- **Validation** — automatic.
- **Document assembly** — automatic.
- **Finalization** — automatic.
- **Word (DOCX) export** — automatic.
- **PDF export** — automatic.
- **ZIP export** — automatic.

## What the browser must NEVER do

- Trigger AI Analyze automatically through upload handlers.
- Trigger AI Analyze automatically through workers.
- Trigger AI Analyze automatically through cron.
- Trigger AI Analyze automatically through browser continuation.
- Trigger AI Analyze automatically through recovery logic.
- Trigger Run Engine automatically through any of the above mechanisms.

## Permitted interruptions

Automatic continuation after Run Engine may stop only when fail-closed review is materially required, including:

- unreadable, incomplete, weak, or integrity-failed source bytes;
- conflicting source facts;
- unsupported company claims or missing evidence;
- legal authority, signature, declaration, or approval decisions that cannot be inferred safely;
- final owner approval before submission or Production promotion;
- exhausted or invalid external provider credentials after bounded automatic retry.

## Safety invariants

Automation must not weaken tenant isolation, source provenance, evidence gates, provider order, analysis promotion, generation eligibility, validation, final ZIP integrity, or owner-controlled release authorization.
