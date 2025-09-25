import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools, registerResources, registerPrompts } from "./mcp/tools.js";
import { loadConfig } from "./config.js";

async function main() {
  const config = loadConfig();

  const mcp = new McpServer(
    { name: "jira-mcp", version: "0.1.0" },
    { capabilities: { logging: {}, tools: { listChanged: true }, resources: { listChanged: false }, prompts: { listChanged: false } } }
  );

  if (process.env.JIRA_MCP_DEBUG === "1") {
    // Safe to write to stderr; stdio protocol uses stdout
    console.error("[jira-mcp] Starting with baseUrl=", config.baseUrl);
    (mcp.server as any).oninitialized = () => {
      const getClientVersion = (mcp.server as any).getClientVersion;
      const clientInfo = typeof getClientVersion === "function" ? getClientVersion.call(mcp.server) : undefined;
      console.error("[jira-mcp] Initialized with client:", clientInfo);
    };
  }

  let toolNames: string[] = [];
  try {
    toolNames = registerTools(mcp as any, config) || [];
  } catch (e) {
    if (process.env.JIRA_MCP_DEBUG === "1") {
      console.error("[jira-mcp] Tool registration error:", e);
    }
  }
  registerResources(mcp as any, config);
  registerPrompts(mcp as any, config);

  const transport = new StdioServerTransport();
  await mcp.connect(transport as any);
  try {
    // Always notify clients to refresh tool list after connect
    (mcp as any).sendToolListChanged?.();
    if (process.env.JIRA_MCP_DEBUG === "1") {
      console.error("[jira-mcp] Tools registered:", Array.isArray(toolNames) ? toolNames.join(", ") : (mcp as any)._registeredToolNames);
      await (mcp as any).sendLoggingMessage?.({ level: "info", logger: "jira-mcp", data: { tools: toolNames } });
    }
  } catch {}
}

main().catch((err) => {
  console.error("[jira-mcp] Fatal:", err);
  process.exit(1);
});
