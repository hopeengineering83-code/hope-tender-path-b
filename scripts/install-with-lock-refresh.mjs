import { execFileSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(args) {
  execFileSync(npm, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
}

// Temporary recovery bootstrap: reconcile the committed lock with the exact
// package.json overrides, then install strictly from that regenerated lock.
// The resulting lock is published into the Preview artifact so it can be
// reviewed and committed; this script is removed after that commit.
run(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]);
run(["ci", "--no-audit", "--no-fund"]);
