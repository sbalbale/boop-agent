import { createClaudeMcpServer } from "../runtimes/claude.js";
import { createRemoteMcpTools } from "../mcp-bridge.js";
import { registerIntegration } from "./registry.js";

const NAMESPACE = "second-brain";

function getConfig(): { url: string; token: string } | null {
  const url = process.env.BOOP_SECOND_BRAIN_MCP_URL;
  const token = process.env.BOOP_SECOND_BRAIN_MCP_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

export function registerSecondBrainIntegration(): void {
  registerIntegration({
    name: NAMESPACE,
    description:
      "The user's personal knowledge vault/wiki (a custom remote MCP server) — notes, search, and related read/write tools discovered dynamically from the server itself.",
    isEnabled: async () => getConfig() !== null,
    createServer: async () => {
      const config = getConfig();
      const tools = config
        ? await createRemoteMcpTools({
            namespace: NAMESPACE,
            url: config.url,
            headers: { Authorization: `Bearer ${config.token}` },
          })
        : [];
      return createClaudeMcpServer(NAMESPACE, tools);
    },
    createTools: async () => {
      const config = getConfig();
      if (!config) return [];
      return createRemoteMcpTools({
        namespace: NAMESPACE,
        url: config.url,
        headers: { Authorization: `Bearer ${config.token}` },
      });
    },
  });
  console.log("[second-brain] registered Second Brain MCP integration");
}
