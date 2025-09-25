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
  "Jira: List/search issues (JQL) — find by project, status, label, assignee; supports comments hydration",
  {
    jql: z.string().min(1).describe("JQL query"),
    limit: z.number().int().min(1).max(100).optional(),
    startAt: z.number().int().min(0).optional(),
    // Be robust: allow CSV string as well as array or special literals
    fields: z.union([z.literal("summary"), z.literal("all"), z.array(z.string()).nonempty(), z.string()]).optional(),
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
    // Normalize 'fields' input: accept CSV string, single string, array, or special literals.
    // Also filter pseudo-fields like 'url' that aren't Jira fields.
    const normalizeFields = (f) => {
      if (!f) return ["description"]; // default include description for previews
      if (f === "all" || f === "summary") return f;
      if (typeof f === "string") {
        if (f.includes(",")) {
          const arr = f.split(",").map((s) => s.trim()).filter(Boolean);
          return arr;
        }
        return [f.trim()].filter(Boolean);
      }
      if (Array.isArray(f)) return f;
      return ["description"];
    };
    let searchFields = normalizeFields(fields);
    // Filter out pseudo-fields and ensure description is present for previews unless fields === 'all'
    const PSEUDO = new Set(["url", "urls", "link", "links"]);
    if (Array.isArray(searchFields)) {
      searchFields = searchFields.filter((s) => s && !PSEUDO.has(String(s).toLowerCase()));
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
    if (issues.length && (includeComments || searchFields === "all" || (Array.isArray(searchFields) && (searchFields.includes("comment") || searchFields.includes("comments"))))) {
      const hydrated = [];
      for (const it of issues) {
        try {
          const key = it.key;
          const needAll = searchFields === "all";
          const needComment = includeComments || (Array.isArray(searchFields) && (searchFields.includes("comment") || searchFields.includes("comments")));
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

// List projects (minimal)
server.tool(
  "jira_list_projects",
  "Jira: List projects (search by name, paginate)",
  {
    query: z.string().optional().describe("Filter by project name"),
    startAt: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  },
  async ({ query, startAt, limit }) => {
    if (!jira) {
      const baseUrl = requireEnv("JIRA_BASE_URL");
      const email = requireEnv("JIRA_EMAIL");
      const apiToken = requireEnv("JIRA_API_TOKEN");
      jira = new JiraClient({ baseUrl, email, apiToken, defaults: {} });
    }
    const res = await jira.listProjects(query, startAt ?? 0, limit ?? 25);
    const projects = Array.isArray(res.values)
      ? res.values.map((p) => ({ id: String(p.id), key: p.key, name: p.name }))
      : [];
    const total = typeof res.total === "number" ? res.total : projects.length;
    const start = typeof res.startAt === "number" ? res.startAt : (startAt ?? 0);
    const max = typeof res.maxResults === "number" ? res.maxResults : (limit ?? 25);
    const nextStartAt = start + max < total ? start + max : undefined;
    const payload = { projects, total, startAt: start, maxResults: max, ...(nextStartAt !== undefined ? { nextStartAt } : {}) };
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  }
);

// List boards (Agile API)
server.tool(
  "jira_list_boards",
  "Jira: List boards (Agile) — filter by project, type, name",
  {
    projectKeyOrId: z.union([z.string(), z.number()]).optional(),
    type: z.string().optional().describe("scrum|kanban"),
    name: z.string().optional(),
    startAt: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  },
  async ({ projectKeyOrId, type, name, startAt, limit }) => {
    if (!jira) {
      const baseUrl = requireEnv("JIRA_BASE_URL");
      const email = requireEnv("JIRA_EMAIL");
      const apiToken = requireEnv("JIRA_API_TOKEN");
      jira = new JiraClient({ baseUrl, email, apiToken, defaults: {} });
    }
    const res = await jira.listBoards({ projectKeyOrId, type, name, startAt: startAt ?? 0, maxResults: limit ?? 25 });
    const boards = Array.isArray(res.values)
      ? res.values.map((b) => ({ id: Number(b.id), name: b.name, type: b.type, location: b.location?.projectKey || b.location?.name }))
      : [];
    const total = typeof res.total === "number" ? res.total : boards.length;
    const start = typeof res.startAt === "number" ? res.startAt : (startAt ?? 0);
    const max = typeof res.maxResults === "number" ? res.maxResults : (limit ?? 25);
    const nextStartAt = start + max < total ? start + max : undefined;
    const payload = { boards, total, startAt: start, maxResults: max, ...(nextStartAt !== undefined ? { nextStartAt } : {}) };
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  }
);

// Board issues via board filter -> JQL -> search
server.tool(
  "jira_board_issues",
  "Jira: List issues for a board (uses board filter; optional JQL append)",
  {
    boardId: z.union([z.string(), z.number()]),
    jqlAppend: z.string().optional().describe("Extra conditions, e.g., 'status != Done'"),
    startAt: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    fields: z.union([z.literal("summary"), z.literal("all"), z.array(z.string()).nonempty()]).optional(),
  },
  async ({ boardId, jqlAppend, startAt, limit, fields }) => {
    if (!jira) {
      const baseUrl = requireEnv("JIRA_BASE_URL");
      const email = requireEnv("JIRA_EMAIL");
      const apiToken = requireEnv("JIRA_API_TOKEN");
      jira = new JiraClient({ baseUrl, email, apiToken, defaults: {} });
    }
    let res;
    try {
      const filter = await jira.getBoardFilter(boardId);
      const filterId = filter?.id;
      if (filterId) {
        const baseJql = `filter = ${filterId}`;
        const jql = jqlAppend && jqlAppend.trim().length ? `(${baseJql}) AND (${jqlAppend})` : baseJql;
        res = await jira.searchIssues({ jql, startAt: startAt ?? 0, maxResults: limit ?? 25, fields: fields ?? "summary" });
      }
    } catch (_e) {
      // Fallback below
    }
    if (!res || !Array.isArray(res.issues)) {
      // Fallback to Agile endpoint directly (works for team-managed boards without a filter)
      const agile = await jira.listBoardIssues(boardId, { jql: jqlAppend, startAt: startAt ?? 0, maxResults: limit ?? 25, fields: fields ?? "summary" });
      const issues = Array.isArray(agile.issues) ? agile.issues.map((raw) => normalizeIssue(raw, process.env.JIRA_BASE_URL)) : [];
      const nextStartAt = agile.startAt + agile.maxResults < (agile.total ?? agile.startAt + issues.length) ? agile.startAt + agile.maxResults : undefined;
      const payload = { issues, total: agile.total ?? issues.length, startAt: agile.startAt, maxResults: agile.maxResults, ...(nextStartAt !== undefined ? { nextStartAt } : {}) };
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    }
    const issues = Array.isArray(res.issues) ? res.issues.map((raw) => normalizeIssue(raw, process.env.JIRA_BASE_URL)) : [];
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
