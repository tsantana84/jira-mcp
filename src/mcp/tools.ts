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
  ConfluenceSearchPagesInput,
  ConfluenceSearchPagesOutput,
  ConfluenceSearchResult,
  DependencyAnalysisInput,
  DependencyAnalysisOutput,
  DependencyBlocker,
  DependencyInsights,
  FindSimilarTicketsInput,
  FindSimilarTicketsOutput,
  SimilarTicket,
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

  // confluence_search_pages
  mcp.tool(
    "confluence_search_pages",
    "Confluence: Search pages using CQL (Confluence Query Language) - find pages by text, title, labels, space",
    ConfluenceSearchPagesInput.shape,
    async (input: z.infer<typeof ConfluenceSearchPagesInput>) => {
      const res = await client.searchConfluencePages(input.cql, input.limit, input.start);

      const results: z.infer<typeof ConfluenceSearchResult>[] = res.results.map((r: any) => {
        const content = r.content || {};
        const webui = content._links?.webui;
        const url = webui ? `${config.confluenceBaseUrl}${webui}` : undefined;

        // simple html stripping for excerpt
        let excerpt = r.excerpt;
        if (excerpt && typeof excerpt === "string") {
          excerpt = excerpt.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
          if (excerpt.length > 300) excerpt = excerpt.slice(0, 300) + "...";
        }

        return {
          id: String(content.id || ""),
          title: content.title || "",
          type: content.type || "page",
          excerpt,
          url,
          spaceKey: content.space?.key,
        };
      });

      const payload: z.infer<typeof ConfluenceSearchPagesOutput> = {
        results,
        totalSize: res.totalSize,
        start: input.start,
        limit: input.limit,
      };

      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    }
  );
  registeredNames.push("confluence_search_pages");

  // jira_dependency_analysis (main orchestration tool)
  mcp.tool(
    "jira_dependency_analysis",
    "Jira: Comprehensive dependency analysis (traverses dependencies, extracts confluence docs, analyzes patterns, generates code search prompt). Set autoDiscover=true to automatically search for similar tickets and confluence docs when ticket is sparse.",
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

      // 5b. auto-discover context if enabled and ticket is sparse
      let contextDiscovery: z.infer<typeof DependencyAnalysisOutput>["analysis"]["context_discovery"] = undefined;

      if (input.autoDiscover) {
        // detect if ticket is sparse (lacks context)
        const isSparseTicket =
          ticket.components.length === 0 || // no components
          !ticket.description || ticket.description.length < 50 || // minimal/missing description
          ticket.labels.length === 0; // no labels

        if (isSparseTicket) {
          const similarTicketsResults: z.infer<typeof SimilarTicket>[] = [];
          const confluenceResults: z.infer<typeof ConfluenceSearchResult>[] = [];

          // extract keywords for discovery (reuse logic from later in this function)
          const discoveryKeywords = new Set<string>();
          const extractDiscoveryTerms = (text: string | undefined) => {
            if (!text) return;
            const acronyms = text.match(/\b[A-Z]{2,}\b/g);
            if (acronyms) acronyms.forEach(a => {
              if (a.length >= 2 && a.length <= 8) discoveryKeywords.add(a);
            });
            const domainTerms = text.match(/\b(provider|service|controller|repository|handler|processor|manager|client|server|api|endpoint|queue|stream|pipeline|migration|schema|database|metrics|monitoring)\b/gi);
            if (domainTerms) domainTerms.forEach(d => discoveryKeywords.add(d.toLowerCase()));
          };
          extractDiscoveryTerms(ticket.summary);
          extractDiscoveryTerms(ticket.description);

          // search for similar tickets (if we have keywords)
          if (discoveryKeywords.size > 0) {
            try {
              const topKeywords = Array.from(discoveryKeywords).slice(0, 3);
              for (const kw of topKeywords) {
                const res = await client.searchIssues({
                  jql: `text ~ "${kw}" AND status = Closed ORDER BY updated DESC`,
                  startAt: 0,
                  maxResults: 5,
                  fields: ["summary", "status", "labels", "components"],
                });

                const issues = Array.isArray(res.issues) ? res.issues : [];
                for (const issue of issues) {
                  const key = issue.key;
                  if (key === input.issueKey) continue; // skip self

                  // check if already added
                  if (!similarTicketsResults.find(t => t.key === key)) {
                    similarTicketsResults.push({
                      key,
                      summary: issue.fields?.summary ?? "",
                      status: issue.fields?.status?.name ?? "",
                      matchReason: `keyword: ${kw}`,
                      confidenceScore: 0.7,
                      labels: issue.fields?.labels || [],
                      components: (issue.fields?.components || []).map((c: any) => ({
                        id: String(c.id ?? ""),
                        name: c.name ?? "",
                      })),
                    });
                  }
                }
              }
            } catch (err) {
              // if search fails, continue without it
              console.error("auto-discovery: similar tickets search failed:", err);
            }

            // search confluence (if we have keywords)
            try {
              const topKeywords = Array.from(discoveryKeywords).slice(0, 2);
              for (const kw of topKeywords) {
                const cqlQuery = `text ~ "${kw}" AND (title ~ "architecture" OR title ~ "setup" OR title ~ "runbook")`;
                const res = await client.searchConfluencePages(cqlQuery, 3, 0);

                for (const r of res.results) {
                  const content = r.content || {};
                  const webui = content._links?.webui;
                  const url = webui ? `${config.confluenceBaseUrl}${webui}` : undefined;

                  // simple html stripping for excerpt
                  let excerpt = r.excerpt;
                  if (excerpt && typeof excerpt === "string") {
                    excerpt = excerpt.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
                    if (excerpt.length > 200) excerpt = excerpt.slice(0, 200) + "...";
                  }

                  confluenceResults.push({
                    id: String(content.id || ""),
                    title: content.title || "",
                    type: content.type || "page",
                    excerpt,
                    url,
                    spaceKey: content.space?.key,
                  });
                }
              }
            } catch (err) {
              // if confluence search fails, continue without it
              console.error("auto-discovery: confluence search failed:", err);
            }
          }

          // build discovery summary
          let discoverySummary = `found ${similarTicketsResults.length} similar tickets`;
          if (confluenceResults.length > 0) {
            discoverySummary += ` and ${confluenceResults.length} confluence pages`;
          }
          if (similarTicketsResults.length === 0 && confluenceResults.length === 0) {
            discoverySummary = "no similar context found (ticket may be unique or use different terminology)";
          }

          contextDiscovery = {
            is_sparse_ticket: isSparseTicket,
            similar_tickets: similarTicketsResults.slice(0, 10), // limit to top 10
            confluence_results: confluenceResults.slice(0, 5), // limit to top 5
            discovery_summary: discoverySummary,
          };
        }
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
      const keywords = new Set<string>(); // broader keywords for jql/confluence search

      const extractTerms = (text: string | undefined) => {
        if (!text) return;

        // 1. extract camelcase/pascalcase identifiers (likely class/function names)
        const camelCase = text.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g);
        if (camelCase) camelCase.forEach(t => technicalTerms.add(t));

        // 2. extract uppercase acronyms (API, SDK, ETL, gRPC, REST, etc.)
        const acronyms = text.match(/\b[A-Z]{2,}\b/g);
        if (acronyms) acronyms.forEach(a => {
          if (a.length >= 2 && a.length <= 8) { // filter out noise
            technicalTerms.add(a);
            keywords.add(a);
          }
        });

        // 3. extract common technology names (case-insensitive)
        const techPatterns = [
          'redis', 'kafka', 'postgresql', 'postgres', 'mysql', 'mongodb', 'elasticsearch',
          'docker', 'kubernetes', 'jenkins', 'gradle', 'maven', 'spring', 'hibernate',
          'react', 'angular', 'vue', 'typescript', 'javascript', 'python', 'java', 'kotlin',
          'graphql', 'grpc', 'protobuf', 'avro', 'thrift',
          'prometheus', 'grafana', 'datadog', 'splunk', 'newrelic',
          'terraform', 'ansible', 'puppet', 'chef',
          'lambda', 'dynamodb', 's3', 'ec2', 'rds', 'sqs', 'sns', 'kinesis'
        ];
        const lowerText = text.toLowerCase();
        techPatterns.forEach(tech => {
          if (lowerText.includes(tech)) {
            technicalTerms.add(tech);
            keywords.add(tech);
          }
        });

        // 4. extract file paths and extensions (src/path/File.java, *.yml, docker-compose.yml)
        const filePaths = text.match(/\b[\w\-]+\/[\w\-\/]+\.\w+\b/g);
        if (filePaths) filePaths.forEach(p => technicalTerms.add(p));

        const fileExtensions = text.match(/\*?\.\w{2,5}\b/g);
        if (fileExtensions) fileExtensions.forEach(e => technicalTerms.add(e));

        // 5. extract domain-specific terms (common patterns in lowercase)
        const domainTerms = text.match(/\b(provider|service|controller|repository|handler|processor|manager|client|server|api|endpoint|queue|stream|pipeline|migration|schema|database|metrics|monitoring|authentication|authorization|deployment|infrastructure)\b/gi);
        if (domainTerms) domainTerms.forEach(d => keywords.add(d.toLowerCase()));

        // 6. extract quoted strings (likely important terms/names)
        const quoted = text.match(/"([^"]+)"|'([^']+)'/g);
        if (quoted) {
          quoted.forEach(q => {
            const cleaned = q.replace(/["']/g, '').trim();
            if (cleaned.length > 3 && cleaned.length < 50) {
              keywords.add(cleaned);
            }
          });
        }
      };

      // extract from ticket title/summary (important source of context)
      extractTerms(ticket.summary);

      // extract from description and comments
      extractTerms(ticket.description);
      ticket.comments.forEach((c: any) => extractTerms(c.body));
      depGraph.nodes.forEach((n: any) => {
        extractTerms(n.summary);
        extractTerms(n.description);
      });

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
${keywords.size > 0 ? `- keywords for search: ${Array.from(keywords).slice(0, 15).join(", ")}` : ""}

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

### 0. discover context from historical tickets (if repo/service unclear)

**note:** if you're unsure which repos this ticket affects, start here to find clues from similar past work.

**search for similar tickets (use jira_list_issues mcp tool or jira cli):**
\`\`\`bash
# find closed tickets with similar keywords (discovers repos via linked prs)
${Array.from(keywords).slice(0, 5).map(kw =>
  `# tickets mentioning "${kw}"\njira_list_issues jql="text ~ '${kw}' AND status = Closed ORDER BY updated DESC" limit=10`
).join("\n")}

# search by components to find historical work
${Array.from(allComponents).slice(0, 3).map(comp =>
  `jira_list_issues jql="component = '${comp}' AND status = Closed ORDER BY updated DESC" limit=15`
).join("\n")}

# find tickets from same assignee (if assigned) to discover repo patterns
${ticket.assignee ? `jira_list_issues jql="assignee = '${ticket.assignee.displayName}' AND status = Closed ORDER BY updated DESC" limit=20` : "# (skip - no assignee)"}

# alternative: use jira cli if mcp not available
# jira issue list --jql "text ~ 'keyword' AND status = Closed" --limit 10
\`\`\`

**search confluence for architecture/context (use confluence_search_pages mcp tool if available):**
\`\`\`bash
# search for architecture docs with keywords
${Array.from(keywords).slice(0, 3).map(kw =>
  `confluence_search_pages cql="text ~ '${kw}' AND (title ~ 'architecture' OR title ~ 'setup' OR title ~ 'runbook')" limit=5`
).join("\n")}

# search for component documentation
${Array.from(allComponents).slice(0, 2).map(comp =>
  `confluence_search_pages cql="text ~ '${comp}'" limit=5`
).join("\n")}

# note: confluence_search_pages requires confluence-minimal-server or reports-minimal-server
# if not available, manually search confluence web ui for these keywords
\`\`\`

**strategy:**
1. review closed tickets from searches above
2. identify github prs linked to those tickets (pr descriptions often mention repo)
3. extract repo patterns and file paths from those prs
4. use discovered repos as starting point for sections 1-5 below
5. if still unclear, search github org for keywords: \`gh search repos --owner ${githubOrg} "${Array.from(keywords).slice(0, 1).join("")}"\`

---

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
          ...(contextDiscovery ? { context_discovery: contextDiscovery } : {}),
        },
        suggested_prompt: suggestedPrompt,
        metadata: {
          analyzed_at: startTime.toISOString(),
          depth_traversed: input.depth,
          tool_version: "1.0",
          auto_discover_enabled: input.autoDiscover,
        },
      };

      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    }
  );
  registeredNames.push("jira_dependency_analysis");

  // jira_find_similar_tickets (discover context from historical tickets)
  mcp.tool(
    "jira_find_similar_tickets",
    "Jira: Find similar tickets to discover repos/services context (searches by keywords, components, labels, assignee)",
    FindSimilarTicketsInput.shape,
    async (input: z.infer<typeof FindSimilarTicketsInput>) => {
      // 1. fetch source ticket
      const raw = await client.getIssue(input.issueKey, ["summary", "description", "comment", "labels", "components", "assignee"]);

      // extract keywords from source ticket using same logic as dependency_analysis
      const keywords = new Set<string>();
      const technicalTerms = new Set<string>();

      const extractTerms = (text: string | undefined) => {
        if (!text) return;
        const camelCase = text.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g);
        if (camelCase) camelCase.forEach(t => technicalTerms.add(t));

        const acronyms = text.match(/\b[A-Z]{2,}\b/g);
        if (acronyms) acronyms.forEach(a => {
          if (a.length >= 2 && a.length <= 8) {
            technicalTerms.add(a);
            keywords.add(a);
          }
        });

        const domainTerms = text.match(/\b(provider|service|controller|repository|handler|processor|manager|client|server|api|endpoint|queue|stream|pipeline|migration|schema|database|metrics|monitoring|authentication|authorization|deployment|infrastructure)\b/gi);
        if (domainTerms) domainTerms.forEach(d => keywords.add(d.toLowerCase()));
      };

      const summary = raw?.fields?.summary ?? "";
      const description = adfToPlainText(raw?.fields?.description) || "";
      const labels = raw?.fields?.labels || [];
      const components = (raw?.fields?.components || []).map((c: any) => c.name ?? "");
      const assignee = raw?.fields?.assignee?.displayName;

      extractTerms(summary);
      extractTerms(description);
      (raw?.fields?.comment?.comments || []).slice(-3).forEach((c: any) => {
        extractTerms(adfToPlainText(c.body));
      });

      // 2. build search queries based on enabled strategies
      const searches: Array<{ jql: string; strategy: string; weight: number }> = [];

      // keyword-based search (highest weight if keywords found)
      if (input.includeKeywords && keywords.size > 0) {
        const topKeywords = Array.from(keywords).slice(0, 5);
        topKeywords.forEach(kw => {
          const statusFilter = input.onlyClosedTickets ? " AND status = Closed" : "";
          searches.push({
            jql: `text ~ "${kw}"${statusFilter} ORDER BY updated DESC`,
            strategy: `keyword: ${kw}`,
            weight: 0.7,
          });
        });
      }

      // component-based search (very high confidence)
      if (input.includeComponents && components.length > 0) {
        components.forEach((comp: string) => {
          const statusFilter = input.onlyClosedTickets ? " AND status = Closed" : "";
          searches.push({
            jql: `component = "${comp}"${statusFilter} ORDER BY updated DESC`,
            strategy: `component: ${comp}`,
            weight: 0.9,
          });
        });
      }

      // label-based search (medium confidence)
      if (input.includeLabels && labels.length > 0) {
        labels.forEach((label: string) => {
          const statusFilter = input.onlyClosedTickets ? " AND status = Closed" : "";
          searches.push({
            jql: `labels = "${label}"${statusFilter} ORDER BY updated DESC`,
            strategy: `label: ${label}`,
            weight: 0.6,
          });
        });
      }

      // assignee-based search (low confidence, but useful for repo discovery)
      if (input.includeAssignee && assignee) {
        const statusFilter = input.onlyClosedTickets ? " AND status = Closed" : "";
        searches.push({
          jql: `assignee = "${assignee}"${statusFilter} ORDER BY updated DESC`,
          strategy: `assignee: ${assignee}`,
          weight: 0.4,
        });
      }

      // 3. execute searches and collect results
      const similarTicketsMap = new Map<string, z.infer<typeof SimilarTicket>>();
      const strategiesUsed: string[] = [];

      for (const search of searches) {
        try {
          const res = await client.searchIssues({
            jql: search.jql,
            startAt: 0,
            maxResults: Math.min(input.limit * 2, 20), // fetch more to ensure we have enough after dedup
            fields: ["summary", "status", "labels", "components"],
          });

          strategiesUsed.push(search.strategy);

          const issues = Array.isArray(res.issues) ? res.issues : [];
          for (const issue of issues) {
            const key = issue.key;
            if (key === input.issueKey) continue; // skip source ticket itself

            // if already found via another search, boost confidence
            if (similarTicketsMap.has(key)) {
              const existing = similarTicketsMap.get(key)!;
              existing.confidenceScore = Math.min(1.0, existing.confidenceScore + search.weight * 0.3);
              existing.matchReason += `, ${search.strategy}`;
            } else {
              similarTicketsMap.set(key, {
                key,
                summary: issue.fields?.summary ?? "",
                status: issue.fields?.status?.name ?? "",
                matchReason: search.strategy,
                confidenceScore: search.weight,
                labels: issue.fields?.labels || [],
                components: (issue.fields?.components || []).map((c: any) => ({
                  id: String(c.id ?? ""),
                  name: c.name ?? "",
                })),
              });
            }
          }
        } catch (err) {
          // if search fails, skip it
          console.error(`search failed for jql: ${search.jql}`, err);
        }
      }

      // 4. sort by confidence and limit results
      const sortedTickets = Array.from(similarTicketsMap.values())
        .sort((a, b) => b.confidenceScore - a.confidenceScore)
        .slice(0, input.limit);

      const payload: z.infer<typeof FindSimilarTicketsOutput> = {
        sourceTicket: {
          key: input.issueKey,
          summary,
          extractedKeywords: Array.from(keywords),
          components,
          labels,
        },
        similarTickets: sortedTickets,
        searchStrategies: strategiesUsed,
        totalFound: similarTicketsMap.size,
      };

      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    }
  );
  registeredNames.push("jira_find_similar_tickets");

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
