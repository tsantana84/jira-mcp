import { z } from "zod";
import type { Config } from "../config.js";
import {
  AddCommentInput,
  AddCommentOutput,
  CreateIssueInput,
  CreateIssueOutput,
  GetIssueInput,
  GetIssueOutput,
  ListProjectsInput,
  ListProjectsOutput,
  ListTransitionsInput,
  ListTransitionsOutput,
  SearchIssuesInput,
  SearchIssuesOutput,
  UpdateIssueInput,
  UpdateIssueOutput,
  TransitionIssueInput,
  TransitionIssueOutput,
} from "../schemas.js";
import { adfToPlainText, normalizeIssue, toADF } from "../jira/issues.js";
import { JiraClient } from "../jira/client.js";

// The concrete SDK McpServer type is not imported to keep this skeleton flexible
type Mcp = any;

export function registerTools(mcp: Mcp, config: Config) {
  const client = new JiraClient(config);
  const registeredNames: string[] = [];

  // Expose only a single list/search tool
  mcp.tool(
    "jira_list_issues",
    "Jira: List/search issues via JQL",
    SearchIssuesInput.shape,
    async (input: z.infer<typeof SearchIssuesInput>) => {
      const res = await client.searchIssues({ jql: input.jql, startAt: input.startAt, maxResults: input.limit, fields: input.fields });
      const issues = Array.isArray(res.issues) ? res.issues.map((raw: any) => normalizeIssue(raw, config.baseUrl)) : [];
      const nextStartAt = res.startAt + res.maxResults < res.total ? res.startAt + res.maxResults : undefined;
      const payload: z.infer<typeof SearchIssuesOutput> = { issues, total: res.total, startAt: res.startAt, maxResults: res.maxResults, ...(nextStartAt !== undefined ? { nextStartAt } : {}) } as any;
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    }
  );
  registeredNames.push("jira_list_issues");

  // Also expose project listing
  mcp.tool(
    "jira_list_projects",
    "Jira: List projects",
    ListProjectsInput.shape,
    async (input: z.infer<typeof ListProjectsInput>) => {
      const res = await client.listProjects(input.query, input.startAt, input.limit);
      const projects = Array.isArray(res.values)
        ? res.values.map((p: any) => ({ id: String(p.id), key: p.key, name: p.name }))
        : [];
      const total = typeof res.total === "number" ? res.total : projects.length;
      const startAt = typeof res.startAt === "number" ? res.startAt : input.startAt ?? 0;
      const maxResults = typeof res.maxResults === "number" ? res.maxResults : input.limit ?? 25;
      const nextStartAt = startAt + maxResults < total ? startAt + maxResults : undefined;
      const payload: z.infer<typeof ListProjectsOutput> = { projects, total, startAt, maxResults, ...(nextStartAt !== undefined ? { nextStartAt } : {}) } as any;
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    }
  );
  registeredNames.push("jira_list_projects");

  // Return early: do not expose any other tools
  (mcp as any)._registeredToolNames = registeredNames.slice();
  return registeredNames;

  // get_issue
  mcp.registerTool(
    "jira_get_issue",
    { description: "Jira: Fetch a single issue by key", inputSchema: GetIssueInput.shape },
    async (input: z.infer<typeof GetIssueInput>) => {
      const raw = await client.getIssue(input.issueKey, input.fields);
      const payload: z.infer<typeof GetIssueOutput> = { issue: normalizeIssue(raw, config.baseUrl) };
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    }
  );
  registeredNames.push("jira_get_issue");

  // create_issue
  mcp.registerTool(
    "jira_create_issue",
    { description: "Jira: Create a new issue", inputSchema: CreateIssueInput.shape },
    async (input: z.infer<typeof CreateIssueInput>) => {
      const projectKey = input.projectKey || config.defaults.projectKey || "";
      const issueType = input.issueType || config.defaults.issueType || "Task";
      const body = {
        fields: {
          ...(projectKey ? { project: { key: projectKey } } : {}),
          issuetype: { name: issueType },
          summary: input.summary,
          ...(input.description ? { description: toADF(input.description) } : {}),
          ...(input.fields || {}),
        },
      };

      if (!input.confirm) {
        const preview: z.infer<typeof CreateIssueOutput> = { preview: true, request: { method: "POST", path: "/rest/api/3/issue", body }, hint: "Set confirm=true to create the issue." } as any;
        return { content: [{ type: "text", text: JSON.stringify(preview) }] };
      }

      const created = await client.createIssue(body);
      const raw = await client.getIssue(created.key, "summary");
      const payload: z.infer<typeof CreateIssueOutput> = { issue: normalizeIssue(raw, config.baseUrl) } as any;
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
  );
  registeredNames.push("jira_create_issue");

  // update_issue
  mcp.registerTool(
    "jira_update_issue",
    { description: "Jira: Update an existing issue", inputSchema: UpdateIssueInput.shape },
    async (input: z.infer<typeof UpdateIssueInput>) => {
      const issueKey = input.issueKey;
      const body = {
        fields: {
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          ...(input.description !== undefined ? { description: toADF(input.description) } : {}),
          ...(input.fields || {}),
        },
      };

      if (!input.confirm) {
        const preview: z.infer<typeof UpdateIssueOutput> = { preview: true, request: { method: "PUT", path: `/rest/api/3/issue/${issueKey}`, body } } as any;
        return { content: [{ type: "text", text: JSON.stringify(preview) }] };
      }

      await client.updateIssue(issueKey, body);
      const raw = await client.getIssue(issueKey, "summary");
      const payload: z.infer<typeof UpdateIssueOutput> = { issue: normalizeIssue(raw, config.baseUrl) } as any;
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
  );
  registeredNames.push("jira_update_issue");

  // add_comment
  mcp.registerTool(
    "jira_add_comment",
    { description: "Jira: Add a comment to an issue", inputSchema: AddCommentInput.shape },
    async (input: z.infer<typeof AddCommentInput>) => {
      const body = { body: toADF(input.body) };
      if (!input.confirm) {
        const preview: z.infer<typeof AddCommentOutput> = { preview: true, request: { method: "POST", path: `/rest/api/3/issue/${input.issueKey}/comment`, body }, hint: "Set confirm=true to add the comment." } as any;
        return { content: [{ type: "text", text: JSON.stringify(preview) }] };
      }
      const raw = await client.addComment(input.issueKey, body);
      const payload: z.infer<typeof AddCommentOutput> = {
        comment: {
          id: String(raw?.id ?? "0"),
          author: { accountId: raw?.author?.accountId ?? "", displayName: raw?.author?.displayName ?? "" },
          created: raw?.created ?? new Date().toISOString(),
          body: adfToPlainText(raw?.body) || input.body,
        },
      } as any;
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
  );
  registeredNames.push("jira_add_comment");

  // list_projects
  mcp.registerTool(
    "jira_list_projects",
    { description: "Jira: List projects", inputSchema: ListProjectsInput.shape },
    async (input: z.infer<typeof ListProjectsInput>) => {
      const res = await client.listProjects(input.query, input.startAt, input.limit);
      const projects = Array.isArray(res.values)
        ? res.values.map((p: any) => ({ id: String(p.id), key: p.key, name: p.name }))
        : [];
      const total = typeof res.total === "number" ? res.total : projects.length;
      const startAt = typeof res.startAt === "number" ? res.startAt : input.startAt ?? 0;
      const maxResults = typeof res.maxResults === "number" ? res.maxResults : input.limit ?? 25;
      const nextStartAt = startAt + maxResults < total ? startAt + maxResults : undefined;
      const payload: z.infer<typeof ListProjectsOutput> = { projects, total, startAt, maxResults, ...(nextStartAt !== undefined ? { nextStartAt } : {}) } as any;
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    }
  );
  registeredNames.push("jira_list_projects");

  // list_transitions
  mcp.registerTool(
    "jira_list_transitions",
    { description: "Jira: List valid transitions for an issue", inputSchema: ListTransitionsInput.shape },
    async (input: z.infer<typeof ListTransitionsInput>) => {
      const res = await client.listTransitions(input.issueKey);
      const transitions = Array.isArray(res.transitions)
        ? res.transitions.map((t: any) => ({
            id: String(t.id),
            name: t.name,
            to: {
              id: String(t.to?.id ?? ""),
              name: t.to?.name ?? "",
              statusCategory: {
                key: t.to?.statusCategory?.key ?? "",
                name: t.to?.statusCategory?.name ?? "",
              },
            },
          }))
        : [];
      const payload: z.infer<typeof ListTransitionsOutput> = { transitions };
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    }
  );
  registeredNames.push("jira_list_transitions");

  // transition_issue
  mcp.registerTool(
    "jira_transition_issue",
    { description: "Jira: Perform a workflow transition on an issue", inputSchema: TransitionIssueInput.shape },
    async (input: z.infer<typeof TransitionIssueInput>) => {
      // For preview, do not resolve transition names to avoid network calls
      if (!input.confirm) {
        const previewPayload: any = {
          transition: { id: input.transition },
          ...(input.resolution ? { fields: { resolution: { name: input.resolution } } } : {}),
        };
        const preview: z.infer<typeof TransitionIssueOutput> = { preview: true, request: { method: "POST", path: `/rest/api/3/issue/${input.issueKey}/transitions`, body: previewPayload }, hint: "Set confirm=true to transition." } as any;
        return { content: [{ type: "text", text: JSON.stringify(preview) }] };
      }

      // Resolve transition id if a name was provided (execute path)
      let transitionId = input.transition;
      const list = await client.listTransitions(input.issueKey);
      if (Array.isArray(list.transitions)) {
        const found = list.transitions.find(
          (t: any) => t.id === input.transition || (t.name && t.name.toLowerCase() === input.transition.toLowerCase())
        );
        if (found) transitionId = String(found.id);
      }
      const payload: any = {
        transition: { id: transitionId },
        ...(input.resolution ? { fields: { resolution: { name: input.resolution } } } : {}),
      };

      await client.transitionIssue(input.issueKey, payload);
      const raw = await client.getIssue(input.issueKey, "summary");
      const result: z.infer<typeof TransitionIssueOutput> = { issue: normalizeIssue(raw, config.baseUrl) } as any;
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );
  registeredNames.push("jira_transition_issue");

  (mcp as any)._registeredToolNames = registeredNames.slice();
  return registeredNames;
}

export function registerResources(_mcp: Mcp, _config: Config) {
  // Placeholder for future resource registration
  // Example (SDK API subject to change):
  // server.resource?.("jira://issue/{key}", { input: Resource_IssueInput }, async ({ input }) => { ... })
}

export function registerPrompts(_mcp: Mcp, _config: Config) {
  // Placeholder for helper prompts (e.g., Create/Transition flows)
}
