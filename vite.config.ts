import { readFileSync } from "node:fs";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const CHANNEL = process.env.GRINDLOG_CHANNEL === "prod" ? "prod" : "dev";
const ASSETS = join(import.meta.dirname, "src", "web", "assets");
const DEV_FAVICON = "favicon-dev.ico";

/**
 * Dev builds get the teal favicon, so the developer's install can't pass for a friend's. It lives in
 * assets/ and is added here, not in public/, which Vite copies into every build, the release included.
 * The href is rewritten in the HTML, so the tab never shows the orange icon first.
 */
function devFavicon(): Plugin {
  // Read once, so a missing file (before `bun run icons`) fails the build or dev server at startup.
  let icon: Buffer | undefined;
  const file = () => (icon ??= readFileSync(join(ASSETS, DEV_FAVICON)));
  return {
    name: "grindlog-dev-favicon",
    apply: () => CHANNEL === "dev",
    configResolved: () => {
      file();
    },
    transformIndexHtml: (html) => html.replace('href="/favicon.ico"', `href="/${DEV_FAVICON}"`),
    configureServer(server) {
      server.middlewares.use(`/${DEV_FAVICON}`, (_req, res) => {
        res.setHeader("content-type", "image/x-icon");
        res.end(file());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: DEV_FAVICON, source: file() });
    },
  };
}

export default defineConfig({
  root: "src/web",
  plugins: [react(), devFavicon()],
  // Always defined, so the bundle never relies on how the bundler treats `typeof` on an undeclared
  // global. The release build sets GRINDLOG_CHANNEL=prod; every other build is dev.
  define: { GRINDLOG_CHANNEL: JSON.stringify(CHANNEL) },
  // The header's logo, picked here rather than by CHANNEL in code, so a release bundle can't carry the teal copy.
  resolve: { alias: { "@channel/logo.svg": join(ASSETS, CHANNEL === "prod" ? "icon-small.svg" : "icon-small-dev.svg") } },
  build: { outDir: "../../dist", emptyOutDir: true },
  // The events SharedWorker is a module worker.
  worker: { format: "es" },
  server: {
    // Loopback only, and not "localhost", which can resolve to ::1 alone on Windows.
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // The `bun run dev` tracker. changeOrigin makes the Host header 127.0.0.1:49101, which its Host check allows.
    // "/api/" with the slash: a bare "/api" prefix would also catch the module /api.ts.
    proxy: {
      "/api/": {
        target: "http://127.0.0.1:49101",
        changeOrigin: true,
        // When the tracker dies the proxy would keep the browser's event stream open and silent; end
        // it, so dev sees the same dropped connection the real tracker gives.
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes, _req, res) => {
            proxyRes.on("close", () => {
              if (!res.writableEnded) res.destroy();
            });
          });
        },
      },
    },
  },
});
