import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { runtimeText, type RuntimeTool } from "./runtimes/types.js";

export interface RemoteMcpConfig {
  namespace: string;
  url: string;
  headers?: Record<string, string>;
}

// One connection per namespace, reused across calls — the MCP initialize
// handshake is a real network round trip we don't want to pay per tool
// call. A failed connection attempt is evicted from the cache so the next
// call retries fresh rather than replaying the same rejection forever.
const clientCache = new Map<string, Promise<Client>>();

async function connectClient(config: RemoteMcpConfig): Promise<Client> {
  const client = new Client({ name: "boop-agent", version: "0.2.0" });
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: config.headers ? { headers: config.headers } : undefined,
  });
  await client.connect(transport);
  return client;
}

function getClient(config: RemoteMcpConfig): Promise<Client> {
  const cached = clientCache.get(config.namespace);
  if (cached) return cached;
  const attempt = connectClient(config);
  attempt.catch(() => {
    if (clientCache.get(config.namespace) === attempt) clientCache.delete(config.namespace);
  });
  clientCache.set(config.namespace, attempt);
  return attempt;
}

function extractText(result: { content?: unknown; isError?: boolean }): string {
  if (Array.isArray(result.content)) {
    const text = result.content
      .filter((c): c is { type: string; text: string } => (c as { type?: string })?.type === "text")
      .map((c) => c.text)
      .join("\n");
    if (text) return text;
  }
  return JSON.stringify(result.content ?? result);
}

// Discovers tools from a remote MCP server (streamable-HTTP transport) and
// wraps each as a plain RuntimeTool — the same shape every other integration
// in this codebase uses, so it flows through createClaudeMcpServer for
// Claude and the plain RuntimeTool[] path for Codex/llama-server without
// any runtime-specific code here. Bypasses defineRuntimeTool's zod-shape
// requirement since the remote server's own JSON Schema is the real
// validation source of truth, not something we should re-derive.
export async function createRemoteMcpTools(config: RemoteMcpConfig): Promise<RuntimeTool[]> {
  try {
    const client = await getClient(config);
    const { tools } = await client.listTools();
    return tools.map(
      (tool): RuntimeTool => ({
        namespace: config.namespace,
        name: tool.name,
        description: tool.description ?? `Tool "${tool.name}" from the ${config.namespace} MCP server.`,
        inputSchema: {},
        jsonSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
        handle: async (args) => {
          try {
            const activeClient = await getClient(config);
            const result = (await activeClient.callTool({ name: tool.name, arguments: args })) as {
              content?: unknown;
              isError?: boolean;
            };
            return runtimeText(extractText(result), !result.isError);
          } catch (err) {
            return runtimeText(
              `Tool "${tool.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
              false,
            );
          }
        },
      }),
    );
  } catch (err) {
    console.warn(`[mcp-bridge] failed to connect to remote MCP server "${config.namespace}":`, err);
    return [];
  }
}
