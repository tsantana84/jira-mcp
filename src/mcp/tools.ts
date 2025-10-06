import { z } from "zod";
import type { Config } from "../config.js";
import {
  AddCommentInput,
  AddCommentOutput,
  CreateIssueInput,
  CreateIssueOutput,
  GetIssueInput,
  GetIssueOutput,
  IssueRelationshipsInput,
  IssueRelationshipsOutput,
  IssueRelationshipNode,
  IssueRelationshipEdge,
  GetChangelogInput,
  GetChangelogOutput,
  ChangelogHistory,
  ConfluenceGetPageInput,
  ConfluenceGetPageOutput,
  ConfluenceAncestor,
  IssueConfluenceLinksInput,
  IssueConfluenceLinksOutput,
  ConfluencePageLink,
  ConfluenceJiraLinksInput,
  ConfluenceJiraLinksOutput,
  DependencyAnalysisInput,
  DependencyAnalysisOutput,
  DependencyBlocker,
  DependencyInsights,
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
import { extractConfluenceLinks } from "../jira/adf-parser.js";

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

  // get_issue
  mcp.tool(
    "jira_get_issue",
    "Jira: Fetch a single issue by key",
    GetIssueInput.shape,
    async (input: z.infer<typeof GetIssueInput>) => {
      const raw = await client.getIssue(input.issueKey, input.fields);
      const payload: z.infer<typeof GetIssueOutput> = { issue: normalizeIssue(raw, config.baseUrl) };
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    }
  );
  registeredNames.push("jira_get_issue");

  // issue_relationships
  mcp.tool(
    "jira_issue_relationships",
    "Jira: Traverse issue dependency graph (blocks, blocked by, relates to, duplicates)",
    IssueRelationshipsInput.shape,
    async (input: z.infer<typeof IssueRelationshipsInput>) => {
      const maxDepth = input.depth;
      const nodes = new Map<string, z.infer<typeof IssueRelationshipNode>>();
      const edges: z.infer<typeof IssueRelationshipEdge>[] = [];
      const visited = new Set<string>();
      const visiting = new Set<string>(); // track current path for cycle detection
      const circularDeps: string[] = [];

      const traverse = async (issueKey: string, currentDepth: number): Promise<void> => {
        if (currentDepth > maxDepth || visited.has(issueKey)) return;

        if (visiting.has(issueKey)) {
          // cycle detected
          const cycle = `${issueKey} (circular dependency detected)`;
          if (!circularDeps.includes(cycle)) circularDeps.push(cycle);
          return;
        }

        visiting.add(issueKey);

        try {
          const raw = await client.getIssue(issueKey, ["summary", "status", "issuetype", "issuelinks", "description", "comment", "labels", "components", "assignee", "reporter", "priority"]);

          // add node
          if (!nodes.has(issueKey)) {
            const commentLimit = parseInt(process.env.DEPENDENCY_ANALYSIS_COMMENT_LIMIT || "5", 10);
            const nodeComments = (raw?.fields?.comment?.comments || []).slice(-commentLimit).map((c: any) => ({
              id: String(c.id ?? ""),
              author: {
                accountId: c.author?.accountId ?? "",
                displayName: c.author?.displayName ?? "",
              },
              created: c.created ?? "",
              body: adfToPlainText(c.body) || "",
            }));

            nodes.set(issueKey, {
              key: issueKey,
              summary: raw?.fields?.summary ?? "",
              status: raw?.fields?.status?.name ?? "",
              issueType: raw?.fields?.issuetype?.name ?? "",
              description: adfToPlainText(raw?.fields?.description) || undefined,
              comments: nodeComments,
              labels: raw?.fields?.labels || [],
              components: (raw?.fields?.components || []).map((c: any) => ({
                id: String(c.id ?? ""),
                name: c.name ?? "",
              })),
              assignee: raw?.fields?.assignee ? {
                accountId: raw.fields.assignee.accountId ?? "",
                displayName: raw.fields.assignee.displayName ?? "",
              } : undefined,
              reporter: raw?.fields?.reporter ? {
                accountId: raw.fields.reporter.accountId ?? "",
                displayName: raw.fields.reporter.displayName ?? "",
              } : undefined,
              priority: raw?.fields?.priority ? {
                id: String(raw.fields.priority.id ?? ""),
                name: raw.fields.priority.name ?? "",
              } : undefined,
            });
          }

          // process issue links
          const issuelinks = raw?.fields?.issuelinks || [];
          for (const link of issuelinks) {
            let targetKey: string | undefined;
            let linkType: string | undefined;

            // jira links have either outwardIssue or inwardIssue
            if (link.outwardIssue) {
              targetKey = link.outwardIssue.key;
              linkType = link.type?.outward || "relates to";
            } else if (link.inwardIssue) {
              targetKey = link.inwardIssue.key;
              linkType = link.type?.inward || "relates to";
            }

            if (targetKey && linkType) {
              // add edge
              edges.push({
                from: issueKey,
                to: targetKey,
                type: linkType,
              });

              // recursively traverse
              if (currentDepth < maxDepth) {
                await traverse(targetKey, currentDepth + 1);
              }
            }
          }
        } catch (err) {
          // if issue fetch fails, skip it
          console.error(`failed to fetch issue ${issueKey}:`, err);
        }

        visiting.delete(issueKey);
        visited.add(issueKey);
      };

      await traverse(input.issueKey, 1);

      const payload: z.infer<typeof IssueRelationshipsOutput> = {
        nodes: Array.from(nodes.values()),
        edges,
        circular_deps: circularDeps,
      };
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    }
  );
  registeredNames.push("jira_issue_relationships");

  // get_changelog
  mcp.tool(
    "jira_get_changelog",
    "Jira: Get issue changelog (status transitions, field changes, reassignments)",
    GetChangelogInput.shape,
    async (input: z.infer<typeof GetChangelogInput>) => {
      const res = await client.getIssueChangelog(input.issueKey, input.startAt, input.maxResults);

      const histories: z.infer<typeof ChangelogHistory>[] = Array.isArray(res.histories)
        ? res.histories.map((h: any) => ({
            id: String(h.id),
            created: h.created,
            items: Array.isArray(h.items) ? h.items.map((item: any) => ({
              field: item.field,
              fieldtype: item.fieldtype,
              from: item.from,
              fromString: item.fromString,
              to: item.to,
              toString: item.toString,
            })) : [],
            author: h.author ? {
              accountId: h.author.accountId,
              displayName: h.author.displayName,
            } : undefined,
          }))
        : [];

      const nextStartAt = res.startAt + res.maxResults < res.total
        ? res.startAt + res.maxResults
        : undefined;

      const payload: z.infer<typeof GetChangelogOutput> = {
        histories,
        total: res.total,
        startAt: res.startAt,
        maxResults: res.maxResults,
        ...(nextStartAt !== undefined ? { nextStartAt } : {}),
      };

      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    }
  );
  registeredNames.push("jira_get_changelog");

  // confluence_get_page
  mcp.tool(
    "confluence_get_page",
    "Confluence: Get page by ID (with ancestors/breadcrumbs and body content)",
    ConfluenceGetPageInput.shape,
    async (input: z.infer<typeof ConfluenceGetPageInput>) => {
      const raw = await client.getConfluencePage(input.pageId, input.expand);

      // extract body content
      const bodyHtml = raw?.body?.storage?.value;
      // simple html to text conversion (strip tags)
      const bodyText = bodyHtml ? bodyHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : undefined;

      // build page URL
      const webui = raw?._links?.webui;
      const pageUrl = webui ? `${config.confluenceBaseUrl}${webui}` : undefined;

      const ancestors: z.infer<typeof ConfluenceAncestor>[] = Array.isArray(raw?.ancestors)
        ? raw.ancestors.map((a: any) => ({
            id: String(a.id),
            title: a.title ?? "",
            type: a.type ?? "",
          }))
        : [];

      const payload: z.infer<typeof ConfluenceGetPageOutput> = {
        id: String(raw?.id ?? input.pageId),
        type: raw?.type ?? "page",
        title: raw?.title ?? "",
        body: bodyText,
        bodyHtml,
        ancestors,
        url: pageUrl,
      };

      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    }
  );
  registeredNames.push("confluence_get_page");

  // jira_issue_confluence_links
  mcp.tool(
    "jira_issue_confluence_links",
    "Jira: Extract Confluence page links from issue description and comments",
    IssueConfluenceLinksInput.shape,
    async (input: z.infer<typeof IssueConfluenceLinksInput>) => {
      const raw = await client.getIssue(input.issueKey, ["description", "comment"]);

      const allLinks: z.infer<typeof ConfluencePageLink>[] = [];
      const seen = new Set<string>();

      // extract from description
      const description = raw?.fields?.description;
      if (description) {
        const descLinks = extractConfluenceLinks(description, config.confluenceBaseUrl);
        for (const link of descLinks) {
          if (!seen.has(link.url)) {
            seen.add(link.url);
            allLinks.push({
              pageId: link.pageId,
              url: link.url,
              title: link.title,
            });
          }
        }
      }

      // extract from comments
      const comments = raw?.fields?.comment?.comments || [];
      for (const comment of comments) {
        const body = comment?.body;
        if (body) {
          const commentLinks = extractConfluenceLinks(body, config.confluenceBaseUrl);
          for (const link of commentLinks) {
            if (!seen.has(link.url)) {
              seen.add(link.url);
              allLinks.push({
                pageId: link.pageId,
                url: link.url,
                title: link.title,
              });
            }
          }
        }
      }

      const payload: z.infer<typeof IssueConfluenceLinksOutput> = {
        links: allLinks,
      };

      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    }
  );
  registeredNames.push("jira_issue_confluence_links");

  // confluence_page_jira_links
  mcp.tool(
    "confluence_page_jira_links",
    "Confluence: Extract Jira issue keys from page content (regex pattern [A-Z]+-\\d+)",
    ConfluenceJiraLinksInput.shape,
    async (input: z.infer<typeof ConfluenceJiraLinksInput>) => {
      const page = await client.getConfluencePage(input.pageId);

      // extract text from body
      const bodyHtml = page?.body?.storage?.value || "";
      const bodyText = bodyHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

      // regex pattern for jira issue keys: [A-Z]+-\d+
      const jiraKeyPattern = /\b([A-Z]+)-(\d+)\b/g;
      const matches = bodyText.matchAll(jiraKeyPattern);

      const issueKeys = new Set<string>();
      for (const match of matches) {
        issueKeys.add(match[0]);
      }

      let validatedKeys = Array.from(issueKeys);

      // optional validation: check if issues exist
      if (input.validate && validatedKeys.length > 0) {
        const validated: string[] = [];
        for (const key of validatedKeys) {
          try {
            await client.getIssue(key, "summary");
            validated.push(key);
          } catch (err) {
            // issue doesn't exist or not accessible, skip it
          }
        }
        validatedKeys = validated;
      }

      const payload: z.infer<typeof ConfluenceJiraLinksOutput> = {
        issueKeys: validatedKeys,
      };

      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    }
  );
  registeredNames.push("confluence_page_jira_links");

  // jira_dependency_analysis (main orchestration tool)
  mcp.tool(
    "jira_dependency_analysis",
    "Jira: Comprehensive dependency analysis (traverses dependencies, extracts confluence docs, analyzes patterns, generates code search prompt)",
    DependencyAnalysisInput.shape,
    async (input: z.infer<typeof DependencyAnalysisInput>) => {
      const startTime = new Date();

      // 1. fetch main issue with rich fields
      const commentLimit = parseInt(process.env.DEPENDENCY_ANALYSIS_COMMENT_LIMIT || "5", 10);
      const mainIssue = await client.getIssue(input.issueKey, ["summary", "status", "issuetype", "created", "updated", "description", "comment", "labels", "components", "assignee", "reporter", "priority"]);

      // extract comments (last N)
      const mainComments = (mainIssue?.fields?.comment?.comments || []).slice(-commentLimit).map((c: any) => ({
        id: String(c.id ?? ""),
        author: {
          accountId: c.author?.accountId ?? "",
          displayName: c.author?.displayName ?? "",
        },
        created: c.created ?? "",
        body: adfToPlainText(c.body) || "",
      }));

      const ticket = {
        key: input.issueKey,
        summary: mainIssue?.fields?.summary ?? "",
        status: mainIssue?.fields?.status?.name ?? "",
        issueType: mainIssue?.fields?.issuetype?.name ?? "",
        description: adfToPlainText(mainIssue?.fields?.description) || undefined,
        comments: mainComments,
        labels: mainIssue?.fields?.labels || [],
        components: (mainIssue?.fields?.components || []).map((c: any) => ({
          id: String(c.id ?? ""),
          name: c.name ?? "",
        })),
        assignee: mainIssue?.fields?.assignee ? {
          accountId: mainIssue.fields.assignee.accountId ?? "",
          displayName: mainIssue.fields.assignee.displayName ?? "",
        } : undefined,
        reporter: mainIssue?.fields?.reporter ? {
          accountId: mainIssue.fields.reporter.accountId ?? "",
          displayName: mainIssue.fields.reporter.displayName ?? "",
        } : undefined,
        priority: mainIssue?.fields?.priority ? {
          id: String(mainIssue.fields.priority.id ?? ""),
          name: mainIssue.fields.priority.name ?? "",
        } : undefined,
      };

      // 2. traverse dependency graph
      const depGraph = await (async () => {
        const nodes = new Map<string, z.infer<typeof IssueRelationshipNode>>();
        const edges: z.infer<typeof IssueRelationshipEdge>[] = [];
        const visited = new Set<string>();
        const visiting = new Set<string>();
        const circularDeps: string[] = [];

        const traverse = async (issueKey: string, currentDepth: number): Promise<void> => {
          if (currentDepth > input.depth || visited.has(issueKey)) return;
          if (visiting.has(issueKey)) {
            const cycle = `${issueKey} (circular dependency detected)`;
            if (!circularDeps.includes(cycle)) circularDeps.push(cycle);
            return;
          }

          visiting.add(issueKey);
          try {
            const raw = await client.getIssue(issueKey, ["summary", "status", "issuetype", "issuelinks", "description", "comment", "labels", "components", "assignee", "reporter", "priority"]);
            if (!nodes.has(issueKey)) {
              // extract comments (last N)
              const nodeComments = (raw?.fields?.comment?.comments || []).slice(-commentLimit).map((c: any) => ({
                id: String(c.id ?? ""),
                author: {
                  accountId: c.author?.accountId ?? "",
                  displayName: c.author?.displayName ?? "",
                },
                created: c.created ?? "",
                body: adfToPlainText(c.body) || "",
              }));

              nodes.set(issueKey, {
                key: issueKey,
                summary: raw?.fields?.summary ?? "",
                status: raw?.fields?.status?.name ?? "",
                issueType: raw?.fields?.issuetype?.name ?? "",
                description: adfToPlainText(raw?.fields?.description) || undefined,
                comments: nodeComments,
                labels: raw?.fields?.labels || [],
                components: (raw?.fields?.components || []).map((c: any) => ({
                  id: String(c.id ?? ""),
                  name: c.name ?? "",
                })),
                assignee: raw?.fields?.assignee ? {
                  accountId: raw.fields.assignee.accountId ?? "",
                  displayName: raw.fields.assignee.displayName ?? "",
                } : undefined,
                reporter: raw?.fields?.reporter ? {
                  accountId: raw.fields.reporter.accountId ?? "",
                  displayName: raw.fields.reporter.displayName ?? "",
                } : undefined,
                priority: raw?.fields?.priority ? {
                  id: String(raw.fields.priority.id ?? ""),
                  name: raw.fields.priority.name ?? "",
                } : undefined,
              });
            }

            const issuelinks = raw?.fields?.issuelinks || [];
            for (const link of issuelinks) {
              let targetKey: string | undefined;
              let linkType: string | undefined;
              if (link.outwardIssue) {
                targetKey = link.outwardIssue.key;
                linkType = link.type?.outward || "relates to";
              } else if (link.inwardIssue) {
                targetKey = link.inwardIssue.key;
                linkType = link.type?.inward || "relates to";
              }
              if (targetKey && linkType) {
                edges.push({ from: issueKey, to: targetKey, type: linkType });
                if (currentDepth < input.depth) {
                  await traverse(targetKey, currentDepth + 1);
                }
              }
            }
          } catch (err) {}
          visiting.delete(issueKey);
          visited.add(issueKey);
        };

        await traverse(input.issueKey, 1);
        return {
          nodes: Array.from(nodes.values()),
          edges,
          circular_deps: circularDeps,
        };
      })();

      // 3. identify blockers and analyze changelog
      const blockers: z.infer<typeof DependencyBlocker>[] = [];
      const blockerKeys = depGraph.edges
        .filter((e) => e.type.toLowerCase().includes("block"))
        .map((e) => e.to);

      for (const key of blockerKeys) {
        const node = depGraph.nodes.find((n) => n.key === key);
        if (node) {
          try {
            const changelog = await client.getIssueChangelog(key, 0, 100);
            // find when issue entered "blocked" status or when blocking link was created
            const blockedSince = mainIssue?.fields?.created;
            const daysSince = blockedSince
              ? Math.floor((Date.now() - new Date(blockedSince).getTime()) / (1000 * 60 * 60 * 24))
              : undefined;

            blockers.push({
              key: node.key,
              summary: node.summary,
              status: node.status,
              blocked_since: blockedSince,
              days_blocked: daysSince,
            });
          } catch (err) {}
        }
      }

      // 4. extract confluence links
      const confluenceDocs: Array<{ id: string; title: string; url?: string }> = [];
      try {
        const raw = await client.getIssue(input.issueKey, ["description", "comment"]);
        const description = raw?.fields?.description;
        const comments = raw?.fields?.comment?.comments || [];

        const allLinks = new Set<string>();
        if (description) {
          const links = extractConfluenceLinks(description, config.confluenceBaseUrl);
          links.forEach((l) => l.pageId && allLinks.add(l.pageId));
        }
        for (const comment of comments) {
          if (comment?.body) {
            const links = extractConfluenceLinks(comment.body, config.confluenceBaseUrl);
            links.forEach((l) => l.pageId && allLinks.add(l.pageId));
          }
        }

        // fetch page details
        for (const pageId of allLinks) {
          try {
            const page = await client.getConfluencePage(pageId);
            confluenceDocs.push({
              id: pageId,
              title: page.title ?? "",
              url: page._links?.webui ? `${config.confluenceBaseUrl}${page._links.webui}` : undefined,
            });
          } catch (err) {}
        }
      } catch (err) {}

      // 5. analyze patterns and insights
      const insights: z.infer<typeof DependencyInsights> = {
        total_dependencies: depGraph.nodes.length - 1, // exclude main issue
        blocking_chain_length: Math.max(
          ...depGraph.edges
            .filter((e) => e.from === input.issueKey)
            .map(() => 1),
          0
        ),
        avg_blocker_age_days:
          blockers.length > 0
            ? Math.round(
                blockers.reduce((sum, b) => sum + (b.days_blocked || 0), 0) / blockers.length
              )
            : undefined,
        patterns: [],
      };

      // detect patterns
      if (blockers.length >= 2) {
        insights.patterns.push(`multiple blockers detected (${blockers.length} issues blocking progress)`);
      }
      if (depGraph.circular_deps.length > 0) {
        insights.patterns.push(`circular dependencies found: ${depGraph.circular_deps.join(", ")}`);
      }
      if (insights.avg_blocker_age_days && insights.avg_blocker_age_days > 30) {
        insights.patterns.push(`long-term blockers (avg ${insights.avg_blocker_age_days} days blocked)`);
      }

      // 6. generate suggested code search prompt with rich context and github cli integration
      const descriptionSnippet = ticket.description
        ? ticket.description.slice(0, 300) + (ticket.description.length > 300 ? "..." : "")
        : "";

      const keyComments = ticket.comments
        .filter((c: any) => c.body && c.body.length > 20)
        .slice(0, 3)
        .map((c: any) => `  - ${c.author.displayName}: "${c.body.slice(0, 150)}${c.body.length > 150 ? "..." : ""}"`);

      const allLabels = new Set<string>(ticket.labels);
      const allComponents = new Set<string>(ticket.components.map((c: any) => c.name));
      depGraph.nodes.forEach((n: any) => {
        n.labels?.forEach((l: string) => allLabels.add(l));
        n.components?.forEach((c: any) => allComponents.add(c.name));
      });

      // extract technical terms from descriptions/comments for targeted search
      const technicalTerms = new Set<string>();
      const extractTerms = (text: string | undefined) => {
        if (!text) return;
        // extract camelcase/pascalcase identifiers (likely class/function names)
        const matches = text.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g);
        if (matches) matches.forEach(t => technicalTerms.add(t));
      };
      extractTerms(ticket.description);
      ticket.comments.forEach((c: any) => extractTerms(c.body));
      depGraph.nodes.forEach((n: any) => extractTerms(n.description));

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
${ticket.components.length > 0 ? `**components:** ${ticket.components.map((c: any) => c.name).join(", ")}` : ""}

${keyComments.length > 0 ? `**key comments:**\n${keyComments.join("\n")}` : ""}

**dependencies (${depGraph.nodes.length - 1} related tickets):**
${depGraph.nodes.slice(0, 5).map((n: any) => {
  const parts = [`- ${n.key}: "${n.summary}" (${n.status})`];
  if (n.labels && n.labels.length > 0) parts.push(`  labels: ${n.labels.join(", ")}`);
  if (n.components && n.components.length > 0) parts.push(`  components: ${n.components.map((c: any) => c.name).join(", ")}`);
  if (n.description) {
    const snippet = n.description.slice(0, 150) + (n.description.length > 150 ? "..." : "");
    parts.push(`  desc: ${snippet}`);
  }
  return parts.join("\n");
}).join("\n")}
${depGraph.nodes.length > 5 ? `... and ${depGraph.nodes.length - 5} more` : ""}

${blockers.length > 0 ? `**blockers:**\n${blockers.map((b) => `- ${b.key}: "${b.summary}" (${b.status}${b.days_blocked ? `, blocked ${b.days_blocked} days` : ""})`).join("\n")}` : ""}

${confluenceDocs.length > 0 ? `**confluence docs:**\n${confluenceDocs.map((d) => `- ${d.title} (id: ${d.id})`).join("\n")}` : ""}

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

      const payload: z.infer<typeof DependencyAnalysisOutput> = {
        analysis: {
          ticket,
          dependency_graph: depGraph,
          blockers,
          confluence_docs: confluenceDocs,
          insights,
        },
        suggested_prompt: suggestedPrompt,
        metadata: {
          analyzed_at: startTime.toISOString(),
          depth_traversed: input.depth,
          tool_version: "1.0",
        },
      };

      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    }
  );
  registeredNames.push("jira_dependency_analysis");

  // Return early: write operations are intentionally disabled (out of scope for dependency analysis)
  (mcp as any)._registeredToolNames = registeredNames.slice();
  return registeredNames;

  // create_issue (disabled - write operation)
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
