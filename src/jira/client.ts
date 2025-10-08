import type { Config } from "../config.js";
import { fetch } from "undici";

type HttpMethod = "GET" | "POST" | "PUT";

const MIN_FIELDS = [
  "summary",
  "status",
  "assignee",
  "reporter",
  "priority",
  "labels",
  "project",
  "issuetype",
  "created",
  "updated",
];

export class JiraClient {
  private readonly baseUrl: string;
  private readonly confluenceBaseUrl: string;
  private readonly authHeader: string;

  constructor(cfg: Config) {
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    this.confluenceBaseUrl = cfg.confluenceBaseUrl.replace(/\/$/, "");
    const basic = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString("base64");
    this.authHeader = `Basic ${basic}`;
  }

  private async request(
    method: HttpMethod,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>
  ): Promise<any> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.set(k, String(v));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: "application/json",
    };
    const init: any = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    let attempt = 0;
    let lastErr: any;
    const maxAttempts = 3;
    while (attempt < maxAttempts) {
      try {
        const res = await fetch(url, init);
        if (res.status === 204) return null;
        if (res.ok) {
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("application/json")) {
            return await res.json();
          }
          return await res.text();
        }
        if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
          const retryAfter = res.headers.get("retry-after");
          const wait = retryAfter ? parseInt(retryAfter, 10) * 1000 : 500 * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, isFinite(wait) ? wait : 1000));
          attempt++;
          continue;
        }
        // Extract Jira error message if present
        let detail: any = undefined;
        try { detail = await res.json(); } catch {}
        throw new Error(`Jira API ${res.status} ${res.statusText}: ${JSON.stringify(detail || {})}`);
      } catch (err) {
        lastErr = err;
        attempt++;
        if (attempt >= maxAttempts) {
          throw lastErr;
        }
        await new Promise((r) => setTimeout(r, 300 * Math.pow(2, attempt)));
      }
    }
    throw lastErr ?? new Error("Unknown Jira client error");
  }

  private fieldsParam(fields?: string[] | "summary" | "all"): string | undefined {
    if (!fields) return MIN_FIELDS.join(",");
    if (fields === "all") return "*all";
    // Always ensure our minimal fields for normalization are present
    const set = new Set<string>([...MIN_FIELDS, ...fields]);
    return Array.from(set).join(",");
  }

  async searchIssues(params: {
    jql: string;
    startAt?: number;
    maxResults?: number;
    fields?: string[] | "summary" | "all";
  }): Promise<{
    startAt: number;
    maxResults: number;
    total: number;
    issues: any[];
  }> {
    const qp = {
      jql: params.jql,
      startAt: params.startAt ?? 0,
      maxResults: params.maxResults ?? 25,
      fields: this.fieldsParam(params.fields ?? "summary"),
    } as Record<string, string | number | boolean | undefined>;

    // Prefer new endpoint per Atlassian migration: /rest/api/3/search/jql
    // 1) Try GET with query params
    try {
      const data = await this.request("GET", "/rest/api/3/search/jql", undefined, qp);
      if (data && data.issues) return data;
    } catch (_e1) {
      // ignore, try POST then legacy
    }

    // 2) Try POST with JSON body (fields as array if possible)
    try {
      const fieldsParam = this.fieldsParam(params.fields ?? "summary");
      const body: any = {
        jql: params.jql,
        startAt: params.startAt ?? 0,
        maxResults: params.maxResults ?? 25,
      };
      if (fieldsParam) {
        if (fieldsParam === "*all") body.fields = ["*all"]; else body.fields = fieldsParam.split(",");
      }
      const data = await this.request("POST", "/rest/api/3/search/jql", body);
      if (data && data.issues) return data;
    } catch (_e2) {
      // ignore, try legacy as final fallback
    }

    // 3) Legacy fallback for older sites: /rest/api/3/search
    const legacy = await this.request("GET", "/rest/api/3/search", undefined, qp);
    return legacy;
  }

  async getIssue(key: string, fields?: string[] | "summary" | "all"): Promise<any> {
    const data = await this.request("GET", `/rest/api/3/issue/${encodeURIComponent(key)}`, undefined, {
      fields: this.fieldsParam(fields ?? "summary"),
    });
    return data;
  }

  async createIssue(payload: any): Promise<{ id: string; key: string; self?: string }> {
    const data = await this.request("POST", "/rest/api/3/issue", payload);
    return data;
  }

  async updateIssue(key: string, payload: any): Promise<void> {
    await this.request("PUT", `/rest/api/3/issue/${encodeURIComponent(key)}`, payload);
  }

  async addComment(key: string, payload: any): Promise<any> {
    const data = await this.request("POST", `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, payload);
    return data;
  }

  async listProjects(query?: string, startAt?: number, maxResults?: number): Promise<any> {
    const data = await this.request("GET", "/rest/api/3/project/search", undefined, {
      query,
      startAt: startAt ?? 0,
      maxResults: maxResults ?? 25,
    });
    return data;
  }

  async listTransitions(key: string): Promise<any> {
    const data = await this.request("GET", `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
    return data;
  }

  async transitionIssue(key: string, payload: any): Promise<void> {
    await this.request("POST", `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, payload);
  }

  async getIssueChangelog(key: string, startAt?: number, maxResults?: number): Promise<{
    startAt: number;
    maxResults: number;
    total: number;
    histories: Array<{ id: string; created: string; items: any[]; author?: any }>;
  }> {
    const data = await this.request(
      "GET",
      `/rest/api/3/issue/${encodeURIComponent(key)}/changelog`,
      undefined,
      { startAt: startAt ?? 0, maxResults: maxResults ?? 100 }
    );
    return data;
  }

  async listComponents(projectKeyOrId: string, startAt?: number, maxResults?: number): Promise<{
    startAt: number;
    maxResults: number;
    total: number;
    values: Array<{ id: string; name: string; description?: string; lead?: any }>;
  }> {
    const data = await this.request(
      "GET",
      `/rest/api/3/project/${encodeURIComponent(projectKeyOrId)}/component`,
      undefined,
      { startAt: startAt ?? 0, maxResults: maxResults ?? 50 }
    );
    // Some sites return an array without paging; normalize
    if (Array.isArray(data)) {
      return { startAt: 0, maxResults: data.length, total: data.length, values: data } as any;
    }
    return data;
  }

  // ----- Agile (Boards) -----
  async listBoards(params?: {
    projectKeyOrId?: string | number;
    type?: string; // scrum, kanban
    name?: string;
    startAt?: number;
    maxResults?: number;
  }): Promise<{ startAt: number; maxResults: number; total: number; values: any[] }> {
    const data = await this.request(
      "GET",
      "/rest/agile/1.0/board",
      undefined,
      {
        projectKeyOrId: params?.projectKeyOrId,
        type: params?.type,
        name: params?.name,
        startAt: params?.startAt ?? 0,
        maxResults: params?.maxResults ?? 25,
      }
    );
    return data;
  }

  async getBoardFilter(boardId: string | number): Promise<{ id: number; name?: string; jql?: string; self?: string }> {
    const data = await this.request("GET", `/rest/agile/1.0/board/${encodeURIComponent(String(boardId))}/filter`);
    return data;
  }

  async getFilter(filterId: string | number): Promise<{ id: number; name: string; jql: string; owner?: any }> {
    const data = await this.request("GET", `/rest/api/3/filter/${encodeURIComponent(String(filterId))}`);
    return data;
  }

  async listBoardIssues(
    boardId: string | number,
    params?: { jql?: string; startAt?: number; maxResults?: number; fields?: string[] | "summary" | "all" }
  ): Promise<{ startAt: number; maxResults: number; total?: number; issues: any[] }> {
    const qp: Record<string, string | number | boolean | undefined> = {
      jql: params?.jql,
      startAt: params?.startAt ?? 0,
      maxResults: params?.maxResults ?? 25,
      fields: this.fieldsParam(params?.fields ?? "summary"),
    };
    const data = await this.request(
      "GET",
      `/rest/agile/1.0/board/${encodeURIComponent(String(boardId))}/issue`,
      undefined,
      qp
    );
    return data;
  }

  // ----- Confluence -----
  async getConfluencePage(
    pageId: string,
    expand?: string[]
  ): Promise<{
    id: string;
    type: string;
    title: string;
    body?: { storage?: { value: string; representation: string } };
    ancestors?: Array<{ id: string; title: string; type: string }>;
    _links?: { webui?: string };
  }> {
    // build confluence API URL
    const url = new URL(`${this.confluenceBaseUrl}/rest/api/content/${encodeURIComponent(pageId)}`);
    const expandParams = expand && expand.length > 0 ? expand.join(",") : "body.storage,ancestors";
    url.searchParams.set("expand", expandParams);

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: "application/json",
    };

    const res = await fetch(url, { method: "GET", headers });

    if (res.status === 404) {
      throw new Error(`Confluence page not found: ${pageId}`);
    }

    if (!res.ok) {
      let detail: any = undefined;
      try { detail = await res.json(); } catch {}
      throw new Error(`Confluence API ${res.status} ${res.statusText}: ${JSON.stringify(detail || {})}`);
    }

    const data: any = await res.json();
    return data;
  }

  async searchConfluencePages(
    cql: string,
    limit?: number,
    start?: number
  ): Promise<{
    results: Array<{
      content: {
        id: string;
        type: string;
        title: string;
        space?: { key: string };
        _links?: { webui?: string };
      };
      excerpt?: string;
    }>;
    totalSize: number;
  }> {
    // build confluence search API URL
    const url = new URL(`${this.confluenceBaseUrl}/rest/api/search`);
    url.searchParams.set("cql", cql);
    if (limit) url.searchParams.set("limit", String(limit));
    if (start) url.searchParams.set("start", String(start));

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: "application/json",
    };

    const res = await fetch(url, { method: "GET", headers });

    if (!res.ok) {
      let detail: any = undefined;
      try { detail = await res.json(); } catch {}
      throw new Error(`Confluence search API ${res.status} ${res.statusText}: ${JSON.stringify(detail || {})}`);
    }

    const data: any = await res.json();
    return {
      results: data.results || [],
      totalSize: data.totalSize || 0,
    };
  }
}
