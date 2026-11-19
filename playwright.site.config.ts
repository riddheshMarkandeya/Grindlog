import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// The landing page's screenshots only (`bun run site:screens`, after a prod-look build): it
// overwrites site/screens/*.png and site/og.png, so it runs only when named.
export default defineConfig({ ...base, testDir: "test/site" });
