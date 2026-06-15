import { execFileSync } from "node:child_process";

try {
  execFileSync("git", ["diff", "--exit-code", "--", "."], { stdio: "inherit" });
} catch {
  console.error("Tracked source changed during install/build/test. Commit the intended source instead of mutating it at runtime.");
  process.exit(1);
}
