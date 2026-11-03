import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";
import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  comments.recommended,

  // Type-aware rules for all TypeScript sources.
  {
    files: ["**/*.{ts,tsx,mts}"],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-expect-error": "allow-with-description", minimumDescriptionLength: 10 },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Every suppression must say why, and blanket disables are never allowed.
      "@eslint-community/eslint-comments/no-unlimited-disable": "error",
      "@eslint-community/eslint-comments/require-description": "error",
      // Configuration is read once, validated, from src/lib/config (plan §13 rule 14).
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "Read configuration through '@/lib/config' instead of process.env.",
        },
      ],
      eqeqeq: ["error", "always"],
      "no-console": "error",
    },
  },

  // The service-role client bypasses RLS. Only the agent's privileged adapter may use it
  // (plan §9; ADR 0005), and the Gemini SDK stays behind the agent's model interface.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/features/agent/**", "src/lib/supabase/privileged.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase/privileged",
              message: "The service-role client is reserved for src/features/agent (ADR 0005).",
            },
            {
              name: "@google/genai",
              message: "Call the model through src/features/agent only.",
            },
          ],
        },
      ],
    },
  },

  // The configuration module and tooling configs are the only places allowed to touch process.env.
  {
    files: [
      "src/lib/config/**",
      "*.config.{ts,mts}",
      "tests/e2e/**",
      "tests/integration/**",
      "tests/eval/**",
    ],
    rules: { "no-restricted-properties": "off" },
  },

  // Command-line scripts own their environment and talk to the terminal.
  {
    files: ["scripts/**"],
    rules: { "no-restricted-properties": "off", "no-console": "off" },
  },

  // The logger is the single sanctioned console sink.
  {
    files: ["src/lib/logging/**"],
    rules: { "no-console": "off" },
  },

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    "src/lib/supabase/database.types.ts",
    "supabase/.temp/**",
  ]),
]);

export default eslintConfig;
