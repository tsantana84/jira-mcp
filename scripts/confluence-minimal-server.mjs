// Minimal Confluence MCP server (stdio) exposing one tool: `confluence_search_pages`.
// Auth: Atlassian Cloud email + API token (same token as Jira).
// Env required:
//   - CONFLUENCE_BASE_URL: https://<site>.atlassian.net/wiki
//   - ATLASSIAN_EMAIL
//   - ATLASSIAN_API_TOKEN

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Simple HTTP helper using global fetch (Node >=18)
async function http(baseUrl, email, token, path, query = {}) {
  // Normalize base to include '/wiki' for Confluence Cloud if missing
  let effectiveBase = baseUrl;
  try {
    const u = new URL(baseUrl);
    if (!/\/wiki(\/|$)/.test(u.pathname)) {
      u.pathname = (u.pathname.replace(/\/+$/, "") + "/wiki/");
      effectiveBase = u.toString();
    }
  } catch {}
  // Build URL without losing '/wiki' path segment. Avoid leading '/' reset.
  const base = effectiveBase.endsWith("/") ? effectiveBase : effectiveBase + "/";
  const url = new URL(base + String(path || "").replace(/^\/+/, ""));
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: {
      "Authorization": "Basic " + Buffer.from(`${email}:${token}`).toString("base64"),
      "Accept": "application/json",
    },
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  if (!res.ok) {
    const msg = json?.message || json?.error || json?.errorMessages?.join?.("; ") || res.statusText;
    const detail = JSON.stringify(json || { status: res.status, statusText: res.statusText });
    const err = new Error(`Confluence API ${res.status} ${res.statusText}: ${msg || ""}`);
    err.data = { url: url.toString(), response: detail };
    throw err;
  }
  return json;
}

// Build a human URL from content links
function buildWebUrl(content) {
  const base = content?._links?.base || "";
  const web = content?._links?.webui || "";
  if (!base || !web) return undefined;
  return base.replace(/\/$/, "") + (web.startsWith("/") ? web : `/${web}`);
}

// Basic HTML to text stripper for storage bodies (very lightweight)
function stripHtml(html) {
  if (!html) return "";
  return String(html)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const server = new McpServer(
  { name: "confluence-mcp-min", version: "0.0.1" },
  { capabilities: { tools: { listChanged: true }, logging: {} } }
);

// Tool schema
const SearchSchema = {
  cql: z.string().min(1).describe("CQL query, e.g. type=page AND space=ENG AND text ~ \"onboarding\""),
  limit: z.number().int().min(1).max(100).optional().describe("Max results (1-100), default 25"),
  start: z.number().int().min(0).optional().describe("Pagination start offset, default 0"),
  includeBody: z.boolean().optional().describe("Include full page body"),
  bodyFormat: z.enum(["storage", "atlas_doc"]).optional().describe("Body format when includeBody=true"),
  includeExcerpt: z.boolean().optional().describe("Include short text excerpt, default true"),
  types: z.array(z.enum(["page", "blogpost"]).describe("Result types")).optional().describe("Restrict types, default ['page']"),
  spaceKey: z.string().optional().describe("Convenience: space=KEY will be appended if not present in CQL"),
  maxChars: z.number().int().min(100).max(10000).optional().describe("Trim long text to N chars, default 800"),
};

server.tool(
  "confluence_search_pages",
  "Confluence: Search pages with CQL",
  SearchSchema,
  async ({ cql, limit, start, includeBody, bodyFormat, includeExcerpt, types, spaceKey, maxChars }) => {
    const baseUrl = requireEnv("CONFLUENCE_BASE_URL");
    const email = requireEnv("ATLASSIAN_EMAIL");
    const token = requireEnv("ATLASSIAN_API_TOKEN");

    // Build CQL with optional spaceKey convenience
    let finalCql = cql;
    if (spaceKey && !/\bspace\s*=\s*[\"']?\w+[\"']?/i.test(cql)) {
      finalCql = `(${cql}) AND space=${spaceKey}`;
    }
    // Restrict types (default: page)
    const typeExpr = (types && types.length ? types : ["page"]).map((t) => `type=${t}`).join(" OR ");
    if (!/\btype\s*=/.test(finalCql)) {
      finalCql = `(${finalCql}) AND (${typeExpr})`;
    }

    // Expand parameters for body
    const doBody = !!includeBody;
    const fmt = bodyFormat || "storage";
    const expand = [];
    if (doBody) expand.push(fmt === "atlas_doc" ? "content.body.atlas_doc_format" : "content.body.storage");
    expand.push("content.version", "content.space");

    const resp = await http(baseUrl, email, token, "/rest/api/search", {
      cql: finalCql,
      limit: (limit ?? 25),
      start: (start ?? 0),
      expand: expand.join(","),
    });

    const results = Array.isArray(resp?.results) ? resp.results : [];
    const out = [];
    const wantExcerpt = includeExcerpt !== false; // default true
    const trimTo = maxChars ?? 800;

    for (const r of results) {
      const c = r?.content;
      if (!c) continue;
      const id = String(c.id);
      const title = c.title || "";
      const type = c.type || "page";
      const space = c.space?.key;
      const url = buildWebUrl(c);
      const updated = c.version?.when || r?.lastModified || undefined;
      const updatedBy = c.version?.by?.displayName || r?.lastModifiedBy?.displayName || undefined;

      // excerpt from search payload or stripped from storage body
      let excerpt = r?.excerpt; // may include <em> tags
      if (excerpt && typeof excerpt === "string") excerpt = stripHtml(excerpt);
      if (wantExcerpt && !excerpt && doBody && c.body?.storage?.value) {
        excerpt = stripHtml(c.body.storage.value);
      }
      if (excerpt && excerpt.length > trimTo) excerpt = excerpt.slice(0, trimTo) + "…";

      const item = { id, type, title, spaceKey: space, url, updatedAt: updated, updatedBy, ...(excerpt ? { excerpt } : {}) };
      if (doBody) {
        if (fmt === "storage") {
          const html = c.body?.storage?.value || "";
          const text = stripHtml(html);
          item.body = { format: "storage", text: text.length > trimTo ? text.slice(0, trimTo) + "…" : text };
        } else {
          const adf = c.body?.atlas_doc_format || null;
          item.body = { format: "atlas_doc", json: adf };
        }
      }
      out.push(item);
    }

    const size = resp?.size ?? out.length;
    const startIdx = resp?._links?.start ?? start ?? 0;
    const next = resp?._links?.next; // '/wiki/rest/api/search?...&start=25'
    // Derive pagination
    let nextStart = undefined;
    if (next) {
      try { nextStart = Number(new URL(next, baseUrl).searchParams.get("start")); } catch {}
    } else if (typeof resp?.totalSize === "number" && typeof resp?.start === "number") {
      const nxt = resp.start + (limit ?? 25);
      if (nxt < resp.totalSize) nextStart = nxt;
    }

    const payload = { results: out, start: Number(startIdx) || 0, limit: limit ?? 25, ...(nextStart !== undefined ? { nextStart } : {}), hasMore: nextStart !== undefined };
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  try { server.sendToolListChanged(); } catch {}
}

main().catch((err) => {
  console.error("[confluence-mcp-min] fatal:", err);
  if (err?.data) console.error(err.data);
  process.exit(1);
});
