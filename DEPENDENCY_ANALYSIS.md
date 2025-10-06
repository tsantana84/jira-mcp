# dependency analysis workflow

comprehensive guide to using jira mcp's dependency analysis capabilities for tracing blocked tickets, finding root causes, and extracting actionable context.

---

## overview

the dependency analysis tools help you:
- trace complex issue dependencies (blocks, blocked by, relates to)
- identify bottlenecks and long-term blockers
- extract related confluence documentation
- generate code search prompts for follow-up analysis
- detect circular dependencies and recurring patterns

## quick start

### via gemini cli (recommended)

when using gemini cli with the jira mcp server configured:
- ask in natural language: "analyze dependencies for PROJ-123"
- the ai will automatically use the `jira_dependency_analysis` tool
- you'll receive structured output with dependency graph, blockers, and insights

### direct tool call (for testing/debugging)

```json
{
  "issueKey": "PROJ-123",
  "depth": 3
}
```

---

## tools overview

### 1. jira_dependency_analysis (main orchestration tool)

**what it does:**
- fetches main issue details
- traverses dependency graph (configurable depth, default 3 levels)
- identifies blockers with age analysis
- extracts confluence documentation links from issue/comments
- analyzes patterns (multiple blockers, circular deps, long-term blocks)
- generates suggested code search prompt

**input:**
- `issueKey` (required): jira issue key (e.g., "PROJ-123")
- `depth` (optional): traversal depth (1-10, default 3)

**output structure:**
```json
{
  "analysis": {
    "ticket": {
      "key": "PROJ-123",
      "summary": "deployment blocked by infra config",
      "status": "blocked",
      "issueType": "task",
      "description": "need to deploy new api endpoints but terraform configuration requires manual updates...",
      "comments": [
        {
          "id": "10001",
          "author": {"accountId": "123", "displayName": "john doe"},
          "created": "2025-09-20T14:30:00Z",
          "body": "blocked on INFRA-456, terraform module needs aws provider update"
        }
      ],
      "labels": ["deployment", "backend", "blocked"],
      "components": [{"id": "10100", "name": "api-service"}],
      "assignee": {"accountId": "123", "displayName": "john doe"},
      "reporter": {"accountId": "456", "displayName": "jane smith"},
      "priority": {"id": "1", "name": "high"}
    },
    "dependency_graph": {
      "nodes": [
        {
          "key": "PROJ-123",
          "summary": "deployment blocked by infra config",
          "status": "blocked",
          "issueType": "task",
          "description": "need to deploy new api endpoints but terraform configuration requires...",
          "comments": [
            {
              "id": "10001",
              "author": {"accountId": "123", "displayName": "john doe"},
              "created": "2025-09-20T14:30:00Z",
              "body": "blocked on INFRA-456, terraform module needs aws provider update"
            }
          ],
          "labels": ["deployment", "backend", "blocked"],
          "components": [{"id": "10100", "name": "api-service"}],
          "assignee": {"accountId": "123", "displayName": "john doe"},
          "priority": {"id": "1", "name": "high"}
        },
        {
          "key": "INFRA-456",
          "summary": "update terraform module",
          "status": "in progress",
          "issueType": "story",
          "description": "upgrade aws provider in terraform module from v4 to v5...",
          "comments": [],
          "labels": ["infrastructure", "terraform"],
          "components": [{"id": "10200", "name": "infrastructure"}]
        }
      ],
      "edges": [
        {
          "from": "PROJ-123",
          "to": "INFRA-456",
          "type": "is blocked by"
        }
      ],
      "circular_deps": []
    },
    "blockers": [
      {
        "key": "INFRA-456",
        "summary": "update terraform module",
        "status": "in progress",
        "blocked_since": "2025-08-15T10:00:00Z",
        "days_blocked": 45
      }
    ],
    "confluence_docs": [
      {
        "id": "123456",
        "title": "infrastructure setup guide",
        "url": "https://company.atlassian.net/wiki/spaces/ENG/pages/123456"
      }
    ],
    "insights": {
      "total_dependencies": 5,
      "blocking_chain_length": 2,
      "avg_blocker_age_days": 38,
      "patterns": [
        "multiple blockers detected (2 issues blocking progress)",
        "long-term blockers (avg 38 days blocked)"
      ]
    }
  },
  "suggested_prompt": "# code analysis for jira ticket: PROJ-123\n\n## ticket context\n**main ticket:** PROJ-123 - \"deployment blocked by infra config\"\n...\n\n## repository context\n**primary repository:** company/api-service\n**organization:** company\n\n## analysis tasks\n\n### 1. search github for related prs and commits\n**find prs mentioning jira tickets:**\n```bash\ngh pr list --repo company/api-service --search \"PROJ-123\" --state all --limit 10\ngh pr list --repo company/api-service --search \"INFRA-456\" --state closed --limit 5\n# then: gh pr diff <PR_NUMBER> to see how INFRA-456 was implemented\n```\n\n**search git history:**\n```bash\ngit log --all --grep=\"PROJ-123\" --oneline -20\ngit log --all --grep=\"terraform\" --oneline -10\n```\n\n### 2. search codebase for technical terms\n```bash\ngrep -r \"TerraformModule\" --include=\"*.java\" --include=\"*.kt\" -n\ngrep -r \"infrastructure\" --include=\"*.yaml\" -i\n```\n\n### 3. search organization for related repositories\n```bash\ngh search repos --owner company \"infrastructure\" --limit 10\ngh search repos --owner company \"schema OR migration\" --limit 10\ngh search repos --owner company \"pipeline OR etl\" --limit 10\n```\n\n### 4. check for database/schema dependencies\n```bash\nfind . -path \"*/migrations/*\" -o -name \"*migration*.sql\"\ngrep -r \"@Entity|@Table\" --include=\"*.java\"\n```\n\n### 5. identify cross-service impact\n```bash\ngh search repos --owner company \"api-service-client\" --limit 10\n```\n\n## output format\ncreate a file called `code_analysis.json` with structured findings including:\n- related_prs\n- related_commits\n- code_files_found\n- related_repositories\n- database_impact\n- cross_service_dependencies\n- implementation_patterns\n- recommendations\n\n**important:** use actual data from your searches. prioritize finding implementation patterns from closed related tickets.",
  "metadata": {
    "analyzed_at": "2025-10-05T19:45:00Z",
    "depth_traversed": 3,
    "tool_version": "1.0"
  }
}
```

**note:** the suggested_prompt is a complete, ready-to-use prompt for ai agents (gemini cli) with:
- executable bash commands (`gh` cli, `git log`, `grep`, `find`)
- github org/repo placeholders from env vars (or `{{YOUR_GITHUB_ORG}}` if not set)
- technical terms extracted from jira descriptions/comments
- structured json output format for code_analysis.json

### 2. jira_issue_relationships

**what it does:**
- traverses issue link graph only (no confluence, no changelog)
- faster than full analysis
- useful for visualization or custom workflows

**input:**
- `issueKey`: jira issue key
- `depth`: traversal depth (1-10, default 3)

**output:**
```json
{
  "nodes": [...],
  "edges": [...],
  "circular_deps": [...]
}
```

### 3. jira_get_changelog

**what it does:**
- fetch issue history (status transitions, field changes, reassignments)
- useful for timeline analysis or identifying when blocking started

**input:**
- `issueKey`: jira issue key
- `startAt`: pagination offset (default 0)
- `maxResults`: page size (1-100, default 100)

**output:**
```json
{
  "histories": [
    {
      "id": "12345",
      "created": "2025-09-20T14:30:00Z",
      "items": [
        {
          "field": "status",
          "fromString": "in progress",
          "toString": "blocked"
        }
      ],
      "author": {
        "accountId": "...",
        "displayName": "john doe"
      }
    }
  ],
  "total": 15,
  "startAt": 0,
  "maxResults": 100,
  "nextStartAt": 100
}
```

### 4. confluence_get_page

**what it does:**
- fetch confluence page by id
- includes ancestors (breadcrumb trail) and body content
- useful for reading documentation referenced in jira

**input:**
- `pageId`: confluence page id (e.g., "123456")
- `expand`: optional array (e.g., ["body.storage", "ancestors", "version"])

**output:**
```json
{
  "id": "123456",
  "type": "page",
  "title": "infrastructure setup guide",
  "body": "plain text content...",
  "bodyHtml": "<p>html content...</p>",
  "ancestors": [
    {
      "id": "100",
      "title": "engineering",
      "type": "page"
    }
  ],
  "url": "https://company.atlassian.net/wiki/spaces/ENG/pages/123456"
}
```

### 5. jira_issue_confluence_links

**what it does:**
- extract confluence page links from issue description and comments
- parses atlassian document format (adf) for embedded links

**input:**
- `issueKey`: jira issue key

**output:**
```json
{
  "links": [
    {
      "pageId": "123456",
      "url": "https://company.atlassian.net/wiki/spaces/ENG/pages/123456",
      "title": "infrastructure setup guide"
    }
  ]
}
```

### 6. confluence_page_jira_links

**what it does:**
- extract jira issue keys from confluence page content
- uses regex pattern: [A-Z]+-\d+
- optional validation (checks if issues exist)

**input:**
- `pageId`: confluence page id
- `validate`: boolean (default false) - if true, validates keys against jira api

**output:**
```json
{
  "issueKeys": [
    "PROJ-123",
    "INFRA-456",
    "DATA-789"
  ]
}
```

---

## workflow examples

### example 1: analyze a blocked ticket

**scenario:** ticket PROJ-123 is blocked, investigate why

**via gemini cli:**
- ask: "analyze dependencies for PROJ-123 and summarize the blockers"

**what happens:**
1. ai calls `jira_dependency_analysis` tool
2. returns structured analysis with:
   - dependency graph
   - blocker list with age
   - confluence docs
   - suggested code search prompt
3. ai summarizes findings in plain english

### example 2: two-stage workflow (jira → code analysis)

**stage 1: jira/confluence discovery**

via gemini cli:
- ask: "run dependency analysis on DMD-11937 and save results to jira_analysis.json"
- ai will call `jira_dependency_analysis` and write the output file

**stage 2: code analysis (via gemini cli in your repository)**

use the `suggested_prompt` from jira_analysis.json with gemini cli in your code repository

the ai will execute:
- github cli commands to find related prs/commits
- grep searches for technical terms from descriptions
- cross-repository searches in your github org
- database/schema impact analysis
- output code_analysis.json with structured findings

**stage 3: synthesis (correlate jira + code analysis)**

use the synthesis prompt template to analyze both files together and produce actionable outputs.

**see [SYNTHESIS_PROMPT.md](./SYNTHESIS_PROMPT.md) for the complete template.**

**inputs:**
- jira_analysis.json (from stage 1)
- code_analysis.json (from stage 2)

**process:**
the ai will correlate the two files to:
- match jira dependencies to actual prs/commits
- extract implementation patterns from closed related tickets
- validate components mentioned in jira exist in codebase
- identify gaps and root causes
- assess complexity/risk based on similar work

**outputs (in synthesis_analysis.json):**

1. **tech_lead_context** - for pasting into ticket description when delegating:
   - executive summary (what, why, effort, risk)
   - dependencies discovered (upstream/downstream)
   - related work (prs with implementation patterns)
   - recommended approach (high-level strategy)
   - potential blockers
   - effort estimate (based on similar prs)

2. **developer_guide** - step-by-step implementation plan:
   - implementation steps with specific pr/file references
   - files to modify
   - code examples from similar work
   - testing strategy
   - deployment plan
   - rollback plan

**usage:**
```bash
# copy SYNTHESIS_PROMPT.md content + attach both json files to claude/gemini
# ai generates synthesis_analysis.json with both sections
```

**example output sections:**

tech_lead_context (paste into jira):
> add prometheus metrics to legacy demographics providers following pattern from dmm-11922 (pr #1234).
> requires @timed annotations on geolocationprovider and ipprovider methods.
> effort: 1-2 days (similar pr changed 120 lines across 2 files).
> risk: low - isolated change, pattern already proven.

developer_guide (implementation checklist):
> step 1: review pr #1234 to understand micrometer integration pattern
> step 2: locate files: geolocationprovider.java, ipprovider.java
> step 3: add @timed annotations (see code example from pr #1234 lines 45-60)
> step 4: write unit tests verifying metrics recorded
> step 5: test locally via /actuator/prometheus endpoint
> step 6: create pr following dmm-11922 pattern

### example 3: custom workflow with individual tools

via gemini cli, ask natural language questions:
1. "get dependency graph for PROJ-123"
   - ai uses `jira_issue_relationships` tool
2. "fetch changelog for INFRA-456 to see when it stalled"
   - ai uses `jira_get_changelog` tool
3. "what confluence pages are linked to PROJ-123?"
   - ai uses `jira_issue_confluence_links` tool
4. "get content from confluence page 123456"
   - ai uses `confluence_get_page` tool

---

## configuration

### environment variables

```bash
# required
JIRA_BASE_URL=https://company.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=your-token

# optional (defaults to JIRA_BASE_URL/wiki)
CONFLUENCE_BASE_URL=https://company.atlassian.net/wiki

# optional (defaults)
MAX_RELATIONSHIP_DEPTH=5               # limit traversal depth
INCLUDE_CHANGELOG=true                 # fetch history in analysis
DEPENDENCY_ANALYSIS_COMMENT_LIMIT=5    # max comments per issue in analysis output

# optional (github integration for suggested_prompt)
GITHUB_ORG=your-company                # github organization name
GITHUB_DEFAULT_REPO=your-company/repo  # primary repository (format: org/repo)
# if not set, suggested_prompt will use placeholders like {{YOUR_GITHUB_ORG}}
```

### gemini cli setup

1. run setup (one-time):
   ```bash
   npm run setup:gemini
   npm run gemini:config
   ```

2. verify tools available by asking gemini cli to list the jira mcp tools

---

## troubleshooting

### "no dependencies found" but i know there are links

**cause:** jira issue links might use custom link types not detected

**solution:** ask gemini cli to get the issue with all fields and show issuelinks

### "confluence page not found"

**cause:** page id incorrect or confluence base url wrong

**solution:**
1. verify page id from confluence url:
   - old format: `/pages/viewpage.action?pageId=123456`
   - new format: `/wiki/spaces/SPACE/pages/123456/title`
2. check `CONFLUENCE_BASE_URL` env var (should end with `/wiki`)

### "circular dependency detected" - what does this mean?

**cause:** two or more issues link to each other in a cycle (A blocks B, B blocks A)

**solution:** review the `circular_deps` array in output, manually break the cycle in jira

### dependency analysis is slow

**cause:** deep traversal (depth > 3) with many linked issues

**solution:**
1. reduce depth: `{ "issueKey": "PROJ-123", "depth": 2 }`
2. use individual tools for targeted queries
3. enable caching (future enhancement)

### "missing required env var: JIRA_BASE_URL"

**cause:** environment variables not loaded

**solution:**
1. ensure you ran `npm run setup:gemini`
2. reload shell: `source ~/.zshrc` or `source ~/.bashrc`
3. verify: `echo $JIRA_BASE_URL`

---

## best practices

1. **start with depth 2-3** - sufficient for most dependency chains, faster results
2. **use jira_dependency_analysis for comprehensive view** - orchestrates all tools
3. **combine with code analysis** - follow the suggested_prompt for stage 2
4. **watch for patterns** - recurring blockers indicate systemic issues
5. **validate confluence links** - not all embedded links may be accessible

---

## limitations

- **read-only**: tools do not modify jira/confluence (by design)
- **cloud only**: requires atlassian cloud (not server/data center)
- **no attachment access**: cannot fetch issue attachments
- **no sprint data**: focuses on dependencies, not velocity/burndown
- **adf parsing**: may miss some edge cases in complex confluence embeds

---

## next steps

- see GEMINI_SETUP.md for more gemini cli examples
- see README.md for manual mcp client configuration
- see TROUBLESHOOTING.md for common issues

---

**questions or issues?**
- file an issue: https://github.com/your-org/jira-mcp/issues
- check existing docs: README.md, GEMINI_SETUP.md
