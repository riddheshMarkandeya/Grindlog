import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["captures/", "HARs/", "prototypes/", "node_modules/", "dist/", "test-results/", "playwright-report/", "release/", ".cache/"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ["src/web/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
  },
  {
    // The landing page's tsconfig sits outside site/ (so it isn't published), where the project
    // service wouldn't find it.
    files: ["site/**/*.js"],
    languageOptions: { globals: globals.browser, parserOptions: { projectService: false, project: "./tsconfig.site.json" } },
  },
  { files: ["eslint.config.mjs"], extends: [tseslint.configs.disableTypeChecked] },
);
