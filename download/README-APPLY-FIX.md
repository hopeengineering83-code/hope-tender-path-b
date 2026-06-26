# Quarantined Z.ai Patch — Do Not Apply

This directory previously contained a speculative Z.ai "Coding Plan" fix. It is
now intentionally quarantined and must **not** be copied into the production
application.

## Why this patch is rejected

The release-stabilization rules require that we do **not**:

- assume any Z.ai model is valid merely because it appears in code or an env
  example;
- guess Z.ai model names;
- expose model names, provider response bodies, keys, or raw provider errors to
  standard users;
- repeatedly call a provider returning HTTP 400 configuration/model errors;
- alter Vercel environment variables or trigger deployments without explicit
  approval.

The previous patch violated those constraints by expanding a model allowlist
without live account-specific proof, recommending Vercel env changes, probing a
list of guessed models, and returning provider error snippets from a diagnostic
route.

## Safe replacement guidance

When the real application source tree is available, implement Z.ai handling in
production code only after review and tests:

1. Treat HTTP 400 "Unknown Model", invalid model, model code error, or equivalent
   configuration failures as `CONFIGURATION_INVALID` or `MODEL_UNAVAILABLE`, not
   `UNKNOWN`.
2. Quarantine Z.ai for a bounded cooldown window after such failures.
3. Continue safely through the canonical provider order without retrying Z.ai in
   the same cooldown window.
4. Keep Anthropic/Claude last.
5. Return only safe status codes, plain-language remediation, and correlation IDs
   from admin diagnostics; log technical details server-side only.
6. Never expose provider response bodies, secrets, raw errors, tender text, or AI
   JSON to browser users.

No file in this `download/` folder is a verified production fix.
