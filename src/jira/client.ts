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
  private readonly authHeader: string;

  constructor(cfg: Config) {
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
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
}
