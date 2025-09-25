import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function pickEnv() {
  const keys = [
    "PATH",
    "HOME",
    "SHELL",
    "LANG",
    "LC_ALL",
    "TERM",
    "COLORTERM",
    "JIRA_BASE_URL",
    "JIRA_EMAIL",
    "JIRA_API_TOKEN",
    "DEFAULT_PROJECT_KEY",
    "DEFAULT_ISSUE_TYPE",
    "JIRA_MCP_DEBUG",
  ];
  const out = {};
  for (const k of keys) {
    if (typeof process.env[k] === "string") out[k] = process.env[k];
  }
  return out;
}

async function main() {
  requireEnv("JIRA_BASE_URL");
  requireEnv("JIRA_EMAIL");
  requireEnv("JIRA_API_TOKEN");

  const serverPath = process.argv[2] || "dist/index.js";
  const cwd = process.cwd();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: pickEnv(),
    cwd,
    stderr: "pipe",
  });

  const client = new Client({ name: "jira-mcp-ping", version: "0.1.0" });
  const err = transport.stderr;
  if (err) {
    err.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
  }
  await client.connect(transport);

  const version = client.getServerVersion();
  const caps = client.getServerCapabilities();
  const tools = await client.listTools();

  console.log("Connected to:", version);
  console.log("Capabilities:", Object.keys(caps || {}));
  console.log("Tools:", tools.tools.map((t) => t.name).join(", "));

  const args = process.argv.slice(3);
  if (args.length) {
    const jql = args.join(" ");
    const res = await client.callTool({ name: "jira_list_issues", arguments: { jql, limit: 5 } });
    console.log("list_issues result:", JSON.stringify(res));
  }

  await transport.close();
}

main().catch((err) => {
  console.error("Ping failed:", err);
  process.exit(1);
});
