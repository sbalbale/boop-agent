import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { App } from "./App.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import "./styles.css";

const storedTheme = (() => {
  try {
    return localStorage.getItem("boop-debug-theme");
  } catch {
    return null;
  }
})();
document.documentElement.classList.add(storedTheme === "light" ? "light" : "dark");

// The local Convex backend's own URL (baked in at build time by
// `npx convex dev`, e.g. http://127.0.0.1:3210) only resolves on the same
// machine the server runs on. When the dashboard is reached through a
// reverse proxy at a real domain, use the proxied Convex URL instead —
// see server/convex-proxy.ts for how that traffic is authenticated.
const isLocalHost =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const convexUrl = isLocalHost
  ? import.meta.env.VITE_CONVEX_URL
  : (import.meta.env.VITE_CONVEX_PROXY_URL ?? import.meta.env.VITE_CONVEX_URL);
if (!convexUrl) {
  document.getElementById("root")!.innerHTML = `
    <div style="padding:2rem;font-family:Geist,ui-sans-serif,system-ui,sans-serif">
      <h1>VITE_CONVEX_URL is not set</h1>
      <p>Run <code>npm run setup</code> or <code>npx convex dev</code> to configure Convex, then reload.</p>
    </div>`;
} else {
  const convex = new ConvexReactClient(convexUrl);
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <ConvexProvider client={convex}>
          <App />
        </ConvexProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
