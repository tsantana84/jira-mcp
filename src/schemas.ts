import { z } from "zod";

/* Common primitives */
export const IsoDateString = z.string().datetime({ offset: true });
export const NonEmptyString = z.string().min(1);

/* Field selector for Jira responses */
export const FieldsSelector = z
  .union([
    z.literal("summary"),
    z.literal("all"),
    z.array(NonEmptyString).nonempty(),
  ])
  .default("summary");

/* Normalized models */
export const JiraUser = z.object({
  accountId: NonEmptyString,
  displayName: NonEmptyString,
});

export const JiraStatusCategory = z.object({
  key: NonEmptyString, // "new" | "indeterminate" | "done"
  name: NonEmptyString,
});

export const JiraStatus = z.object({
  id: NonEmptyString,
  name: NonEmptyString,
  category: JiraStatusCategory,
});

export const JiraProjectRef = z.object({
  id: NonEmptyString,
  key: NonEmptyString,
  name: NonEmptyString,
});

export const JiraIssueTypeRef = z.object({
  id: NonEmptyString,
  name: NonEmptyString,
});

export const JiraPriorityRef = z
  .object({
    id: NonEmptyString,
    name: NonEmptyString,
  })
  .optional();

export const JiraIssue = z.object({
  id: NonEmptyString,
  key: NonEmptyString,
  url: NonEmptyString, // e.g., https://your.atlassian.net/browse/ABC-123
  summary: NonEmptyString,
  status: JiraStatus,
  assignee: JiraUser.optional(),
  reporter: JiraUser.optional(),
  priority: JiraPriorityRef.optional(),
  labels: z.array(z.string()).default([]),
  project: JiraProjectRef,
  issueType: JiraIssueTypeRef,
  created: IsoDateString,
  updated: IsoDateString,
  custom: z.record(z.unknown()).optional(),
  raw: z.unknown().optional(), // original Jira payload (optional)
});

export const JiraComment = z.object({
  id: NonEmptyString,
  author: JiraUser,
  created: IsoDateString,
  updated: IsoDateString.optional(),
  body: NonEmptyString, // plain text representation
});

/* Project listing */
export const JiraProjectSummary = z.object({
  id: NonEmptyString,
  key: NonEmptyString,
  name: NonEmptyString,
});

/* Transitions */
export const JiraTransition = z.object({
  id: NonEmptyString,
  name: NonEmptyString,
  to: z.object({
    id: NonEmptyString,
    name: NonEmptyString,
    statusCategory: JiraStatusCategory,
  }),
});

/* Shared preview shape for mutating operations */
export const MutationPreview = z.object({
  preview: z.literal(true),
  request: z.object({
    method: z.enum(["POST", "PUT"]),
    path: NonEmptyString, // REST path e.g. /rest/api/3/issue
    body: z.unknown(),
  }),
  hint: z.string().optional(),
});

/* Tool inputs/outputs */

/* search_issues */
export const SearchIssuesInput = z.object({
  jql: NonEmptyString,
  limit: z.number().int().min(1).max(100).default(25),
  startAt: z.number().int().min(0).default(0),
  fields: FieldsSelector.optional(),
});
export const SearchIssuesOutput = z.object({
  issues: z.array(JiraIssue),
  total: z.number().int().min(0),
  startAt: z.number().int().min(0),
  maxResults: z.number().int().min(1).max(100),
  nextStartAt: z.number().int().min(0).optional(),
});

/* get_issue */
export const GetIssueInput = z.object({
  issueKey: NonEmptyString,
  fields: FieldsSelector.optional(),
});
export const GetIssueOutput = z.object({
  issue: JiraIssue,
});

/* issue_relationships */
export const IssueRelationshipsInput = z.object({
  issueKey: NonEmptyString,
  depth: z.number().int().min(1).max(10).default(3),
});
export const IssueRelationshipNode = z.object({
  key: NonEmptyString,
  summary: NonEmptyString,
  status: NonEmptyString,
  issueType: NonEmptyString,
  description: z.string().optional(),
  comments: z.array(z.object({
    id: NonEmptyString,
    author: JiraUser,
    created: IsoDateString,
    body: NonEmptyString,
  })).default([]),
  labels: z.array(z.string()).default([]),
  components: z.array(z.object({
    id: NonEmptyString,
    name: NonEmptyString,
  })).default([]),
  assignee: JiraUser.optional(),
  reporter: JiraUser.optional(),
  priority: JiraPriorityRef.optional(),
});
export const IssueRelationshipEdge = z.object({
  from: NonEmptyString,
  to: NonEmptyString,
  type: NonEmptyString, // "blocks", "is blocked by", "relates to", "duplicates", etc.
});
export const IssueRelationshipsOutput = z.object({
  nodes: z.array(IssueRelationshipNode),
  edges: z.array(IssueRelationshipEdge),
  circular_deps: z.array(NonEmptyString).default([]),
});

/* get_changelog */
export const GetChangelogInput = z.object({
  issueKey: NonEmptyString,
  startAt: z.number().int().min(0).default(0),
  maxResults: z.number().int().min(1).max(100).default(100),
});
export const ChangelogItem = z.object({
  field: NonEmptyString,
  fieldtype: z.string().optional(),
  from: z.string().optional(),
  fromString: z.string().optional(),
  to: z.string().optional(),
  toString: z.string().optional(),
});
export const ChangelogHistory = z.object({
  id: NonEmptyString,
  created: IsoDateString,
  items: z.array(ChangelogItem),
  author: JiraUser.optional(),
});
export const GetChangelogOutput = z.object({
  histories: z.array(ChangelogHistory),
  total: z.number().int().min(0),
  startAt: z.number().int().min(0),
  maxResults: z.number().int().min(1).max(100),
  nextStartAt: z.number().int().min(0).optional(),
});

/* create_issue */
export const CreateIssueInput = z.object({
  summary: NonEmptyString,
  description: z.string().optional(), // plain text; server converts to minimal ADF
  projectKey: z.string().optional(), // falls back to DEFAULT_PROJECT_KEY
  issueType: z.string().optional(), // falls back to DEFAULT_ISSUE_TYPE
  fields: z.record(z.unknown()).optional(), // custom fields (e.g., {"customfield_12345": "foo"})
  confirm: z.boolean().default(false),
});
export const CreateIssueOutput = z.union([
  MutationPreview,
  z.object({
    preview: z.literal(false).optional(),
    issue: JiraIssue,
  }),
]);

/* update_issue */
export const UpdateIssueInput = z.object({
  issueKey: NonEmptyString,
  summary: z.string().optional(),
  description: z.string().optional(), // plain text
  fields: z.record(z.unknown()).optional(),
  confirm: z.boolean().default(false),
});
export const UpdateIssueOutput = z.union([
  MutationPreview,
  z.object({
    preview: z.literal(false).optional(),
    issue: JiraIssue,
  }),
]);

/* add_comment */
export const AddCommentInput = z.object({
  issueKey: NonEmptyString,
  body: NonEmptyString, // plain text
  confirm: z.boolean().default(false),
});
export const AddCommentOutput = z.union([
  MutationPreview,
  z.object({
    preview: z.literal(false).optional(),
    comment: JiraComment,
  }),
]);

/* list_projects */
export const ListProjectsInput = z.object({
  query: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(25),
  startAt: z.number().int().min(0).default(0),
});
export const ListProjectsOutput = z.object({
  projects: z.array(JiraProjectSummary),
  total: z.number().int().min(0),
  startAt: z.number().int().min(0),
  maxResults: z.number().int().min(1).max(100),
  nextStartAt: z.number().int().min(0).optional(),
});

/* list_transitions */
export const ListTransitionsInput = z.object({
  issueKey: NonEmptyString,
});
export const ListTransitionsOutput = z.object({
  transitions: z.array(JiraTransition),
});

/* transition_issue */
export const TransitionIssueInput = z.object({
  issueKey: NonEmptyString,
  transition: NonEmptyString, // name or id; server will resolve if name
  resolution: z.string().optional(), // optional, only if workflow requires it
  confirm: z.boolean().default(false),
});
export const TransitionIssueOutput = z.union([
  MutationPreview,
  z.object({
    preview: z.literal(false).optional(),
    issue: JiraIssue,
  }),
]);

/* Resource schemas (for reference) */
export const Resource_IssueInput = z.object({
  key: NonEmptyString,
  format: z.enum(["summary", "full"]).default("summary"),
  fields: FieldsSelector.optional(),
});
export const Resource_ProjectIssuesInput = z.object({
  projectKey: NonEmptyString,
  jql: z.string().optional(), // additional JQL constraints (will be ANDed with project)
  limit: z.number().int().min(1).max(100).default(25),
  startAt: z.number().int().min(0).default(0),
  fields: FieldsSelector.optional(),
});
export const Resource_IssueOutput = JiraIssue;
export const Resource_ProjectIssuesOutput = SearchIssuesOutput;

/* confluence_get_page */
export const ConfluenceGetPageInput = z.object({
  pageId: NonEmptyString,
  expand: z.array(NonEmptyString).optional(), // e.g., ["body.storage", "ancestors", "version"]
});
export const ConfluenceAncestor = z.object({
  id: NonEmptyString,
  title: NonEmptyString,
  type: NonEmptyString,
});
export const ConfluenceGetPageOutput = z.object({
  id: NonEmptyString,
  type: NonEmptyString,
  title: NonEmptyString,
  body: z.string().optional(), // body.storage.value converted to plain text
  bodyHtml: z.string().optional(), // raw html/storage format
  ancestors: z.array(ConfluenceAncestor).default([]),
  url: z.string().optional(),
});

/* jira_issue_confluence_links */
export const IssueConfluenceLinksInput = z.object({
  issueKey: NonEmptyString,
});
export const ConfluencePageLink = z.object({
  pageId: z.string().optional(),
  url: NonEmptyString,
  title: z.string().optional(),
});
export const IssueConfluenceLinksOutput = z.object({
  links: z.array(ConfluencePageLink).default([]),
});

/* confluence_page_jira_links */
export const ConfluenceJiraLinksInput = z.object({
  pageId: NonEmptyString,
  validate: z.boolean().default(false), // if true, validate issue keys exist in jira
});
export const ConfluenceJiraLinksOutput = z.object({
  issueKeys: z.array(NonEmptyString).default([]),
});

/* jira_dependency_analysis */
export const DependencyAnalysisInput = z.object({
  issueKey: NonEmptyString,
  depth: z.number().int().min(1).max(10).default(3),
});
export const DependencyBlocker = z.object({
  key: NonEmptyString,
  summary: NonEmptyString,
  status: NonEmptyString,
  blocked_since: IsoDateString.optional(),
  days_blocked: z.number().optional(),
});
export const DependencyInsights = z.object({
  total_dependencies: z.number().int().min(0),
  blocking_chain_length: z.number().int().min(0),
  avg_blocker_age_days: z.number().optional(),
  patterns: z.array(z.string()).default([]),
});
export const DependencyAnalysisOutput = z.object({
  analysis: z.object({
    ticket: z.object({
      key: NonEmptyString,
      summary: NonEmptyString,
      status: NonEmptyString,
      issueType: NonEmptyString,
      description: z.string().optional(),
      comments: z.array(z.object({
        id: NonEmptyString,
        author: JiraUser,
        created: IsoDateString,
        body: NonEmptyString,
      })).default([]),
      labels: z.array(z.string()).default([]),
      components: z.array(z.object({
        id: NonEmptyString,
        name: NonEmptyString,
      })).default([]),
      assignee: JiraUser.optional(),
      reporter: JiraUser.optional(),
      priority: JiraPriorityRef.optional(),
    }),
    dependency_graph: z.object({
      nodes: z.array(IssueRelationshipNode),
      edges: z.array(IssueRelationshipEdge),
      circular_deps: z.array(NonEmptyString).default([]),
    }),
    blockers: z.array(DependencyBlocker).default([]),
    confluence_docs: z.array(z.object({
      id: NonEmptyString,
      title: NonEmptyString,
      url: z.string().optional(),
    })).default([]),
    insights: DependencyInsights,
  }),
  suggested_prompt: NonEmptyString,
  metadata: z.object({
    analyzed_at: IsoDateString,
    depth_traversed: z.number().int(),
    tool_version: z.string().default("1.0"),
  }),
});

/* Config schema (env) */
export const EnvConfig = z.object({
  JIRA_BASE_URL: NonEmptyString, // https://your-domain.atlassian.net
  JIRA_EMAIL: NonEmptyString,
  JIRA_API_TOKEN: NonEmptyString,
  CONFLUENCE_BASE_URL: z.string().optional(), // defaults to JIRA_BASE_URL/wiki if not set
  DEFAULT_PROJECT_KEY: z.string().optional(),
  DEFAULT_ISSUE_TYPE: z.string().optional(),
});
export type EnvConfigType = z.infer<typeof EnvConfig>;

