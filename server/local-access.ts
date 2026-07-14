import type { IncomingHttpHeaders, IncomingMessage } from "node:http";

type RequestLike = Pick<IncomingMessage, "headers" | "method" | "socket" | "url">;

function headerValues(value: string | string[] | undefined): string[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizedAddress(value: string | undefined): string {
  if (!value) return "";

  let address = stripQuotes(value).trim().toLowerCase();
  if (address.startsWith("[")) {
    const closingBracket = address.indexOf("]");
    if (closingBracket !== -1) {
      address = address.slice(1, closingBracket);
    }
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(address)) {
    address = address.slice(0, address.lastIndexOf(":"));
  }

  if (address.startsWith("::ffff:")) {
    address = address.slice("::ffff:".length);
  }
  return address;
}

export function isLoopbackAddress(value: string | undefined): boolean {
  const address = normalizedAddress(value);
  return (
    address === "::1" ||
    address === "0:0:0:0:0:0:0:1" ||
    /^127(?:\.\d{1,3}){3}$/.test(address)
  );
}

function isLocalAuthority(value: string | undefined): boolean {
  if (!value) return false;

  const authority = stripQuotes(value).trim().toLowerCase();
  if (authority.includes("@")) return false;
  try {
    const hostname = new URL(`http://${authority}`).hostname.replace(/^\[|\]$/g, "");
    return hostname === "localhost" || hostname === "localhost." || isLoopbackAddress(hostname);
  } catch {
    return false;
  }
}

function allForwardedAddressesAreLoopback(headers: IncomingHttpHeaders): boolean {
  const forwardedFor = headerValues(headers["x-forwarded-for"]).flatMap((value) =>
    value.split(","),
  );
  const singleAddressHeaders = [
    ...headerValues(headers["x-real-ip"]),
    ...headerValues(headers["cf-connecting-ip"]),
    ...headerValues(headers["true-client-ip"]),
  ];

  return [...forwardedFor, ...singleAddressHeaders].every((value) =>
    isLoopbackAddress(value.trim()),
  );
}

function allForwardedHostsAreLocal(headers: IncomingHttpHeaders): boolean {
  return headerValues(headers["x-forwarded-host"])
    .flatMap((value) => value.split(","))
    .every((value) => isLocalAuthority(value.trim()));
}

function forwardedHeaderIsLocal(headers: IncomingHttpHeaders): boolean {
  for (const value of headerValues(headers.forwarded)) {
    for (const entry of value.split(",")) {
      for (const parameter of entry.split(";")) {
        const separator = parameter.indexOf("=");
        if (separator === -1) continue;
        const key = parameter.slice(0, separator).trim().toLowerCase();
        const parameterValue = parameter.slice(separator + 1).trim();
        if (key === "for" && !isLoopbackAddress(parameterValue)) return false;
        if (key === "host" && !isLocalAuthority(parameterValue)) return false;
      }
    }
  }
  return true;
}

function hasTrustedOrigin(headers: IncomingHttpHeaders): boolean {
  const origins = headerValues(headers.origin);
  if (origins.length === 0) return true;

  return origins.every((origin) => {
    try {
      return isLocalAuthority(new URL(origin).host);
    } catch {
      return false;
    }
  });
}

export function isTrustedLocalRequest(request: RequestLike): boolean {
  return (
    isLoopbackAddress(request.socket.remoteAddress) &&
    isLocalAuthority(request.headers.host) &&
    hasTrustedOrigin(request.headers) &&
    allForwardedAddressesAreLoopback(request.headers) &&
    allForwardedHostsAreLocal(request.headers) &&
    forwardedHeaderIsLocal(request.headers)
  );
}

// Lets a specific, explicitly-trusted reverse proxy (e.g. an internal NPM
// instance sitting behind auth of its own) vouch for a request without
// requiring the connection itself to be loopback. The proxy must inject this
// header with a value matching BOOP_TRUSTED_PROXY_SECRET — nothing else on
// the network knows the secret, so this does not widen trust to "anyone who
// can reach this box" the way relaxing the loopback check outright would.
// Unset BOOP_TRUSTED_PROXY_SECRET (the default) disables this path entirely.
const TRUSTED_PROXY_SECRET_HEADER = "x-boop-proxy-secret";

export function isTrustedReverseProxyRequest(request: RequestLike): boolean {
  const secret = process.env.BOOP_TRUSTED_PROXY_SECRET;
  if (!secret) return false;
  const provided = headerValues(request.headers[TRUSTED_PROXY_SECRET_HEADER])[0];
  return provided === secret;
}

export function isTrustedRequest(request: RequestLike): boolean {
  return isTrustedLocalRequest(request) || isTrustedReverseProxyRequest(request);
}

export function isPublicServerRequest(request: RequestLike): boolean {
  let pathname: string;
  try {
    pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  } catch {
    return false;
  }

  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  return (
    (request.method === "GET" && normalizedPath === "/health") ||
    (request.method === "POST" && normalizedPath === "/sendblue/webhook") ||
    (request.method === "POST" && normalizedPath === "/composio/webhook")
  );
}
