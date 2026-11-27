import { configDefaults, defineConfig } from "vitest/config";

// GitHub's Windows runner sets CI. The DB tests take seconds there against ~150 ms on a dev machine, so Vitest's
// 5 s test / 10 s hook defaults fail healthy tests on a release tag. Local runs keep the defaults, so real
// slowness still shows up here.
const ciTimeouts = process.env.CI ? { testTimeout: 30_000, hookTimeout: 60_000 } : {};

export default defineConfig({
  // forks: the threads pool is the one reported to hang under Bun.
  // css: without it a `?raw` CSS import is an empty string, and the theme token tests read one.
  // test/e2e and test/site are Playwright's; their *.spec.ts would match Vitest's default include.
  // fsModuleCache off: its key misses files an eager import.meta.glob picks up later, so a cached run of the
  // token tests never saw a new CSS file's literal colour and passed locally while CI failed.
  test: { pool: "forks", css: true, fsModuleCache: false, exclude: [...configDefaults.exclude, "test/e2e/**", "test/site/**"], ...ciTimeouts },
});
