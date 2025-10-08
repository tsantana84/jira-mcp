// Minimal MCP server to validate Gemini tool listing.
// Registers a single tool: `jira_list_issues`.
// It echoes the provided JQL so you can confirm wiring end-to-end.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
// Use the built Jira client/normalizer from dist to keep this script standalone
import { JiraClient } from "../dist/jira/client.js";
import { normalizeIssue, adfToPlainText } from "../dist/jira/issues.js";
import { extractConfluenceLinks } from "../dist/jira/adf-parser.js";

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
let jiraBaseUrl = null;
let confluenceBaseUrl = null;

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
      jiraBaseUrl = requireEnv("JIRA_BASE_URL");
      const email = requireEnv("JIRA_EMAIL");
      const apiToken = requireEnv("JIRA_API_TOKEN");
      confluenceBaseUrl = process.env.CONFLUENCE_BASE_URL || `${jiraBaseUrl}/wiki`;
      jira = new JiraClient({ baseUrl: jiraBaseUrl, confluenceBaseUrl, email, apiToken, defaults: {} });
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

// get single issue
server.tool(
  "jira_get_issue",
  "Jira: Fetch a single issue by key with full details",
  {
    issueKey: z.string().min(1),
    fields: z.union([z.literal("summary"), z.literal("all"), z.array(z.string()).nonempty()]).optional()
  },
  async ({ issueKey, fields }) => {
    if (!jira) {
      jiraBaseUrl = requireEnv("JIRA_BASE_URL");
      const email = requireEnv("JIRA_EMAIL");
      const apiToken = requireEnv("JIRA_API_TOKEN");
      confluenceBaseUrl = process.env.CONFLUENCE_BASE_URL || `${jiraBaseUrl}/wiki`;
      jira = new JiraClient({ baseUrl: jiraBaseUrl, confluenceBaseUrl, email, apiToken, defaults: {} });
    }
    const raw = await jira.getIssue(issueKey, fields || "summary");
    const issue = normalizeIssue(raw, jiraBaseUrl);
    return { content: [{ type: "text", text: JSON.stringify({ issue }) }] };
  }
);

// traverse issue relationships
server.tool(
  "jira_issue_relationships",
  "Jira: Traverse issue dependency graph (blocks, blocked by, relates to, duplicates)",
  {
    issueKey: z.string().min(1),
    depth: z.number().int().min(1).max(10).default(3)
  },
  async ({ issueKey, depth }) => {
    if (!jira) {
      jiraBaseUrl = requireEnv("JIRA_BASE_URL");
      const email = requireEnv("JIRA_EMAIL");
      const apiToken = requireEnv("JIRA_API_TOKEN");
      confluenceBaseUrl = process.env.CONFLUENCE_BASE_URL || `${jiraBaseUrl}/wiki`;
      jira = new JiraClient({ baseUrl: jiraBaseUrl, confluenceBaseUrl, email, apiToken, defaults: {} });
    }

    const nodes = new Map();
    const edges = [];
    const visited = new Set();
    const visiting = new Set();
    const circularDeps = [];

    const traverse = async (key, currentDepth) => {
      if (currentDepth > depth || visited.has(key)) return;
      if (visiting.has(key)) {
        const cycle = `${key} (circular dependency detected)`;
        if (!circularDeps.includes(cycle)) circularDeps.push(cycle);
        return;
      }

      visiting.add(key);
      try {
        const raw = await jira.getIssue(key, ["summary", "status", "issuetype", "issuelinks", "description", "comment", "labels", "components", "assignee", "reporter", "priority"]);
        if (!nodes.has(key)) {
          const commentLimit = parseInt(process.env.DEPENDENCY_ANALYSIS_COMMENT_LIMIT || "5", 10);
          // extract comments (last N)
          const nodeComments = (raw?.fields?.comment?.comments || []).slice(-commentLimit).map(c => ({
            id: String(c.id ?? ""),
            author: {
              accountId: c.author?.accountId ?? "",
              displayName: c.author?.displayName ?? ""
            },
            created: c.created ?? "",
            body: adfToPlainText(c.body) || ""
          }));

          nodes.set(key, {
            key,
            summary: raw?.fields?.summary ?? "",
            status: raw?.fields?.status?.name ?? "",
            issueType: raw?.fields?.issuetype?.name ?? "",
            description: adfToPlainText(raw?.fields?.description) || undefined,
            comments: nodeComments,
            labels: raw?.fields?.labels || [],
            components: (raw?.fields?.components || []).map(c => ({
              id: String(c.id ?? ""),
              name: c.name ?? ""
            })),
            assignee: raw?.fields?.assignee ? {
              accountId: raw.fields.assignee.accountId ?? "",
              displayName: raw.fields.assignee.displayName ?? ""
            } : undefined,
            reporter: raw?.fields?.reporter ? {
              accountId: raw.fields.reporter.accountId ?? "",
              displayName: raw.fields.reporter.displayName ?? ""
            } : undefined,
            priority: raw?.fields?.priority ? {
              id: String(raw.fields.priority.id ?? ""),
              name: raw.fields.priority.name ?? ""
            } : undefined
          });
        }

        const issuelinks = raw?.fields?.issuelinks || [];
        for (const link of issuelinks) {
          let targetKey, linkType;
          if (link.outwardIssue) {
            targetKey = link.outwardIssue.key;
            linkType = link.type?.outward || "relates to";
          } else if (link.inwardIssue) {
            targetKey = link.inwardIssue.key;
            linkType = link.type?.inward || "relates to";
          }
          if (targetKey && linkType) {
            edges.push({ from: key, to: targetKey, type: linkType });
            if (currentDepth < depth) await traverse(targetKey, currentDepth + 1);
          }
        }
      } catch (err) {}
      visiting.delete(key);
      visited.add(key);
    };

    await traverse(issueKey, 1);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          nodes: Array.from(nodes.values()),
          edges,
          circular_deps: circularDeps
        })
      }]
    };
  }
);

// get changelog
server.tool(
  "jira_get_changelog",
  "Jira: Get issue changelog (status transitions, field changes, reassignments)",
  {
    issueKey: z.string().min(1),
    startAt: z.number().int().min(0).default(0),
    maxResults: z.number().int().min(1).max(100).default(100)
  },
  async ({ issueKey, startAt, maxResults }) => {
    if (!jira) {
      jiraBaseUrl = requireEnv("JIRA_BASE_URL");
      const email = requireEnv("JIRA_EMAIL");
      const apiToken = requireEnv("JIRA_API_TOKEN");
      confluenceBaseUrl = process.env.CONFLUENCE_BASE_URL || `${jiraBaseUrl}/wiki`;
      jira = new JiraClient({ baseUrl: jiraBaseUrl, confluenceBaseUrl, email, apiToken, defaults: {} });
    }

    const res = await jira.getIssueChangelog(issueKey, startAt, maxResults);
    const histories = Array.isArray(res.histories) ? res.histories.map(h => ({
      id: String(h.id),
      created: h.created,
      items: Array.isArray(h.items) ? h.items : [],
      author: h.author ? { accountId: h.author.accountId, displayName: h.author.displayName } : undefined
    })) : [];

    const nextStartAt = res.startAt + res.maxResults < res.total ? res.startAt + res.maxResults : undefined;
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          histories,
          total: res.total,
          startAt: res.startAt,
          maxResults: res.maxResults,
          ...(nextStartAt !== undefined ? { nextStartAt } : {})
        })
      }]
    };
  }
);

// get confluence page
server.tool(
  "confluence_get_page",
  "Confluence: Get page by ID (with ancestors/breadcrumbs and body content)",
  {
    pageId: z.string().min(1),
    expand: z.array(z.string()).optional()
  },
  async ({ pageId, expand }) => {
    if (!jira) {
      jiraBaseUrl = requireEnv("JIRA_BASE_URL");
      const email = requireEnv("JIRA_EMAIL");
      const apiToken = requireEnv("JIRA_API_TOKEN");
      confluenceBaseUrl = process.env.CONFLUENCE_BASE_URL || `${jiraBaseUrl}/wiki`;
      jira = new JiraClient({ baseUrl: jiraBaseUrl, confluenceBaseUrl, email, apiToken, defaults: {} });
    }

    const raw = await jira.getConfluencePage(pageId, expand);
    const bodyHtml = raw?.body?.storage?.value;
    const bodyText = bodyHtml ? bodyHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : undefined;
    const webui = raw?._links?.webui;
    const pageUrl = webui ? `${confluenceBaseUrl}${webui}` : undefined;
    const ancestors = Array.isArray(raw?.ancestors) ? raw.ancestors.map(a => ({
      id: String(a.id),
      title: a.title ?? "",
      type: a.type ?? ""
    })) : [];

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          id: String(raw?.id ?? pageId),
          type: raw?.type ?? "page",
          title: raw?.title ?? "",
          body: bodyText,
          bodyHtml,
          ancestors,
          url: pageUrl
        })
      }]
    };
  }
);

// extract confluence links from jira issue
server.tool(
  "jira_issue_confluence_links",
  "Jira: Extract Confluence page links from issue description and comments",
  {
    issueKey: z.string().min(1)
  },
  async ({ issueKey }) => {
    if (!jira) {
      jiraBaseUrl = requireEnv("JIRA_BASE_URL");
      const email = requireEnv("JIRA_EMAIL");
      const apiToken = requireEnv("JIRA_API_TOKEN");
      confluenceBaseUrl = process.env.CONFLUENCE_BASE_URL || `${jiraBaseUrl}/wiki`;
      jira = new JiraClient({ baseUrl: jiraBaseUrl, confluenceBaseUrl, email, apiToken, defaults: {} });
    }

    const raw = await jira.getIssue(issueKey, ["description", "comment"]);
    const allLinks = [];
    const seen = new Set();

    const description = raw?.fields?.description;
    if (description) {
      const descLinks = extractConfluenceLinks(description, confluenceBaseUrl);
      for (const link of descLinks) {
        if (!seen.has(link.url)) {
          seen.add(link.url);
          allLinks.push({ pageId: link.pageId, url: link.url, title: link.title });
        }
      }
    }

    const comments = raw?.fields?.comment?.comments || [];
    for (const comment of comments) {
      if (comment?.body) {
        const commentLinks = extractConfluenceLinks(comment.body, confluenceBaseUrl);
        for (const link of commentLinks) {
          if (!seen.has(link.url)) {
            seen.add(link.url);
            allLinks.push({ pageId: link.pageId, url: link.url, title: link.title });
          }
        }
      }
    }

    return { content: [{ type: "text", text: JSON.stringify({ links: allLinks }) }] };
  }
);

// extract jira keys from confluence page
server.tool(
  "confluence_page_jira_links",
  "Confluence: Extract Jira issue keys from page content (regex pattern [A-Z]+-\\d+)",
  {
    pageId: z.string().min(1),
    validate: z.boolean().default(false)
  },
  async ({ pageId, validate }) => {
    if (!jira) {
      jiraBaseUrl = requireEnv("JIRA_BASE_URL");
      const email = requireEnv("JIRA_EMAIL");
      const apiToken = requireEnv("JIRA_API_TOKEN");
      confluenceBaseUrl = process.env.CONFLUENCE_BASE_URL || `${jiraBaseUrl}/wiki`;
      jira = new JiraClient({ baseUrl: jiraBaseUrl, confluenceBaseUrl, email, apiToken, defaults: {} });
    }

    const page = await jira.getConfluencePage(pageId);
    const bodyHtml = page?.body?.storage?.value || "";
    const bodyText = bodyHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    const jiraKeyPattern = /\b([A-Z]+)-(\d+)\b/g;
    const matches = bodyText.matchAll(jiraKeyPattern);
    const issueKeys = new Set();
    for (const match of matches) {
      issueKeys.add(match[0]);
    }

    let validatedKeys = Array.from(issueKeys);
    if (validate && validatedKeys.length > 0) {
      const validated = [];
      for (const key of validatedKeys) {
        try {
          await jira.getIssue(key, "summary");
          validated.push(key);
        } catch (err) {}
      }
      validatedKeys = validated;
    }

    return { content: [{ type: "text", text: JSON.stringify({ issueKeys: validatedKeys }) }] };
  }
);

// comprehensive dependency analysis (main orchestration tool)
server.tool(
  "jira_dependency_analysis",
  "Jira: Comprehensive dependency analysis (traverses dependencies, extracts confluence docs, analyzes patterns, generates code search prompt)",
  {
    issueKey: z.string().min(1),
    depth: z.number().int().min(1).max(10).default(3)
  },
  async ({ issueKey, depth }) => {
    if (!jira) {
      jiraBaseUrl = requireEnv("JIRA_BASE_URL");
      const email = requireEnv("JIRA_EMAIL");
      const apiToken = requireEnv("JIRA_API_TOKEN");
      confluenceBaseUrl = process.env.CONFLUENCE_BASE_URL || `${jiraBaseUrl}/wiki`;
      jira = new JiraClient({ baseUrl: jiraBaseUrl, confluenceBaseUrl, email, apiToken, defaults: {} });
    }

    const startTime = new Date();

    // 1. fetch main issue with rich fields
    const commentLimit = parseInt(process.env.DEPENDENCY_ANALYSIS_COMMENT_LIMIT || "5", 10);
    const mainIssue = await jira.getIssue(issueKey, ["summary", "status", "issuetype", "created", "updated", "description", "comment", "labels", "components", "assignee", "reporter", "priority"]);

    // extract comments (last N)
    const mainComments = (mainIssue?.fields?.comment?.comments || []).slice(-commentLimit).map(c => ({
      id: String(c.id ?? ""),
      author: {
        accountId: c.author?.accountId ?? "",
        displayName: c.author?.displayName ?? ""
      },
      created: c.created ?? "",
      body: adfToPlainText(c.body) || ""
    }));

    const ticket = {
      key: issueKey,
      summary: mainIssue?.fields?.summary ?? "",
      status: mainIssue?.fields?.status?.name ?? "",
      issueType: mainIssue?.fields?.issuetype?.name ?? "",
      description: adfToPlainText(mainIssue?.fields?.description) || undefined,
      comments: mainComments,
      labels: mainIssue?.fields?.labels || [],
      components: (mainIssue?.fields?.components || []).map(c => ({
        id: String(c.id ?? ""),
        name: c.name ?? ""
      })),
      assignee: mainIssue?.fields?.assignee ? {
        accountId: mainIssue.fields.assignee.accountId ?? "",
        displayName: mainIssue.fields.assignee.displayName ?? ""
      } : undefined,
      reporter: mainIssue?.fields?.reporter ? {
        accountId: mainIssue.fields.reporter.accountId ?? "",
        displayName: mainIssue.fields.reporter.displayName ?? ""
      } : undefined,
      priority: mainIssue?.fields?.priority ? {
        id: String(mainIssue.fields.priority.id ?? ""),
        name: mainIssue.fields.priority.name ?? ""
      } : undefined
    };

    // 2. traverse dependency graph
    const nodes = new Map();
    const edges = [];
    const visited = new Set();
    const visiting = new Set();
    const circularDeps = [];

    const traverse = async (key, currentDepth) => {
      if (currentDepth > depth || visited.has(key)) return;
      if (visiting.has(key)) {
        const cycle = `${key} (circular dependency detected)`;
        if (!circularDeps.includes(cycle)) circularDeps.push(cycle);
        return;
      }

      visiting.add(key);
      try {
        const raw = await jira.getIssue(key, ["summary", "status", "issuetype", "issuelinks", "description", "comment", "labels", "components", "assignee", "reporter", "priority"]);
        if (!nodes.has(key)) {
          const commentLimit = parseInt(process.env.DEPENDENCY_ANALYSIS_COMMENT_LIMIT || "5", 10);
          // extract comments (last N)
          const nodeComments = (raw?.fields?.comment?.comments || []).slice(-commentLimit).map(c => ({
            id: String(c.id ?? ""),
            author: {
              accountId: c.author?.accountId ?? "",
              displayName: c.author?.displayName ?? ""
            },
            created: c.created ?? "",
            body: adfToPlainText(c.body) || ""
          }));

          nodes.set(key, {
            key,
            summary: raw?.fields?.summary ?? "",
            status: raw?.fields?.status?.name ?? "",
            issueType: raw?.fields?.issuetype?.name ?? "",
            description: adfToPlainText(raw?.fields?.description) || undefined,
            comments: nodeComments,
            labels: raw?.fields?.labels || [],
            components: (raw?.fields?.components || []).map(c => ({
              id: String(c.id ?? ""),
              name: c.name ?? ""
            })),
            assignee: raw?.fields?.assignee ? {
              accountId: raw.fields.assignee.accountId ?? "",
              displayName: raw.fields.assignee.displayName ?? ""
            } : undefined,
            reporter: raw?.fields?.reporter ? {
              accountId: raw.fields.reporter.accountId ?? "",
              displayName: raw.fields.reporter.displayName ?? ""
            } : undefined,
            priority: raw?.fields?.priority ? {
              id: String(raw.fields.priority.id ?? ""),
              name: raw.fields.priority.name ?? ""
            } : undefined
          });
        }

        const issuelinks = raw?.fields?.issuelinks || [];
        for (const link of issuelinks) {
          let targetKey, linkType;
          if (link.outwardIssue) {
            targetKey = link.outwardIssue.key;
            linkType = link.type?.outward || "relates to";
          } else if (link.inwardIssue) {
            targetKey = link.inwardIssue.key;
            linkType = link.type?.inward || "relates to";
          }
          if (targetKey && linkType) {
            edges.push({ from: key, to: targetKey, type: linkType });
            if (currentDepth < depth) await traverse(targetKey, currentDepth + 1);
          }
        }
      } catch (err) {}
      visiting.delete(key);
      visited.add(key);
    };

    await traverse(issueKey, 1);
    const depGraph = {
      nodes: Array.from(nodes.values()),
      edges,
      circular_deps: circularDeps
    };

    // 3. identify blockers
    const blockers = [];
    const blockerKeys = edges.filter(e => e.type.toLowerCase().includes("block")).map(e => e.to);
    for (const key of blockerKeys) {
      const node = depGraph.nodes.find(n => n.key === key);
      if (node) {
        const blockedSince = mainIssue?.fields?.created;
        const daysSince = blockedSince ? Math.floor((Date.now() - new Date(blockedSince).getTime()) / (1000 * 60 * 60 * 24)) : undefined;
        blockers.push({
          key: node.key,
          summary: node.summary,
          status: node.status,
          blocked_since: blockedSince,
          days_blocked: daysSince
        });
      }
    }

    // 4. extract confluence links
    const confluenceDocs = [];
    try {
      const raw = await jira.getIssue(issueKey, ["description", "comment"]);
      const description = raw?.fields?.description;
      const comments = raw?.fields?.comment?.comments || [];
      const allLinks = new Set();

      if (description) {
        const links = extractConfluenceLinks(description, confluenceBaseUrl);
        links.forEach(l => l.pageId && allLinks.add(l.pageId));
      }
      for (const comment of comments) {
        if (comment?.body) {
          const links = extractConfluenceLinks(comment.body, confluenceBaseUrl);
          links.forEach(l => l.pageId && allLinks.add(l.pageId));
        }
      }

      for (const pageId of allLinks) {
        try {
          const page = await jira.getConfluencePage(pageId);
          confluenceDocs.push({
            id: pageId,
            title: page.title ?? "",
            url: page._links?.webui ? `${confluenceBaseUrl}${page._links.webui}` : undefined
          });
        } catch (err) {}
      }
    } catch (err) {}

    // 5. analyze patterns
    const insights = {
      total_dependencies: depGraph.nodes.length - 1,
      blocking_chain_length: Math.max(...edges.filter(e => e.from === issueKey).map(() => 1), 0),
      avg_blocker_age_days: blockers.length > 0 ? Math.round(blockers.reduce((sum, b) => sum + (b.days_blocked || 0), 0) / blockers.length) : undefined,
      patterns: []
    };

    if (blockers.length >= 2) {
      insights.patterns.push(`multiple blockers detected (${blockers.length} issues blocking progress)`);
    }
    if (circularDeps.length > 0) {
      insights.patterns.push(`circular dependencies found: ${circularDeps.join(", ")}`);
    }
    if (insights.avg_blocker_age_days && insights.avg_blocker_age_days > 30) {
      insights.patterns.push(`long-term blockers (avg ${insights.avg_blocker_age_days} days blocked)`);
    }

    // 6. generate suggested code search prompt with rich context and github cli integration
    const descriptionSnippet = ticket.description
      ? ticket.description.slice(0, 300) + (ticket.description.length > 300 ? "..." : "")
      : "";

    const keyComments = ticket.comments
      .filter(c => c.body && c.body.length > 20)
      .slice(0, 3)
      .map(c => `  - ${c.author.displayName}: "${c.body.slice(0, 150)}${c.body.length > 150 ? "..." : ""}"`);

    const allLabels = new Set(ticket.labels);
    const allComponents = new Set(ticket.components.map(c => c.name));
    depGraph.nodes.forEach(n => {
      if (n.labels) n.labels.forEach(l => allLabels.add(l));
      if (n.components) n.components.forEach(c => allComponents.add(c.name));
    });

    // extract technical terms from descriptions/comments for targeted search
    const technicalTerms = new Set();
    const extractTerms = (text) => {
      if (!text) return;
      // extract camelcase/pascalcase identifiers (likely class/function names)
      const matches = text.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g);
      if (matches) matches.forEach(t => technicalTerms.add(t));
    };
    extractTerms(ticket.description);
    ticket.comments.forEach(c => extractTerms(c.body));
    depGraph.nodes.forEach(n => extractTerms(n.description));

    // get github context from env (with fallback placeholders)
    const githubOrg = process.env.GITHUB_ORG || "{{YOUR_GITHUB_ORG}}";
    const githubRepo = process.env.GITHUB_DEFAULT_REPO || "{{YOUR_GITHUB_REPO}}";

    // build list of all related issue keys for search
    const allIssueKeys = [ticket.key, ...depGraph.nodes.filter(n => n.key !== ticket.key).map(n => n.key)];

    const suggestedPrompt = `# code analysis for jira ticket: ${ticket.key}

## ticket context

**main ticket:** ${ticket.key} - "${ticket.summary}"
**status:** ${ticket.status} | **type:** ${ticket.issueType}
${ticket.assignee ? `**assignee:** ${ticket.assignee.displayName}` : ""}${ticket.priority ? ` | **priority:** ${ticket.priority.name}` : ""}

**description:**
${descriptionSnippet || "(no description provided)"}

${ticket.labels.length > 0 ? `**labels:** ${ticket.labels.join(", ")}` : ""}
${ticket.components.length > 0 ? `**components:** ${ticket.components.map(c => c.name).join(", ")}` : ""}

${keyComments.length > 0 ? `**key comments:**\n${keyComments.join("\n")}` : ""}

**dependencies (${depGraph.nodes.length - 1} related tickets):**
${depGraph.nodes.slice(0, 5).map(n => {
  const parts = [`- ${n.key}: "${n.summary}" (${n.status})`];
  if (n.labels && n.labels.length > 0) parts.push(`  labels: ${n.labels.join(", ")}`);
  if (n.components && n.components.length > 0) parts.push(`  components: ${n.components.map(c => c.name).join(", ")}`);
  if (n.description) {
    const snippet = n.description.slice(0, 150) + (n.description.length > 150 ? "..." : "");
    parts.push(`  desc: ${snippet}`);
  }
  return parts.join("\n");
}).join("\n")}
${depGraph.nodes.length > 5 ? `... and ${depGraph.nodes.length - 5} more` : ""}

${blockers.length > 0 ? `**blockers:**\n${blockers.map(b => `- ${b.key}: "${b.summary}" (${b.status}${b.days_blocked ? `, blocked ${b.days_blocked} days` : ""})`).join("\n")}` : ""}

${confluenceDocs.length > 0 ? `**confluence docs:**\n${confluenceDocs.map(d => `- ${d.title} (id: ${d.id})`).join("\n")}` : ""}

**technical context:**
- labels: ${Array.from(allLabels).join(", ") || "none"}
- components: ${Array.from(allComponents).join(", ") || "none"}
${technicalTerms.size > 0 ? `- extracted terms: ${Array.from(technicalTerms).slice(0, 10).join(", ")}` : ""}

---

## repository context

**primary repository:** ${githubRepo}
**organization:** ${githubOrg}

**related repositories to check:**
- database migrations: ${githubOrg}/db-migrations or ${githubOrg}/*-schema
- data ingestion/etl: ${githubOrg}/data-pipeline or ${githubOrg}/*-etl
- api consumers: search org for services using this component

---

## analysis tasks

### 1. search github for related prs and commits

**find prs mentioning jira tickets:**
\`\`\`bash
# search for prs containing issue keys
${allIssueKeys.slice(0, 3).map(key => `gh pr list --repo ${githubRepo} --search "${key}" --state all --limit 10`).join("\n")}

# for closed dependencies, review implementation patterns
${depGraph.nodes.filter(n => n.status.toLowerCase() === "closed").slice(0, 2).map(n =>
  `gh pr list --repo ${githubRepo} --search "${n.key}" --state closed --limit 5\n# then: gh pr diff <PR_NUMBER> to see how ${n.key} was implemented`
).join("\n")}
\`\`\`

**search git history:**
\`\`\`bash
# find commits mentioning issue keys
${allIssueKeys.slice(0, 2).map(key => `git log --all --grep="${key}" --oneline -20`).join("\n")}

# search for technical terms from descriptions
${Array.from(technicalTerms).slice(0, 3).map(term => `git log --all --grep="${term}" --oneline -10`).join("\n")}

# search commits by component/label keywords
${Array.from(allLabels).slice(0, 2).map(label => `git log --all --grep="${label}" --since="6 months ago" -20`).join("\n")}
\`\`\`

### 2. search codebase for technical terms

**search for class/function names from descriptions:**
\`\`\`bash
${Array.from(technicalTerms).slice(0, 5).map(term =>
  `grep -r "${term}" --include="*.java" --include="*.kt" --include="*.ts" --include="*.py" -n`
).join("\n")}
\`\`\`

**search for component-related code:**
\`\`\`bash
${Array.from(allComponents).slice(0, 3).map(comp =>
  `grep -r "${comp}" --include="*.java" --include="*.xml" --include="*.yaml" -i`
).join("\n")}
\`\`\`

**search for label-related patterns:**
\`\`\`bash
${Array.from(allLabels).slice(0, 3).map(label =>
  `grep -r "${label}" --include="*.java" --include="*.kt" -i`
).join("\n")}
\`\`\`

### 3. search organization for related repositories

**find repos with related keywords:**
\`\`\`bash
# search for repos matching components
${Array.from(allComponents).slice(0, 2).map(comp =>
  `gh search repos --owner ${githubOrg} "${comp}" --limit 10`
).join("\n")}

# search for database/schema repos
gh search repos --owner ${githubOrg} "schema OR migration OR flyway OR liquibase" --limit 10

# search for data processing repos
gh search repos --owner ${githubOrg} "pipeline OR etl OR ingestion OR kafka" --limit 10

# search for monitoring/metrics repos (if metrics label present)
${allLabels.has("metrics") || allLabels.has("monitoring") ? `gh search repos --owner ${githubOrg} "metrics OR prometheus OR grafana" --limit 10` : "# (skip - no metrics label)"}
\`\`\`

### 4. check for database/schema dependencies

\`\`\`bash
# search for migration files in current repo
find . -path "*/migrations/*" -o -path "*/flyway/*" -o -name "*migration*.sql"

# search for entity/model definitions
grep -r "@Entity\\|@Table\\|CREATE TABLE\\|ALTER TABLE" --include="*.java" --include="*.sql"

# if db changes likely, check schema repos
gh search repos --owner ${githubOrg} "database" --limit 5
\`\`\`

### 5. identify cross-service impact

\`\`\`bash
# search for api endpoint definitions (if api-related)
grep -r "@RestController\\|@RequestMapping\\|@GetMapping\\|@PostMapping" --include="*.java"

# search org for potential api consumers
gh search repos --owner ${githubOrg} "${Array.from(allComponents).slice(0, 1).join("")}-client OR ${Array.from(allComponents).slice(0, 1).join("")}-consumer" --limit 10

# check for shared libraries/sdks
gh search repos --owner ${githubOrg} "sdk OR client OR lib" --limit 10
\`\`\`

---

## output format

create a file called \`code_analysis.json\` with this structure:

\`\`\`json
{
  "jira_ticket": "${ticket.key}",
  "primary_repository": "${githubRepo}",
  "analysis_date": "<ISO timestamp>",
  "related_prs": [
    {
      "number": <pr_number>,
      "title": "...",
      "url": "...",
      "state": "open|closed|merged",
      "jira_keys": ["${ticket.key}", ...],
      "relevance": "implementation pattern | blocker resolution | similar work",
      "key_files_changed": ["path/to/file.java", ...]
    }
  ],
  "related_commits": [
    {
      "sha": "abc123...",
      "message": "...",
      "author": "...",
      "date": "...",
      "files_changed": ["..."],
      "relevance": "mentions technical term | implements similar feature"
    }
  ],
  "code_files_found": [
    {
      "path": "src/path/to/File.java",
      "relevance": "contains ${Array.from(technicalTerms).slice(0, 1).join("")} class | implements ${Array.from(allComponents).slice(0, 1).join("")}",
      "key_sections": ["line 45-60: metrics implementation", "line 120-135: error handling"],
      "last_modified": "...",
      "last_modified_by": "..."
    }
  ],
  "related_repositories": [
    {
      "name": "${githubOrg}/...",
      "url": "...",
      "reason": "database schema | api consumer | shared library",
      "potential_impact": "may need coordinated changes | dependency update required",
      "action_needed": "review for breaking changes | update version"
    }
  ],
  "database_impact": {
    "schema_changes_likely": true|false,
    "migration_files_found": ["..."],
    "affected_tables": ["..."],
    "schema_repos_to_check": ["${githubOrg}/db-migrations"]
  },
  "cross_service_dependencies": [
    {
      "service_name": "...",
      "repository": "${githubOrg}/...",
      "dependency_type": "api consumer | shared database | message queue",
      "impact": "breaking change | compatible | isolated"
    }
  ],
  "implementation_patterns": [
    {
      "source": "PR #123 (${depGraph.nodes.filter(n => n.status.toLowerCase() === "closed")[0]?.key || "related ticket"})",
      "pattern": "used micrometer for metrics | added prometheus annotations",
      "code_example": "snippet from pr diff",
      "applicable": true|false
    }
  ],
  "recommendations": [
    "follow pattern from closed PR #123 for metrics implementation",
    "coordinate with ${githubOrg}/data-pipeline team for schema changes",
    "update api version in ${githubOrg}/client-sdk after deployment"
  ]
}
\`\`\`

**important:** use actual data from your searches. if a search returns no results, note it. prioritize finding implementation patterns from closed related tickets.
`;

    const payload = {
      analysis: {
        ticket,
        dependency_graph: depGraph,
        blockers,
        confluence_docs: confluenceDocs,
        insights
      },
      suggested_prompt: suggestedPrompt,
      metadata: {
        analyzed_at: startTime.toISOString(),
        depth_traversed: depth,
        tool_version: "1.0"
      }
    };

    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
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
