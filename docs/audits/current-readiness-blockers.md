# Current Readiness Blockers

## Scope

This note records the remaining release-readiness boundaries for the consolidated recovery branch. It distinguishes Company Vault runtime authority from engineering release governance.

## Company Vault runtime authority

Company Vault evidence does **not** require a human approval step before Run Engine.

The runtime contract is:

1. Run Engine remaps missing Company Vault source links before matching.
2. The system verifies each record's current exact values against an owned source document whose persisted bytes pass integrity checks.
3. Successful records are promoted to `SOURCE_VERIFIED` automatically.
4. Current `SOURCE_VERIFIED` evidence and current authenticated `REVIEWED` evidence are equally eligible for matching, generation, export, and Final ZIP.
5. Draft, source-less, stale, altered, expired, or unmatched records remain fail-closed.
6. Automatic verification never invents `REVIEWED`, a reviewer identity, or a human-review timestamp.

Human review remains available only as an optional authenticated audit trail or correction workflow. It is not bureaucracy between Company Vault and Run Engine.

## Tender-specific gates that remain mandatory

Removing the Company Vault human-approval dependency does not remove tender truth or package-integrity controls. The following remain enforced:

- tender-file extraction quality and OCR completeness;
- tender analysis and mandatory-requirement extraction;
- Build Plan confirmation;
- exact tender metadata and deadline truth;
- requirement-to-evidence coverage;
- technical/financial separation;
- document validation and approval state;
- required signature and stamp placement;
- generated-file byte integrity;
- Final ZIP manifest and package validation.

## Engineering release governance

Pull-request review, CI, migration verification, authenticated isolation testing, and deployment authorization are engineering governance controls. They are separate from Company Vault record authority and must not be described as a Company Vault human-approval prerequisite.

## Current release condition

A recovery change is ready for incorporation only when its exact head passes the repository's required migration, integrity, typecheck, lint, test, build, and authenticated-isolation workflow. No PR should be merged merely because Company Vault records are promoted automatically.
