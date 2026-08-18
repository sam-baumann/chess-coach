import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist/**", "data/**", "reviews/**"]),
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,tsx}"],
    plugins: { js },
    extends: ["js/recommended"],
  },
  tseslint.configs.recommended,
  {
    files: ["src/server/**/*.ts", "vite.config.ts", "eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["src/web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
]);
