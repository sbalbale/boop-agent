import { EMPTY_USAGE, type UsageTotals } from "../usage.js";
import { formatError } from "../error-format.js";
import { getLlamaServerApiKey, getLlamaServerBaseUrl } from "../runtime-config.js";
import type {
  RuntimeImageBlock,
  RuntimeRunRequest,
  RuntimeRunResult,
  RuntimeTextBlock,
  RuntimeTool,
} from "./types.js";

// Hand-rolled OpenAI-compatible tool-calling loop for any self-hosted
// endpoint (llama.cpp / llama-swap / vLLM / Ollama, etc). Unlike the Claude
// Agent SDK or the Codex app-server, a plain chat/completions endpoint has no
// built-in agent loop — this drives it manually: send messages + tools, run
// any tool_calls the model returns, append the results, and repeat until the
// model stops calling tools or we hit the safety cap below.
const MAX_TOOL_ITERATIONS = 20;

type OpenAiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenAiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | OpenAiContentPart[] | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
};

type OpenAiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type OpenAiChatCompletionResponse = {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: OpenAiToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: { message?: string };
};

function toolId(namespace: string, name: string): string {
  return `mcp__${namespace}__${name}`;
}

function matchesToolPattern(id: string, pattern: string): boolean {
  return pattern.endsWith("__*") ? id.startsWith(pattern.slice(0, -"__*".length)) : id === pattern;
}

function isRuntimeToolAllowed(request: RuntimeRunRequest, runtimeTool: RuntimeTool): boolean {
  const id = toolId(runtimeTool.namespace, runtimeTool.name);
  if (request.disallowedTools?.some((pattern) => matchesToolPattern(id, pattern))) return false;
  if (request.allowedTools) return request.allowedTools.some((pattern) => matchesToolPattern(id, pattern));
  return true;
}

function promptBlockToContentPart(block: RuntimeImageBlock | RuntimeTextBlock): OpenAiContentPart {
  if (block.type === "text") return { type: "text", text: block.text };
  return {
    type: "image_url",
    image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
  };
}

function initialMessages(request: RuntimeRunRequest): OpenAiMessage[] {
  const messages: OpenAiMessage[] = [{ role: "system", content: request.systemPrompt }];
  if (typeof request.prompt === "string") {
    messages.push({ role: "user", content: request.prompt });
  } else {
    messages.push({ role: "user", content: request.prompt.map(promptBlockToContentPart) });
  }
  return messages;
}

function toOpenAiTools(tools: RuntimeTool[]): Array<{
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: toolId(t.namespace, t.name),
      description: t.description,
      parameters: t.jsonSchema,
    },
  }));
}

function accumulateUsage(usage: UsageTotals, response: OpenAiChatCompletionResponse, model: string): UsageTotals {
  return {
    model,
    inputTokens: usage.inputTokens + (response.usage?.prompt_tokens ?? 0),
    outputTokens: usage.outputTokens + (response.usage?.completion_tokens ?? 0),
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    // Self-hosted inference has no per-token billing.
    costUsd: 0,
  };
}

async function callChatCompletions(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  messages: OpenAiMessage[],
  tools: RuntimeTool[],
  signal: AbortSignal | undefined,
): Promise<OpenAiChatCompletionResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0,
  };
  if (tools.length > 0) {
    body.tools = toOpenAiTools(tools);
  }

  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  const json = (await res.json()) as OpenAiChatCompletionResponse;
  if (!res.ok) {
    throw new Error(`llama-server request failed (${res.status}): ${json.error?.message ?? formatError(json)}`);
  }
  return json;
}

export async function runLlamaServerAgent(request: RuntimeRunRequest): Promise<RuntimeRunResult> {
  const baseUrl = getLlamaServerBaseUrl();
  const apiKey = getLlamaServerApiKey();
  const tools = request.tools.filter((t) => isRuntimeToolAllowed(request, t));
  const toolsById = new Map(tools.map((t) => [toolId(t.namespace, t.name), t]));

  const messages = initialMessages(request);
  let usage: UsageTotals = { ...EMPTY_USAGE, model: request.model };
  let finalText = "";

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    if (request.abortController?.signal.aborted) {
      throw new Error("llama-server runtime aborted");
    }

    const response = await callChatCompletions(
      baseUrl,
      apiKey,
      request.model,
      messages,
      tools,
      request.abortController?.signal,
    );
    usage = accumulateUsage(usage, response, request.model);
    await request.onUsage?.(usage);

    const choice = response.choices[0];
    if (!choice) throw new Error("llama-server returned no choices");
    const { message } = choice;
    const toolCalls = message.tool_calls ?? [];

    if (message.content) {
      finalText = message.content;
      await request.onText?.(message.content);
    }

    if (toolCalls.length === 0) {
      return { text: finalText, usage };
    }

    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: toolCalls });

    for (const call of toolCalls) {
      const runtimeTool = toolsById.get(call.function.name);
      let resultText: string;
      if (!runtimeTool) {
        resultText = `Unknown tool "${call.function.name}"`;
      } else {
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch (err) {
          resultText = `Invalid JSON arguments for ${call.function.name}: ${formatError(err)}`;
          messages.push({ role: "tool", tool_call_id: call.id, content: resultText });
          continue;
        }
        await request.onToolUse?.(toolId(runtimeTool.namespace, runtimeTool.name), args);
        try {
          const result = await runtimeTool.handle(args);
          resultText = result.text;
        } catch (err) {
          resultText = `Tool error: ${formatError(err)}`;
        }
        await request.onToolResult?.(toolId(runtimeTool.namespace, runtimeTool.name), resultText);
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: resultText });
    }
  }

  throw new Error(`llama-server runtime exceeded ${MAX_TOOL_ITERATIONS} tool-call iterations without finishing`);
}
