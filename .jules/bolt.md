# Bolt's Journal - Critical Performance Learnings

## 2026-06-06 - Initial Mission
**Learning:** Initializing the performance journal.
**Action:** Always start by profiling and identifying measurable bottlenecks.

## 2025-05-22 - Regex Consolidation for Sanitization
**Learning:** Multiple sequential `.replace()` calls with individual Regexes on large strings can be a significant bottleneck. Consolidating into a single or few combined Regexes using unions (`|`) significantly improves throughput. Combined regexes reduced sanitization time by ~50% in this application.
**Action:** Always look for opportunities to combine patterns into a single pass when performing text sanitization or transformation.

## 2025-06-06 - Input Truncation Before Sanitization
**Learning:** When sanitizing potentially large strings (like AI provider error messages) but only needing a small slice of the result, truncating the input *before* running expensive Regex replacements provides massive (>99%) performance gains and protects against ReDoS.
**Action:** Always check if the input can be safely truncated to a reasonable "headroom" length before applying complex Regex transformations if the final output is sliced anyway.
