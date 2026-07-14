# Hope Tender Engine — User Guide

**Branch:** `fix/exhaustive-current-gap-cleanup`
**Addresses audit gap:** GAP-DOC-01
**Status:** Stub — section placeholders for future expansion

## Purpose

End-user documentation for proposal managers, reviewers, and admins using
the Hope Tender Engine. This is a stub; each section below will be expanded
into a standalone document in a follow-up PR.

## Audience

| Role | What they do | Sections to read |
|---|---|---|
| **Proposal Manager** | Creates tenders, runs AI Analyze, generates proposals, exports ZIPs | 1, 2, 3, 4, 5 |
| **Reviewer** | Reviews generated documents, adds comments, approves / rejects | 6 |
| **Admin** | Manages users, brand assets, company profile, system health | 7, 8 |

## Sections (stubs)

### 1. Quick Start for Proposal Managers (5 min)

*TODO: expand into standalone doc.*

- First login
- Password change
- Company setup wizard
- First tender creation

### 2. Tender Intake Walkthrough

*TODO: expand into standalone doc.*

- Upload tender document (PDF / DOCX / XLSX)
- Multi-file tenders
- File classification
- Extraction Quality panel interpretation
- Re-extraction when extraction is weak

### 3. AI Analyze Troubleshooting

*TODO: expand into standalone doc.*

- When to run AI Analyze
- Provider chain behavior
- Reading the Analysis Quality panel
- Handling partial / failed / fallback analysis
- Manual metadata repair

### 4. Build Plan + Generate Docs Workflow

*TODO: expand into standalone doc.*

- Building the submission plan
- Confirming the build plan
- Generating documents (parallel mode, deep mode)
- Regenerating individual sections
- Reading the Generation Gates panel

### 5. Review + Approval Workflow

*TODO: expand into standalone doc.*

- Document validator output
- Multi-reviewer workflow
- Comments and threaded discussion
- Approval / rejection
- Audit trail

### 6. Export + Submit Checklist

*TODO: expand into standalone doc.*

- Export readiness gate
- Final ZIP integrity
- Exact file naming and order
- Two-envelope rules (technical / financial)
- Download and verify

### 7. Admin Guide

*TODO: expand into standalone doc.*

- User management (create, role change, deactivate)
- Brand assets (letterhead, logo, signature, stamp)
- Company profile fields
- App settings (default currency, branding toggles, language)
- System health dashboard
- Audit log query

## How to contribute

This user guide is maintained in the repository at `docs/user-guide/`. To
expand a section:

1. Create a new file: `docs/user-guide/NN-short-title.md` (NN = section number).
2. Update this README's section entry to link to the new file.
3. Submit a PR with the expanded content.

## See also

- [QUICKSTART.md](../../QUICKSTART.md) — 5-minute developer quickstart
- [README.md](../../README.md) — full technical reference
- [docs/runbooks/](../runbooks/) — incident response
- [docs/adr/](../adr/) — architecture decisions
