# AI job idempotency repair

This branch restores the strict eight-way PostgreSQL concurrency proof and the safe parameterized advisory-lock implementation with `analysisInputHash` persisted on job creation.

It intentionally rejects the weakened `at most 8 jobs` assertion and does not use `$executeRawUnsafe`.
