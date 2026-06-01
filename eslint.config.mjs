import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import tsparser from "@typescript-eslint/parser";
import obsidianmd from "eslint-plugin-obsidianmd";

export default [
  // Ignore compiled files
  {
    ignores: [
      "main.js", 
      "node_modules/**", 
      "dist/**", 
      "version-bump.mjs",
      "esbuild.config.mjs",
      "eslint.config.mjs",
      "**/*.json"
    ]
  },

  // Base Javascript & TypeScript Recommended Rules
  js.configs.recommended,
  ...tseslint.configs.recommended,
  
  // Official Obsidian Plugin Guidelines
  ...obsidianmd.configs.recommended,

  // Project-Specific Configuration & Overrides
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { 
        project: "./tsconfig.json" 
      },
      globals: { 
        ...globals.browser, 
        ...globals.node 
      }
    },
    rules: {
      // Custom overrides
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          brands: ["Obsidian"],
          acronyms: ["ID", "URL", "UI"],
          enforceCamelCaseLower: true,
        },
      ],

      "@typescript-eslint/no-explicit-any": "warn"
    },
  },
];