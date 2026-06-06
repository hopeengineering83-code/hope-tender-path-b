# Bolt's Journal - Critical Performance Learnings

## 2026-06-06 - Initial Mission
**Learning:** Initializing the performance journal.
**Action:** Always start by profiling and identifying measurable bottlenecks.

## 2025-05-22 - Regex Consolidation for Sanitization
**Learning:** Multiple sequential `.replace()` calls with individual Regexes on large strings can be a significant bottleneck. Consolidating into a single or few combined Regexes using unions (`|`) significantly improves throughput. Combined regexes reduced sanitization time by ~50% in this application.
**Action:** Always look for opportunities to combine patterns into a single pass when performing text sanitization or transformation.
