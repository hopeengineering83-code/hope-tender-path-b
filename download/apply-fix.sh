#!/usr/bin/env bash
set -euo pipefail

cat >&2 <<'MSG'
This Z.ai patch is quarantined and must not be applied automatically.

Reason: the previous patch guessed model names, recommended environment changes,
performed live provider probing, and risked exposing provider error details.
Implement provider quarantine/classification only in the real app source tree
with tests and safe admin-only diagnostics.
MSG

exit 1
