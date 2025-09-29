import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";


function loadGeminiSettings() {
  const settingsPath = join(homedir(), '.gemini', 'settings.json');
  if (!existsSync(settingsPath)) {
    return null;
  }
  try {
    const content = readFileSync(settingsPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function getEnvOrGemini(name, geminiServer = 'jira-min') {
  // first try environment variable
  const envValue = process.env[name];
  if (envValue) return envValue;

  // fallback to gemini settings
  const settings = loadGeminiSettings();
  const serverConfig = settings?.mcpServers?.[geminiServer];
  return serverConfig?.env?.[name];
}

function buildEnv(jiraBaseUrl, jiraEmail, jiraApiToken) {
  const keys = [
    "PATH",
    "HOME",
    "SHELL",
    "LANG",
    "LC_ALL",
    "TERM",
    "COLORTERM",
    "DEFAULT_PROJECT_KEY",
    "DEFAULT_ISSUE_TYPE",
    "JIRA_MCP_DEBUG",
  ];
  const out = {
    JIRA_BASE_URL: jiraBaseUrl,
    JIRA_EMAIL: jiraEmail,
    JIRA_API_TOKEN: jiraApiToken,
  };
  for (const k of keys) {
    if (typeof process.env[k] === "string") out[k] = process.env[k];
  }
  return out;
}

async function main() {
  // try env vars first, then fallback to gemini settings
  const jiraBaseUrl = getEnvOrGemini("JIRA_BASE_URL");
  const jiraEmail = getEnvOrGemini("JIRA_EMAIL");
  const jiraApiToken = getEnvOrGemini("JIRA_API_TOKEN");

  if (!jiraBaseUrl) throw new Error("missing jira_base_url - set env var or run: npm run gemini:config");
  if (!jiraEmail) throw new Error("missing jira_email - set env var or run: npm run gemini:config");
  if (!jiraApiToken) throw new Error("missing jira_api_token - set env var or run: npm run gemini:config");

  console.log(`[*] using jira instance: ${jiraBaseUrl}`);
  console.log(`[*] using email: ${jiraEmail}`);

  const serverPath = process.argv[2] || "dist/index.js";
  const cwd = process.cwd();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: buildEnv(jiraBaseUrl, jiraEmail, jiraApiToken),
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

  // test actual jira api connectivity by listing projects
  try {
    console.log("\n[*] testing jira api connectivity...");
    const res = await client.callTool({ name: "jira_list_projects", arguments: { limit: 1 } });
    if (res.content && res.content[0] && res.content[0].text) {
      const data = JSON.parse(res.content[0].text);
      console.log(`[+] jira api test successful: ${data.total} projects accessible`);
    } else {
      throw new Error("invalid response format");
    }
  } catch (error) {
    console.error("[-] jira api test failed:", error.message);
    throw error;
  }

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
