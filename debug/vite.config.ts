import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { isTrustedRequest } from "../server/local-access.js";

const PROJECT_ROOT = path.resolve(__dirname, "..");

function localConnectionConfig(phoneNumber: string): Plugin {
  return {
    name: "boop-local-connection-config",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (req.method !== "GET" || url.pathname !== "/api/connection-config") {
          next();
          return;
        }
        if (!isTrustedRequest(req)) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.end(JSON.stringify({ phoneNumber }));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load .env.local from the project root (not debug/) so we can read PORT
  // even though this config file lives under debug/.
  const env = loadEnv(mode, PROJECT_ROOT, "");
  const port = Number(env.PORT ?? process.env.PORT ?? 3456);

  // isTrustedRequest() (shared with the server) reads process.env directly,
  // but this Vite dev-server process is spawned separately from the server
  // process and never runs server/env-setup.ts's dotenv load. Bridge just
  // this one var through from Vite's own loadEnv() so the reverse-proxy
  // trust check works for requests handled inside this process too.
  if (env.BOOP_TRUSTED_PROXY_SECRET) {
    process.env.BOOP_TRUSTED_PROXY_SECRET = env.BOOP_TRUSTED_PROXY_SECRET;
  }

  return {
    root: path.resolve(__dirname),
    envDir: PROJECT_ROOT,
    plugins: [
      localConnectionConfig(env.SENDBLUE_FROM_NUMBER ?? ""),
      react(),
      tailwindcss(),
    ],
    server: {
      port: 5173,
      host: true,
      // Extra hostnames Vite's dev-server should accept (beyond localhost),
      // e.g. when reached through an internal reverse proxy at a real
      // domain. Comma-separated; kept out of source since it is
      // deployment-specific, not something to hardcode into a fork.
      allowedHosts: (env.BOOP_DASHBOARD_ALLOWED_HOSTS ?? "")
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean),
      proxy: {
        "/api": {
          target: `http://localhost:${port}`,
          rewrite: (p) => p.replace(/^\/api/, ""),
          configure: (proxy) => {
            proxy.on("error", () => {
              /* ignore — server may be restarting */
            });
          },
        },
        "/ws": {
          target: `ws://localhost:${port}`,
          ws: true,
          configure: (proxy) => {
            proxy.on("error", () => {
              /* WS proxy EPIPE on reconnect is harmless */
            });
          },
        },
      },
    },
    build: { outDir: path.resolve(__dirname, "dist") },
  };
});
