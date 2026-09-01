import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-local/**",
    ".next-test/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Preserve and ignore the pre-existing duplicate build artifact.
    ".next 2/**",
    // The canonical preview source is retained for provenance, but is not the active app.
    "legacy/**",
    // Build output left by hosting tooling.
    ".netlify/**",
    "dist/**",
  ]),
]);

export default eslintConfig;
