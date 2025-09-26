// Minimal Reports MCP server (Jira + Confluence only)
// Exposes composite tools:
//  - ops_daily_brief
//  - ops_shift_delta
//  - ops_jira_review_radar

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { JiraClient } from "../dist/jira/client.js";
import { normalizeIssue } from "../dist/jira/issues.js";

function requireEnv(name) { const v = process.env[name]; if (!v) throw new Error(`Missing env ${name}`); return v; }

// Confluence HTTP helper (preserves /wiki)
async function confHttp(baseUrl, email, token, path, query = {}) {
  let effectiveBase = baseUrl;
  try {
    const u = new URL(baseUrl);
    if (!/\/wiki(\/|$)/.test(u.pathname)) { u.pathname = (u.pathname.replace(/\/+$/, "") + "/wiki/"); effectiveBase = u.toString(); }
  } catch {}
  const base = effectiveBase.endsWith("/") ? effectiveBase : effectiveBase + "/";
  const url = new URL(base + String(path || "").replace(/^\/+/, ""));
  for (const [k, v] of Object.entries(query)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); }
  const res = await fetch(url.toString(), {
    headers: { "Authorization": "Basic " + Buffer.from(`${email}:${token}`).toString("base64"), "Accept": "application/json" }
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  if (!res.ok) { const msg = json?.message || json?.error || json?.errorMessages?.join?.("; ") || res.statusText; throw new Error(`Confluence API ${res.status} ${res.statusText}: ${msg}`); }
  return json;
}

function isoOrNow(v) { return v || new Date().toISOString(); }

const server = new McpServer({ name: "reports-mcp-min", version: "0.0.1" }, { capabilities: { tools: { listChanged: true }, logging: {} } });

let jira = null;
function getJira() {
  if (!jira) {
    jira = new JiraClient({ baseUrl: requireEnv("JIRA_BASE_URL"), email: requireEnv("JIRA_EMAIL"), apiToken: requireEnv("JIRA_API_TOKEN"), defaults: {} });
  }
  return jira;
}

// Schema pieces
const Iso = z.string().describe("ISO datetime");
const Projects = z.array(z.string()).optional();

function projJql(projects) { return projects && projects.length ? `project in (${projects.map((p)=>`"${p}"`).join(",")}) AND ` : ""; }

// 1) Daily Engineering Brief
server.tool(
  "ops_daily_brief",
  "Jira+Confluence: Daily brief (last 24h, summary, new issues, transitions, blocked, unassigned, decisions/ADRs)",
  {
    from: z.string().describe("ISO datetime for start of time window"),
    to: z.string().describe("ISO datetime for end of time window"),
    projects: z.array(z.string()).optional().describe("List of project keys to filter"),
    labelsBlocked: z.array(z.string()).optional().describe("Blocked labels or statuses")
  },
  async ({ from, to, projects, labelsBlocked }) => {
    const jc = getJira();
    const proj = projJql(projects);
    const blocked = labelsBlocked && labelsBlocked.length ? labelsBlocked : ["Blocked", "Impeded"];

    // Jira queries
    const newIssues = await jc.searchIssues({ jql: `${proj}created >= "${from}" AND created <= "${to}" ORDER BY created DESC`, maxResults: 50, fields: ["summary","status","assignee","created","updated"] });
    const transitioned = await jc.searchIssues({ jql: `${proj}status CHANGED DURING ("${from}","${to}") ORDER BY updated DESC`, maxResults: 50, fields: ["summary","status","assignee","updated"] });
    const blockedIssues = await jc.searchIssues({ jql: `${proj}(status CHANGED TO (${blocked.map(s=>`"${s}"`).join(",")}) DURING ("${from}","${to}") OR (status in (${blocked.map(s=>`"${s}"`).join(",")}) AND updated >= "${from}" AND updated <= "${to}")) ORDER BY updated DESC`, maxResults: 50, fields: ["summary","status","assignee","updated","labels"] });
    const unassigned = await jc.searchIssues({ jql: `${proj}assignee IS EMPTY AND updated >= "${from}" AND updated <= "${to}" ORDER BY updated DESC`, maxResults: 50, fields: ["summary","status","updated"] });

    const norm = (arr) => (arr.issues || []).map((it) => normalizeIssue(it, process.env.JIRA_BASE_URL));

    // Confluence updates (Decision/ADR)
    let conf = [];
    try {
      const cb = requireEnv("CONFLUENCE_BASE_URL");
      const ce = requireEnv("ATLASSIAN_EMAIL");
      const ct = requireEnv("ATLASSIAN_API_TOKEN");
      const cql = `lastmodified >= "${from}" AND lastmodified <= "${to}" AND label in ("Decision","ADR")`;
      const resp = await confHttp(cb, ce, ct, "/rest/api/search", { cql, limit: 25, start: 0 });
      conf = (resp?.results || []).map((r) => {
        const c = r.content; const base = c?._links?.base || ""; const web = c?._links?.webui || ""; const url = base && web ? base.replace(/\/$/, "") + (web.startsWith("/")?web:`/${web}`) : undefined;
        return { id: String(c?.id), title: c?.title, spaceKey: c?.space?.key, url, updatedAt: c?.version?.when || r?.lastModified };
      });
    } catch { /* optional */ }

    const payload = {
      window: { from, to },
      jira: {
        newIssues: norm(newIssues),
        transitions: norm(transitioned),
        blocked: norm(blockedIssues),
        unassigned: norm(unassigned)
      },
      confluence: { decisions: conf }
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  }
);

// 2) What changed since I logged off
server.tool(
  "ops_shift_delta",
  "Jira+Confluence: What changed since I logged off (window delta: transitions, new/closed bugs, blocked, runbooks/decisions)",
  {
    from: z.string().describe("ISO datetime for start of time window"),
    to: z.string().describe("ISO datetime for end of time window"),
    projects: z.array(z.string()).optional().describe("List of project keys to filter")
  },
  async ({ from, to, projects }) => {
    const jc = getJira();
    const proj = projJql(projects);
    const transitions = await jc.searchIssues({ jql: `${proj}status CHANGED DURING ("${from}","${to}") ORDER BY updated DESC`, maxResults: 50, fields: ["summary","status","priority","updated"] });
    const newBugs = await jc.searchIssues({ jql: `${proj}type = Bug AND created >= "${from}" AND created <= "${to}" ORDER BY created DESC`, maxResults: 50, fields: ["summary","status","priority","created"] });
    const closedBugs = await jc.searchIssues({ jql: `${proj}type = Bug AND status CHANGED TO (Done, Closed) DURING ("${from}","${to}") ORDER BY updated DESC`, maxResults: 50, fields: ["summary","status","priority","updated"] });
    const blocked = await jc.searchIssues({ jql: `${proj}status CHANGED TO ("Blocked","Impeded") DURING ("${from}","${to}") ORDER BY updated DESC`, maxResults: 50, fields: ["summary","status","updated"] });
    const norm = (arr) => (arr.issues || []).map((it) => normalizeIssue(it, process.env.JIRA_BASE_URL));

    // Confluence updates: runbook or decision
    let conf = [];
    try {
      const cb = requireEnv("CONFLUENCE_BASE_URL"); const ce = requireEnv("ATLASSIAN_EMAIL"); const ct = requireEnv("ATLASSIAN_API_TOKEN");
      const cql = `lastmodified >= "${from}" AND lastmodified <= "${to}" AND label in ("runbook","decision","Decision","ADR")`;
      const resp = await confHttp(cb, ce, ct, "/rest/api/search", { cql, limit: 25, start: 0 });
      conf = (resp?.results || []).map((r) => { const c = r.content; const base = c?._links?.base || ""; const web = c?._links?.webui || ""; const url = base && web ? base.replace(/\/$/, "") + (web.startsWith("/")?web:`/${web}`) : undefined; return { id: String(c?.id), title: c?.title, spaceKey: c?.space?.key, url, updatedAt: c?.version?.when || r?.lastModified }; });
    } catch {}

    const payload = { window: { from, to }, jira: { transitions: norm(transitions), newBugs: norm(newBugs), closedBugs: norm(closedBugs), blocked: norm(blocked) }, confluence: { updates: conf } };
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  }
);

// 3) PR Review Radar (Jira-only adaptation: issues stuck in review)
server.tool(
  "ops_jira_review_radar",
  "Jira: Review radar (issues waiting for review > idle threshold; in-review, code review, stale)",
  { idleHours: z.number().int().min(1).max(168).default(18), projects: Projects, statusesInReview: z.array(z.string()).optional(), limit: z.number().int().min(1).max(200).optional() },
  async ({ idleHours, projects, statusesInReview, limit }) => {
    const jc = getJira();
    const proj = projJql(projects);
    const reviewStatuses = (statusesInReview && statusesInReview.length ? statusesInReview : ["In Review","Code Review"]).map(s=>`"${s}"`).join(",");
    const cutoff = new Date(Date.now() - idleHours*60*60*1000).toISOString();
    const jql = `${proj}status in (${reviewStatuses}) AND updated <= "${cutoff}" ORDER BY updated ASC`;
    const res = await jc.searchIssues({ jql, maxResults: Math.min(limit ?? 50, 200), fields: ["summary","status","assignee","updated"] });
    const items = (res.issues || []).map((it) => {
      const n = normalizeIssue(it, process.env.JIRA_BASE_URL);
      return { key: n.key, summary: n.summary, status: n.status.name, assignee: n.assignee?.displayName, updated: n.updated, url: n.url };
    });
    return { content: [{ type: "text", text: JSON.stringify({ cutoff, items }) }] };
  }
);

async function main() { const transport = new StdioServerTransport(); await server.connect(transport); try { server.sendToolListChanged(); } catch {} }
main().catch((e)=>{ console.error("[reports-mcp-min] fatal:", e); process.exit(1); });
