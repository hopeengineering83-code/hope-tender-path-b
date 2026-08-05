# Owner Automation Contract

This file records the current owner-directed normal workflow and supersedes older documentation that describes AI Analyze or Run Engine as mandatory manual gates.

## Normal workflow

The owner provides only:

1. Company Vault documents and Brand Assets once.
2. Tender source files for each tender.

After verified source persistence, the server-owned durable queue must continue automatically through:

`EXTRACT_TEXT → AI_ANALYZE → ENGINE_RUN → PROPOSAL_GENERATION → AUTO_FINALIZE → validated DOCX/PDF/ZIP readiness`

The browser may show progress and diagnostics, but it must not own orchestration and may be closed after upload without stopping durable continuation.

## Permitted interruptions

Automatic continuation may stop only when fail-closed review is materially required, including:

- unreadable, incomplete, weak, or integrity-failed source bytes;
- conflicting source facts;
- unsupported company claims or missing evidence;
- legal authority, signature, declaration, or approval decisions that cannot be inferred safely;
- final owner approval before submission or Production promotion;
- exhausted or invalid external provider credentials after bounded automatic retry.

Recovery controls may remain available inside Diagnostics and Recovery, but AI Analyze and Run Engine are not mandatory normal-path buttons.

## Safety invariants

Automation must not weaken tenant isolation, source provenance, evidence gates, provider order, analysis promotion, generation eligibility, validation, final ZIP integrity, or owner-controlled release authorization.
