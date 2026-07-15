#!/usr/bin/env bash
# Proves worker validation separates untrusted execution from trusted evidence:
# the job that runs worker code holds only contents:read, and a distinct
# publish-evidence job holds checks:write but performs no checkout and runs no
# worker code. A compromised worker commit therefore cannot forge check evidence.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

WF=.github/workflows/worker-validation.yml
test -f "$WF"

# Structural: three jobs — resolve-head, execute (untrusted), publish-evidence (trusted).
grep -qE '^[[:space:]]*resolve-head:' "$WF"
grep -qE '^[[:space:]]*execute:' "$WF"
grep -qE '^[[:space:]]*publish-evidence:' "$WF"

# Extract each job block and assert its permissions and behaviour.
python3 - "$WF" <<'PY'
import sys, re
wf = open(sys.argv[1]).read()

# Split into top-level jobs by 2-space-indented "name:" keys under jobs:.
jobs = {}
m = re.search(r'^jobs:\n', wf, re.M)
body = wf[m.end():]
parts = re.split(r'^  ([a-zA-Z0-9_-]+):\n', body, flags=re.M)
# parts = ['', name1, block1, name2, block2, ...]
for i in range(1, len(parts), 2):
    jobs[parts[i]] = parts[i+1]

assert 'execute' in jobs and 'publish-evidence' in jobs, 'expected execute and publish-evidence jobs'

execute = jobs['execute']
publish = jobs['publish-evidence']

def perms(block):
    mm = re.search(r'permissions:\n((?:      .+\n)+)', block)
    return mm.group(1) if mm else ''

ep = perms(execute)
pp = perms(publish)

# The untrusted execute job must run worker code but MUST NOT hold checks:write
# or any other write scope.
assert 'checks: write' not in ep, 'execute (untrusted) must NOT hold checks:write'
assert 'write' not in ep, f'execute (untrusted) must be read-only, got: {ep!r}'
assert 'npm ci' in execute, 'execute must run worker code (npm ci)'
assert 'actions/checkout' in execute, 'execute must checkout the worker head'

# The trusted publisher must hold checks:write, run NO worker code, and NOT checkout.
assert 'checks: write' in pp, 'publish-evidence must hold checks:write'
assert 'actions/checkout' not in publish, 'publish-evidence must NOT checkout worker code'
# Structural: the trusted publisher runs NO shell step — only github-script. Any
# worker-code execution would require a `run:` step.
assert not re.search(r'^\s+run:', publish, re.M), 'publish-evidence must NOT contain a shell run: step (no worker code)'
assert 'checks.create' in publish, 'publish-evidence must publish the exact-head check run'
# Publisher only runs after the untrusted job succeeded.
assert "needs.execute.result == 'success'" in publish, 'publish-evidence must gate on execute success'

print('privilege-separation ok: untrusted execute is read-only; trusted publisher runs no worker code')
PY

echo "privilege-separation simulation passed"
