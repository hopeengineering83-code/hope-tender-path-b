import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals"),
  {
    plugins: {
      "@typescript-eslint": (await import("@typescript-eslint/eslint-plugin")).default,
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    ignores: [
      // Duplicate project copies
      "repo/**",
      "repo-866/**",
      "repo-fix/**",
      "repo-pr866/**",
      // Skill scaffolding
      "skills/**",
      // Generated Prisma client
      "node_modules/**",
      // Build output
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      // Playwright reports
      "playwright-report/**",
      "test-results/**",
      // Config files that use anonymous default exports (standard pattern)
      "postcss.config.mjs",
    ],
  },
];

export default eslintConfig;
