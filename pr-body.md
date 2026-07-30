## fix: automatic Company Vault verification before Run Engine

### Scope

Remove the manual approval bureaucracy between Company Vault and Run Engine without treating unsupported records as verified.

### Runtime authority

- Run Engine remaps missing Company Vault source links before both foreground execution and background enqueue.
- The background worker repeats the same preflight when the queued Engine job actually starts.
- Current exact claims proven against an owned, byte-integrity-verified source are promoted to `SOURCE_VERIFIED` automatically.
- Current `SOURCE_VERIFIED` evidence and current authenticated `REVIEWED` evidence are equally eligible for matching, generation, export, and Final ZIP.
- Draft, source-less, stale, altered, expired, or unmatched evidence remains fail-closed.
- Automatic verification never fabricates `REVIEWED`, a reviewer identity, or human-review timestamps.

### Product workflow

- The active Company Vault authority screen is **Automatic Verification**, not a mandatory Review Board.
- Legacy Review Board bookmarks redirect to Automatic Verification.
- The repair action reimports stored source bytes, re-runs extraction/OCR, rebuilds records, remaps source links, and promotes only evidence that verifies successfully.
- Human review remains available only as an optional authenticated audit trail or correction workflow.

### Engine and export behavior

- Company Vault verification completes before synchronous matching.
- Company Vault verification completes before asynchronous enqueue and repeats at worker execution time.
- The duplicate human-only Vault export gate is removed.
- Tender extraction, requirements, Build Plan, metadata, evidence coverage, document validation, technical/financial separation, signature/stamp, byte integrity, and Final ZIP controls remain enforced.

### Evidence matching result

Matching shows the tender requirement, eligible source evidence, reason, confidence, and unresolved evidence gaps. It does not require a human approval click when the record is already durably source-verified, and it does not invent company experience, experts, qualifications, or project facts.

### Verification

The regression suite covers:

1. automatic source-verified promotion without fabricated human review;
2. rejection of unsupported `AI_DRAFT` and `REGEX_DRAFT` records;
3. fail-closed behavior after source bytes, extraction revision, or current claimed values change;
4. foreground and queued Engine preflight ordering;
5. removal of the duplicate human-only release gate;
6. Automatic Verification UI and compatibility redirects;
7. source-byte reimport repair;
8. proposal drafting from only current durable evidence.

### Status

The pull request remains draft and unmerged until the exact head passes migrations, integrity verification, typecheck, lint, tests, build, and authenticated isolation checks.
