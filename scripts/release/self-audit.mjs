#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const checks = [];
const add = (name, status, detail) => checks.push({ name, status, detail });
const read = (path) => readFileSync(path, 'utf8');

function commandOk(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  return result;
}

const remote = commandOk('git', ['remote', '-v']);
add('git remote configured', remote.stdout.trim().length > 0 ? 'PASS' : 'BLOCKED', remote.stdout.trim() || 'No remotes configured.');

const appFiles = ['package.json', 'prisma/schema.prisma'];
const appPresent = appFiles.every((file) => existsSync(file));
add('production app source present', appPresent ? 'PASS' : 'BLOCKED', appPresent ? 'package.json and prisma/schema.prisma exist.' : 'Required app files are absent.');

const quarantineFiles = [
  'download/README-APPLY-FIX.md',
  'download/README.md',
  'download/apply-fix.sh',
  'download/zai-coding-plan-fix.patch',
  'download/zai-fix/ai-provider-registry.ts',
  'download/zai-fix/zai-diagnostic-route.ts',
  'download/zai-fix/zai-model-regression.test.ts',
];
for (const file of quarantineFiles) {
  const ok = existsSync(file) && /quarantin/i.test(read(file));
  add(`quarantine marker: ${file}`, ok ? 'PASS' : 'FAIL', ok ? 'Contains quarantine marker.' : 'Missing quarantine marker.');
}

const unsafePattern = /glm-4-coding|glm-4v-coding|glm-4-air|glm-4-plus|body\.slice|modelTests|Redeploy|Set these Vercel|DELETE ZAI_API_KEY|Unknown Model.*correct|all known/i;
const unsafeHits = [];
for (const file of quarantineFiles) {
  if (!existsSync(file)) continue;
  const text = read(file);
  if (unsafePattern.test(text)) unsafeHits.push(file);
}
add('unsafe downloaded Z.ai patch instructions removed', unsafeHits.length === 0 ? 'PASS' : 'FAIL', unsafeHits.length === 0 ? 'No unsafe patch strings found in quarantined artifacts.' : `Unsafe strings found in: ${unsafeHits.join(', ')}`);

const applyResult = commandOk('bash', ['download/apply-fix.sh']);
add('apply-fix refuses automatic application', applyResult.status !== 0 ? 'PASS' : 'FAIL', applyResult.status !== 0 ? 'Script exited non-zero as intended.' : 'Script unexpectedly succeeded.');

const testResult = commandOk('node', ['--test', 'download/zai-fix/zai-model-regression.test.ts']);
add('quarantined Z.ai artifact test', testResult.status === 0 ? 'PASS' : 'FAIL', testResult.status === 0 ? 'node --test passed.' : (testResult.stderr || testResult.stdout).trim());

const fail = checks.filter((check) => check.status === 'FAIL');
for (const check of checks) {
  console.log(`${check.status}\t${check.name}\t${check.detail}`);
}
if (fail.length > 0) process.exit(1);
