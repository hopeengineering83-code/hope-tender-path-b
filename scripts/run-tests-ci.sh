#!/usr/bin/env bash
set +e
mkdir -p test-results
npm test > test-results/test-output.log 2>&1
status=$?
cat test-results/test-output.log
exit $status
