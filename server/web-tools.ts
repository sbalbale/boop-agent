import { z } from "zod";
import { defineRuntimeTool } from "./runtimes/tool.js";
import { runtimeText, type RuntimeTool } from "./runtimes/types.js";

const NAMESPACE = "boop-web";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_FETCH_CHARS = 20_000;

// Claude and Codex each get web search from their own SDK/API (Claude Agent
// SDK's built-in WebSearch; Codex's native OpenAI web_search tool) — neither
// is something this codebase implements. llama-server has no equivalent, so
// this queries a self-hosted SearXNG instance's JSON search API directly.
// No source-code default — this is a per-deployment URL, set it in .env.
function getSearxngBaseUrl(): string {
  const url = process.env.BOOP_SEARXNG_URL;
  if (!url) {
    throw new Error(
      "BOOP_SEARXNG_URL is not set. Point it at your SearXNG instance's base URL in .env.local to enable web search.",
    );
  }
  return url;
}

interface SearxngResult {
  title?: string;
  url?: string;
  content?: string;
}

async function searchWeb(query: string, limit: number): Promise<SearxngResult[]> {
  const url = new URL("/search", getSearxngBaseUrl());
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`SearXNG search failed (${res.status})`);
  const json = (await res.json()) as { results?: SearxngResult[] };
  return (json.results ?? []).slice(0, limit);
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function createWebTools(namespace = NAMESPACE): RuntimeTool[] {
  return [
    defineRuntimeTool(
      namespace,
      "web_search",
      "Search the web for fresh/factual information via a self-hosted SearXNG metasearch instance. Returns titles, URLs, and short snippets for each result — call web_fetch on a specific URL afterward if you need the full page content, not just the snippet.",
      {
        query: z.string().describe("Search query."),
        limit: z.number().optional().describe("Max results to return (default 5, max 15)."),
      },
      async ({ query, limit }) => {
        const capped = Math.max(1, Math.min(limit ?? 5, 15));
        try {
          const results = await searchWeb(query, capped);
          if (results.length === 0) return runtimeText("No results found.");
          return runtimeText(
            results
              .map(
                (r, i) =>
                  `${i + 1}. ${r.title ?? "(untitled)"}\n   ${r.url ?? ""}\n   ${(r.content ?? "").slice(0, 300)}`,
              )
              .join("\n\n"),
          );
        } catch (err) {
          return runtimeText(`Web search failed: ${err instanceof Error ? err.message : String(err)}`, false);
        }
      },
    ),
    defineRuntimeTool(
      namespace,
      "web_fetch",
      "Fetch a specific URL and return its readable text content (HTML tags stripped). Use after web_search to read one result in full, or for any URL you already know.",
      {
        url: z.string().describe("The URL to fetch."),
      },
      async ({ url }) => {
        try {
          const res = await fetch(url, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: { "User-Agent": "Mozilla/5.0 (compatible; BoopAgent/1.0)" },
          });
          if (!res.ok) return runtimeText(`Fetch failed (${res.status}) for ${url}`, false);
          const contentType = res.headers.get("content-type") ?? "";
          const raw = await res.text();
          const text = contentType.includes("html") ? stripHtml(raw) : raw;
          const truncated = text.length > MAX_FETCH_CHARS ? `${text.slice(0, MAX_FETCH_CHARS)}…` : text;
          return runtimeText(truncated || "(empty page)");
        } catch (err) {
          return runtimeText(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`, false);
        }
      },
    ),
  ];
}
