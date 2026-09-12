## Controlled end-to-end repair

Base: PR #1175 release branch.

This draft consolidates safe workflow improvements from PR #1245 while rejecting unsafe PR #1244 source-authority and independent-job assumptions.

Completed:
- browser no longer POSTs duplicate AI Analyze jobs;
- Company Vault repair uses /api/company/reimport;
- Action Center no longer owns gated mutations;
- partial/fallback analysis remains blocked;
- regression tests added.

Remaining blocker:
- explicit server-side AI Analyze success dependency before Engine execution;
- full exact-head CI, PostgreSQL, authenticated owner, cross-user, and screenshot validation.

Do not merge, approve, deploy, or retarget.
