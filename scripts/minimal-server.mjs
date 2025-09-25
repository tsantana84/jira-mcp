// Minimal MCP server to validate Gemini tool listing.
// Registers a single tool: `jira_list_issues`.
// It echoes the provided JQL so you can confirm wiring end-to-end.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
// Use the built Jira client/normalizer from dist to keep this script standalone
import { JiraClient } from "../dist/jira/client.js";
import { normalizeIssue, adfToPlainText } from "../dist/jira/issues.js";

const server = new McpServer(
  { name: "jira-mcp-min", version: "0.0.1" },
  { capabilities: { tools: { listChanged: true }, logging: {} } }
);

// Validate env
function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// Initialize Jira client lazily on first call
let jira = null;

server.tool(
  "jira_list_issues",
  "Jira: List issues via JQL (minimal)",
  {
    jql: z.string().min(1).describe("JQL query"),
    limit: z.number().int().min(1).max(100).optional(),
    startAt: z.number().int().min(0).optional(),
    fields: z.union([z.literal("summary"), z.literal("all"), z.array(z.string()).nonempty()]).optional(),
    includeComments: z.boolean().optional().describe("If true, hydrates comments for each issue"),
    includeRaw: z.boolean().optional().describe("If true, include raw Jira payload from hydration step")
  },
  async ({ jql, limit, startAt, fields, includeComments, includeRaw }) => {
    if (!jira) {
      const baseUrl = requireEnv("JIRA_BASE_URL");
      const email = requireEnv("JIRA_EMAIL");
      const apiToken = requireEnv("JIRA_API_TOKEN");
      jira = new JiraClient({ baseUrl, email, apiToken, defaults: {} });
      // nudge client UIs to refresh
      try { server.sendLoggingMessage({ level: "info", logger: "jira-mcp-min", data: "Initialized Jira client" }); } catch {}
    }
    // Build fields for search (lightweight). Always include description so UIs can show it.
    let searchFields = fields ?? ["description"];
    // If caller asked for "all", pass that through; otherwise ensure description is present.
    if (Array.isArray(searchFields)) {
      if (!searchFields.includes("description")) searchFields = [...searchFields, "description"];
    }

    const res = await jira.searchIssues({ jql, maxResults: limit ?? 25, startAt: startAt ?? 0, fields: searchFields });
    let issues = Array.isArray(res.issues)
      ? res.issues.map((raw) => ({
          ...normalizeIssue(raw, process.env.JIRA_BASE_URL),
          description: adfToPlainText(raw?.fields?.description),
        }))
      : [];

    // Optional hydration for comments or full fields per issue
    if (issues.length && (includeComments || searchFields === "all" || (Array.isArray(searchFields) && searchFields.includes("comment")))) {
      const hydrated = [];
      for (const it of issues) {
        try {
          const key = it.key;
          const needAll = searchFields === "all";
          const needComment = includeComments || (Array.isArray(searchFields) && searchFields.includes("comment"));
          const reqFields = needAll ? "all" : needComment ? ["comment", "description"] : ["description"];
          const full = await jira.getIssue(key, reqFields);
          const base = normalizeIssue(full, process.env.JIRA_BASE_URL);
          const desc = adfToPlainText(full?.fields?.description);
          let comments = undefined;
          if (needComment && full?.fields?.comment?.comments) {
            comments = full.fields.comment.comments.map((c) => ({
              id: String(c.id),
              author: { accountId: c.author?.accountId, displayName: c.author?.displayName },
              created: c.created,
              body: adfToPlainText(c.body),
            }));
          }
          hydrated.push({ ...base, description: desc, ...(comments ? { comments } : {}), ...(includeRaw ? { raw: full } : {}) });
        } catch (e) {
          // If hydration fails for an issue, keep the lightweight one
          hydrated.push(it);
        }
      }
      issues = hydrated;
    }
    const nextStartAt = res.startAt + res.maxResults < res.total ? res.startAt + res.maxResults : undefined;
    const payload = { issues, total: res.total, startAt: res.startAt, maxResults: res.maxResults, ...(nextStartAt !== undefined ? { nextStartAt } : {}) };
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  try {
    server.sendToolListChanged();
  } catch {}
}

main().catch((err) => {
  // stderr is safe for diagnostics
  console.error("[jira-mcp-min] fatal:", err);
  process.exit(1);
});
