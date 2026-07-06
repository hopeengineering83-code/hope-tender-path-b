# Metadata Authority Completion Baseline Audit

## Revision 1: Current Code Truth
| Area | Current behavior | Reproduction evidence | Risk | Required repair | Owner/PR conflict | May modify? | Test proof |
|---|---|---|---|---|---|---|---|
| Reference Number | Requires digit (e.g. `\d`) | "RFP/CONSULTANCY" rejected | Blocks valid letter-only refs | Relax regex to allow alpha-only | None | Yes | `tests/metadata-authority.test.ts` |
| Submission Method | "Email" flagged as generic label | "Email" rejected | Blocks valid email submissions | Normalize to controlled enum | None | Yes | `tests/metadata-authority.test.ts` |
| Effective Facts | Overrides stored but not merged into BuildPlan hash | Manual ref not in DOCX | Stale documents generated | Implement `resolveEffectiveTenderFacts` | None | Yes | `tests/metadata-authority.test.ts` |
| Final Gates | Implicit validation mode | Draft blocked by missing optional fields | Deadlocks | Explicit "draft" vs "final" mode | None | Yes | `tests/metadata-authority.test.ts` |

## Revision 2: Real Tender-Behavior Review
- **Letter-only Ref:** "AA/PROC/ARCH" correctly identified as Source-Grounded.
- **Submission Method:** "Email" normalized to `EMAIL`, "Portal" to `PORTAL`.
- **Deadlines:** "25 August 2026" parsed correctly. "05/06/2026" flagged as `CANDIDATE_NEEDS_REVIEW`.
- **80-Page PDF:** Extraction logic correctly iterates chunks; metadata from page 75 is captured.

## Revision 3: Red-Team Release Review
- **Tenant Isolation:** Verified.
- **Role Permissions:** REVIEWER/VIEWER blocked from `metadata-override` route (403).
- **Stale BuildPlan:** Changing manual reference invalidates draft plan hash.
- **Quarantine:** PR #957 ignored. PR #937 frozen.
