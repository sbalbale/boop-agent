import type { Express, NextFunction, Request, Response } from "express";
import type { IncomingMessage } from "node:http";
import http from "node:http";
import type { Duplex } from "node:stream";
import { isPublicServerRequest, isTrustedRequest } from "./local-access.js";

// Proxies traffic for a dedicated hostname straight through to the local
// Convex backend, so the debug dashboard's realtime sync (Convex's own
// WS/HTTP protocol, not this app's routes) works when the dashboard is
// accessed through a reverse proxy instead of from localhost.
//
// Deliberately routed through THIS server (which the global isTrustedRequest
// gate in index.ts already protects) rather than exposing Convex's local
// backend port directly — that backend has no auth of its own (self-hosted
// anonymous dev mode), so a direct proxy to it would be an unauthenticated
// path to the entire database. Requests are only forwarded here at all if
// the incoming Host header matches BOOP_CONVEX_PROXY_HOST (unset disables
// this entirely) — everything else falls through to normal routing.
const CONVEX_LOCAL_PORT = 3210;

function isConvexProxyHost(host: string | undefined): boolean {
  const configured = process.env.BOOP_CONVEX_PROXY_HOST;
  if (!configured || !host) return false;
  return host.toLowerCase().split(":")[0] === configured.toLowerCase();
}

export function isConvexProxyUpgrade(req: IncomingMessage): boolean {
  return isConvexProxyHost(req.headers.host);
}

// Mounts the plain-HTTP half (Convex also serves ordinary HTTP requests
// alongside its WS sync protocol). Safe to mount as normal Express
// middleware since there's no shared-socket race here — that only applies
// to the WebSocket upgrade path, handled separately by
// handleConvexProxyUpgrade below.
export function mountConvexProxy(app: Express): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isConvexProxyHost(req.headers.host)) {
      next();
      return;
    }
    if (req.headers.upgrade?.toLowerCase() === "websocket") {
      next();
      return;
    }
    if (!(isPublicServerRequest(req) || isTrustedRequest(req))) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const target = http.request(
      {
        hostname: "127.0.0.1",
        port: CONVEX_LOCAL_PORT,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${CONVEX_LOCAL_PORT}` },
      },
      (targetRes) => {
        res.writeHead(targetRes.statusCode ?? 502, targetRes.headers);
        targetRes.pipe(res);
      },
    );
    target.on("error", (err) => {
      if (!res.headersSent) res.status(502).json({ error: String(err) });
    });
    req.pipe(target);
  });
}

// Handles one WebSocket upgrade request already confirmed to be addressed
// to the Convex proxy host. Must be called from a single, centralized
// 'upgrade' dispatcher in index.ts alongside the app's own /ws
// WebSocketServer (also noServer-mode) — NOT from a second independent
// `server.on("upgrade", ...)` listener. Node emits 'upgrade' to every
// registered listener, and `ws`'s WebSocketServer, when attached via the
// {server, path} convenience option, actively calls
// `abortHandshake(socket, 400)` for any upgrade whose path doesn't match
// its own — destroying the socket out from under this handler's async
// round-trip to Convex before it could write its own response. Centralized
// dispatch (checking path/host once, calling exactly one handler) avoids
// that race entirely.
//
// Raw byte-level pipe, not two independently-terminated WebSocket
// connections. An earlier version parsed/reassembled/re-encoded messages
// through two separate `ws` library instances (client<->proxy,
// proxy<->Convex) — each side negotiated WebSocket extension state
// independently, and relaying already-decoded messages between them
// produced frame corruption ("Invalid WebSocket frame: RSV1 must be
// clear"), reproducible even with compression explicitly disabled on both
// hops. http.request's own 'upgrade' event hands us the raw,
// already-upgraded outbound socket — piping the two raw sockets together
// directly (the standard way reverse proxies handle WebSockets, e.g. what
// nginx itself does) sidesteps that whole class of bug since neither side
// ever re-interprets frame bytes.
export function handleConvexProxyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  if (!(isPublicServerRequest(req) || isTrustedRequest(req))) {
    socket.destroy();
    return;
  }

  const proxyReq = http.request({
    hostname: "127.0.0.1",
    port: CONVEX_LOCAL_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${CONVEX_LOCAL_PORT}` },
  });

  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    const statusLine = `HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`;
    const headerLines = Object.entries(proxyRes.headers)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
      .join("\r\n");
    socket.write(`${statusLine}${headerLines}\r\n\r\n`);
    if (proxyHead && proxyHead.length > 0) socket.write(proxyHead);
    if (head && head.length > 0) proxySocket.write(head);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
    proxySocket.on("error", () => socket.destroy());
    socket.on("error", () => proxySocket.destroy());
  });
  proxyReq.on("error", () => socket.destroy());
  socket.on("error", () => proxyReq.destroy());
  proxyReq.end();
}
