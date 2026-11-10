import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  // Always defined, so the bundle never relies on how the bundler treats `typeof` on an undeclared
  // global. The release build sets GRINDLOG_CHANNEL=prod; every other build is dev.
  define: { GRINDLOG_CHANNEL: JSON.stringify(process.env.GRINDLOG_CHANNEL === "prod" ? "prod" : "dev") },
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
