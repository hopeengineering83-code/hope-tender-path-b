# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records for the Hope Tender
Engine. Each ADR documents a significant architectural decision, the context
that led to it, the alternatives considered, and the consequences.

## ADR index

| # | Title | Status | Date |
|---|---|---|---|
| [0001](0001-hmac-sessions.md) | HMAC-signed sessions stored in DB, not JWT | Accepted | 2025-08-28 |
| [0002](0002-ten-provider-fallback-chain.md) | 10-provider AI fallback chain with Anthropic last | Accepted | 2025-08-28 |
| [0003](0003-trust-level-enum.md) | Trust-level enum for Expert/Project records | Accepted | 2025-08-28 |

## ADR template

```markdown
# ADR NNNN: <title>

**Status:** Proposed | Accepted | Rejected | Deprecated | Superseded by ADR NNNN
**Date:** YYYY-MM-DD
**Deciders:** <names>

## Context

<What is the issue we're facing? What forces are at play?>

## Decision

<What is the change we're making?>

## Alternatives considered

### Alternative 1: <name>
<description>
- Pros: ...
- Cons: ...

### Alternative 2: <name>
<description>
- Pros: ...
- Cons: ...

## Consequences

### Positive
- ...

### Negative
- ...

### Neutral
- ...

## Compliance

<How does this decision align with the non-negotiable rules in operator_handoff.md?>
```

## Rules

1. ADRs are numbered sequentially starting at 0001.
2. Once a decision is `Accepted`, it cannot be edited — only superseded by a
   new ADR that references it.
3. ADRs are append-only history. They are NOT deleted.
4. Every significant architectural decision should produce an ADR before the
   PR is merged.
5. ADRs live in this directory; the index above is updated when a new ADR
   is added.

## See also

- `operator_handoff.md` — non-negotiable application rules
- `CLAUDE.md` — agent guide
- `AGENTS.md` — universal agent instructions
- `docs/audits/` — historical audit reports
