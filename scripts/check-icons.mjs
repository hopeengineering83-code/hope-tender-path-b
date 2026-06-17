import { existsSync } from "node:fs";
import { join } from "node:path";

const icons = ["icon-192.png", "icon-512.png"];
const missing = icons.filter(icon => !existsSync(join(process.cwd(), "public", icon)));

if (missing.length > 0) {
  console.warn(`Warning: Missing PWA icons in public/: ${missing.join(", ")}`);
} else {
  console.log("✓ PWA icons present.");
}
