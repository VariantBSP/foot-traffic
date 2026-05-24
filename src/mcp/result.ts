import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface ToolErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function toolResult<T extends Record<string, unknown>>(structuredContent: T): CallToolResult {
  return {
    structuredContent,
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent),
      },
    ],
  };
}

export function toolError(code: string, message: string, details?: unknown): CallToolResult {
  const body: ToolErrorBody =
    details === undefined
      ? { error: { code, message } }
      : { error: { code, message, details } };

  return {
    isError: true,
    structuredContent: body as unknown as Record<string, unknown>,
    content: [
      {
        type: "text",
        text: JSON.stringify(body),
      },
    ],
  };
}

export async function safeToolResult<T extends Record<string, unknown>>(
  run: () => Promise<T>,
): Promise<CallToolResult> {
  try {
    return toolResult(await run());
  } catch (error) {
    return toolError(
      "SITE_SIGNAL_TOOL_ERROR",
      "The SiteSignal tool failed before it could return structured evidence.",
      error instanceof Error ? { name: error.name, message: error.message } : error,
    );
  }
}
