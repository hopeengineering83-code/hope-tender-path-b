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
      // Audit gap GAP-ARCH-03: re-enabling `no-explicit-any` is desirable but
      // cannot be done in this cleanup PR. The codebase has 820 existing
      // `any` usages (mainly AI JSON responses, dynamic Prisma queries,
      // library return values, and test fixtures). Re-enabling as `warn`
      // exceeds the `--max-warnings 50` threshold in `npm run lint` and
      // breaks CI. To re-enable safely:
      //   1. Type the ~50 production-code `any` usages (use `unknown` +
      //      type narrowing for AI JSON; use Prisma's generated types for
      //      queries; use library-provided types for SDK returns).
      //   2. For the ~770 test-file `any` usages, either type them or add
      //      a separate eslint override for `tests/**` that allows `any`.
      //   3. Then re-enable this rule as `warn`.
      // This is documented in docs/audits/hope-tender-audit-current-disposition.md
      // as a follow-up PR.
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
