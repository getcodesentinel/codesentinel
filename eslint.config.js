import js from "@eslint/js";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";

const ROOT_DIR = `${dirname(fileURLToPath(import.meta.url))}/`;

export default [
  {
    ignores: ["**/dist/**", "**/dist/**/*", "**/node_modules/**", "**/coverage/**"],
  },
  {
    languageOptions: {
      globals: {
        Buffer: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
      },
    },
  },
  js.configs.recommended,
  {
    files: ["packages/*/src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    },
  },
  {
    files: ["packages/reporter/src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: [`${ROOT_DIR}packages/reporter/tsconfig.json`],
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs["recommended-type-checked"].rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    },
  },
  {
    files: ["packages/core/src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: [`${ROOT_DIR}packages/core/tsconfig.json`],
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs["recommended-type-checked"].rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    },
  },
  {
    files: ["packages/risk-engine/src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: [`${ROOT_DIR}packages/risk-engine/tsconfig.json`],
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs["recommended-type-checked"].rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    },
  },
  {
    files: ["packages/code-graph/src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: [`${ROOT_DIR}packages/code-graph/tsconfig.json`],
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs["recommended-type-checked"].rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    },
  },
  {
    files: ["packages/git-analyzer/src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: [`${ROOT_DIR}packages/git-analyzer/tsconfig.json`],
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs["recommended-type-checked"].rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    },
  },
  {
    files: ["packages/governance/src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: [`${ROOT_DIR}packages/governance/tsconfig.json`],
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs["recommended-type-checked"].rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    },
  },
  {
    files: ["packages/dependency-firewall/src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: [`${ROOT_DIR}packages/dependency-firewall/tsconfig.json`],
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs["recommended-type-checked"].rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    },
  },
  prettier,
];
