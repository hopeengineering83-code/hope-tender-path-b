# Learnings: Comprehensive Audit and Perfection Strategy

## Repository Structure & Patterns
- **Mega-module Anti-pattern**: `lib/engine` is a massive directory with 160+ files, acting as the core of the tender processing logic. It requires structural refactoring into logical domains (Extraction, Generation, Matching, Quality, Submission).
- **Security Hardening**: The app uses a layered security approach:
    - **RBAC**: Server-side role checks (`requireRole`) combined with session-based `userId` scoping.
    - **Data Minimization**: Strict Prisma `select` clauses prevent accidental leakage of large file/text blobs.
    - **CSRF**: Global middleware enforcement for all mutating API calls.
    - **Input Sanitization**: Combined regex patterns for high-performance stripping of AI traces and internal markers.
- **Workflow Integrity**: The app uses a "blocking chain" where poor extraction quality or unapproved AI analysis strictly halts downstream actions like document generation and ZIP export.

## Process Improvements
- **Structural Proposals**: When dealing with large legacy modules, documenting a `REFACTORING_PROPOSAL.md` or `AUDIT.md` is more effective than attempting a massive, risky refactor in a single PR.
- **Dependency Management**: Standard `npm audit fix` and `npm audit fix --force` are the first line of defense, followed by manual version pinning for critical frameworks like Next.js.
- **Verification Loop**: Running the full test suite (3000+ tests) is essential after upgrading core dependencies like `next` to ensure no regressions in App Router behavior or edge-case handling.

## Code Quality Markers
- **Placeholders as Blockers**: The system treats strings like `TODO`, `FIXME`, and `Bid-Team to confirm` as critical blockers rather than just comments. This ensures high-quality final outputs.
- **Traceability**: Source provenance (page numbers, exact quotes) is the "gold standard" for extraction quality and is used as a hard gate for export readiness.
