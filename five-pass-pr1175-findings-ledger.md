# PR #1175 findings ledger

Status values are `OPEN`, `FIXED_LOCAL`, `VERIFIED_LOCAL`, `DEFERRED`, and
`CLOSED_AS_STALE`. Only evidence produced on this audit branch can move a row to
`VERIFIED_LOCAL`; CI/preview acceptance will be recorded separately.

| ID | Pass | Severity | Status | Finding and current-head evidence | Minimum safe remediation | Proof |
|---|---:|---|---|---|---|---|
| F001 | 3 | Critical | OPEN | Tender upload request paths call `extractTextFromBuffer` synchronously and directly queue analysis. The registered `enqueueTenderFileExtractionJob` has no production caller. | Persist verified bytes/source rows, enqueue one deterministic `EXTRACT_TEXT` job per file, and let the worker continue analysis after every active file has a durable extraction result. | Failing/behavioral upload-to-job tests plus queue replay and package-completion tests required. |
| F002 | 2 | High | OPEN | Prior audit reported Review Inbox excludes legal, financial, and compliance record families. Current-head behavioral recheck pending. | Include all authority-bearing record families or explicitly route them to one canonical review surface. | Route/query and UI tests required. |
| F003 | 2 | High | OPEN | Prior audit reported ineffective concurrency guards on legal/financial/compliance review routes. Current-head behavioral recheck pending. | Use expected version/timestamp in the mutation predicate and return a conflict on stale writes. | Two-writer integration tests required. |
| F004 | 4 | Critical | OPEN | Prior audit reported incomplete ZIP manifest plus duplicate ZIP ownership. Current-head behavioral recheck pending. | One Final ZIP assembler; manifest enumerates every exported byte with plan/envelope identity and hash. | Byte-level ZIP/manifest tests required. |
| F005 | 5 | High | OPEN | Existing runtime evidence is mostly synthetic or screenshot based. | Run exact-audit-head preview probes with sanitized test data and retain logs/artifacts. | Exact SHA CI, Vercel deployment, runtime logs, and sanitized artifacts required. |
| F006 | 5 | Medium | OPEN | Prior audit reported migration-owning test races. Current-head recheck pending. | Serialize database schema owners or allocate isolated schemas/databases. | Repeated supported-runtime CI run required. |
| F007 | 5 | Medium | OPEN | Prior audit reported source-string release gates. | Replace string-presence assertions with executable behavior at the real authority boundary. | Mutation/route behavior tests required. |
| F008 | 5 | Medium | OPEN | Existing CI evidence artifact does not establish all requested logs and proof outputs. | Publish command, runtime, migration, test, and preview evidence tied to exact audit SHA. | Artifact inspection required. |
| F009 | 5 | High | OPEN | Screenshot counters and authority panels contradict one another: reviewed evidence exists but matching/generation says none; covered rows coexist with zero selected evidence; confirmed plan coexists with “no current confirmed plan.” | Derive every panel from shared canonical selectors and expose one next action per lifecycle state. | Cross-panel selector and browser tests required. |
| F010 | 1 | Low | CLOSED_AS_STALE | Donor audit branch was behind its then-governing base. This audit branch was created from the current frozen PR #1175 head. | None beyond head recheck discipline. | Local/remote SHA both `ec0eaa83...` at audit start. |
| F011 | 2 | Critical | VERIFIED_LOCAL | Commits `1010133b`, `79fb98f7`, and `94362027` promoted machine-ingested records to `REVIEWED` with fabricated reviewer `SYSTEM_AUTO_VERIFIED`. | Canonical automatic transition now emits `SOURCE_VERIFIED`, null human-review identity/timestamp, durable source provenance, and truthful audit actions. Legacy fabricated rows are repaired. | Before-fix 4/4 contract failures; after-fix typecheck and focused/transitive suite passing. Behavioral test proves source verified is not durably reviewed. |
| F012 | 2/4 | Critical | VERIFIED_LOCAL | Commit `0b4cc1ad` automatically inserted uploaded signature/stamp images during generation and auto-finalize, with no approval gate and no tests. | Removed calls from both canonical paths and deleted the competing mutator. Assets are not legal authorization. | Before-fix 2/2 gate failures; after-fix 2/2 passing; repository search finds no production automatic signature/stamp mutator call. |
| F013 | 3 | High | OPEN | `lib/ai-job-handlers-legacy.ts` retains another `EXTRACT_TEXT` implementation even though the registered handler delegates to `tender-extraction-service.ts`. | Remove or convert the legacy implementation after every caller and test uses the canonical service. | Handler-registration and dead-code reachability proof required. |
| F014 | 3 | High | OPEN | Company-document upload persists request-time extraction and queues `VAULT_INGEST` without guaranteeing background re-extraction. | Give company evidence a durable, retryable extraction owner; ingestion must wait for successful extraction and content-hash provenance. | Upload/worker/ingestion integration tests required. |
| F015 | 5 | Critical | OPEN | Preview showed `LegalRecord.trustLevel` missing from the deployed database while code queried it, causing background engine failure. | Prove migration inventory and deployment order; make schema readiness fail closed before job execution. | Fresh-schema migration test plus exact-preview query/log proof required. |
| F016 | 5 | High | OPEN | Bid strategy endpoint returned HTTP 500 in the supplied preview. | Reproduce from sanitized data, fix the server root cause, and return a safe structured error for operational failures. | Route test and exact-preview log/probe required. |
| F017 | 4/5 | High | OPEN | Mandatory requirements manually displayed as FULL/Covered are labeled UNKNOWN elsewhere. | One canonical coverage status with source provenance and human-confirmation semantics shared across panels and gates. | Selector/route/browser consistency tests required. |
| F018 | 4/5 | High | OPEN | Required-document/Build Plan/PDF state is inconsistent across generation, authority review, and reconciliation panels. | One current confirmed Build Plan selector and one document reconciliation model used by generation, review, and export. | Cross-route reconciliation tests required. |
| F019 | 5 | Medium | OPEN | The UI repeats competing blocker cards and duplicate actions, obscuring the single next required action. | Canonical lifecycle state should publish one primary next action; diagnostics remain secondary and non-competing. | Component and browser workflow tests required. |

## Locally verified command

With placeholder secrets suitable only for local tests:

```text
npx tsc --noEmit
node --import tsx --test \
  tests/company-knowledge-auto-review-negative.test.ts \
  tests/company-vault-engine-auto-repair.test.ts \
  tests/matching-eligibility-source-verified.test.ts \
  tests/signature-stamp-human-approval-gate.test.ts \
  tests/auto-finalize-safety.test.ts \
  tests/pdf-finalization-safety.test.ts \
  tests/export-format-policy.test.ts
```

Result: TypeScript clean; **126 tests passed, 0 failed** across 24 suites.

Database integration was not claimed: the workspace has no local PostgreSQL
service, and `company-vault-source-remap.test.ts` correctly refuses to run
without `RUN_DB_INTEGRATION=true`.
