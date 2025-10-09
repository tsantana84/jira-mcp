# jira + confluence mcp servers (cloud)

simple, stdio-based mcp servers for atlassian jira and confluence (cloud, api token auth). no webhooks. focus on issue search, boards, and confluence search, plus a minimal "reports" server for daily briefs.

---

## example: ai-powered dependency analysis

turn complex jira tickets into actionable implementation plans in 3 simple steps:

### step 1: analyze jira dependencies

in gemini cli, paste:
```
run dependency analysis on DMD-11937 with:
- depth: 3
- include confluence docs updated in last 12 months
- save to jira_analysis.json
```

**what you get:** jira ticket context, dependency graph, blocker analysis, confluence docs, and a ready-to-use prompt for code analysis

### step 2: analyze related code

copy the `suggested_prompt` from `jira_analysis.json` (replace `{{YOUR_GITHUB_ORG}}` and `{{YOUR_GITHUB_REPO}}`), then paste it into claude or gemini in your repository.

**note:** tell the ai to wait if it hits github rate limits - accuracy over speed for this report.

**what you get:** related prs, commits, implementation patterns, cross-repo dependencies with confidence scores - saved to `code_analysis.json`

### step 3: synthesize implementation plan

in claude or gemini, run the synthesis prompt:
```
use the SYNTHESIS_PROMPT.md template with @jira_analysis.json and @code_analysis.json
```

**what you get:**
- **tech lead context**: executive summary, effort estimate, risk assessment
- **developer guide**: step-by-step implementation plan with code examples, testing strategy, deployment plan
- **correlation analysis**: confidence-scored matches between jira context and code findings

**output:** `synthesis_analysis.json` - ready to paste into ticket descriptions or hand to developers

---

## quick setup

### prerequisites
- node.js 18+
- atlassian cloud email + api token ([create one here](https://id.atlassian.com/manage-profile/security/api-tokens))

### install

```bash
git clone https://github.com/your-org/jira-mcp.git
cd jira-mcp
npm install
npm run build
```

### configure for gemini cli (recommended)

```bash
# step 1: set your credentials (interactive)
npm run setup:gemini

# step 2: configure gemini cli
npm run gemini:config
```

**ready to use!** your gemini cli is now connected to jira and confluence.

### manual mcp client configuration

if not using gemini cli, add to your mcp client config (claude desktop, cline, etc.):

```json
"mcpServers": {
  "jira-min": {
    "command": "node",
    "args": ["/absolute/path/to/jira-mcp/scripts/minimal-server.mjs"],
    "cwd": "/absolute/path/to/jira-mcp",
    "transport": "stdio",
    "env": {
      "JIRA_BASE_URL": "https://your-site.atlassian.net",
      "JIRA_EMAIL": "you@example.com",
      "JIRA_API_TOKEN": "your-api-token"
    }
  }
}
```

**important:** use absolute paths, not relative paths.

---

## available tools

### jira-min server
- `jira_list_issues` - search via jql with pagination
- `jira_get_issue` - fetch single issue with full details
- `jira_dependency_analysis` - comprehensive dependency analysis (recommended!)
- `jira_issue_relationships` - traverse dependency graph
- `jira_get_changelog` - status transitions, reassignments
- `jira_list_projects` - list accessible projects
- `jira_list_boards` - list boards for projects
- `jira_board_issues` - get issues from specific boards
- `jira_find_similar_tickets` - discover context from historical tickets
- `confluence_get_page` - get page with ancestors/breadcrumbs
- `jira_issue_confluence_links` - extract confluence links from issue
- `confluence_page_jira_links` - extract jira keys from page

### confluence-min server
- `confluence_search_pages` - search pages using cql

### reports-min server (jira + confluence combined)
- `ops_daily_brief` - daily summary (last 24h, new issues, transitions, blocked tickets)
- `ops_shift_delta` - what changed since you logged off
- `ops_jira_review_radar` - issues waiting for review (stale prs)

---

## common usage patterns

### search jira issues
```
jql: "project = ABC AND status != Done ORDER BY updated DESC"
fields: "summary,assignee,comment"
includeComments: true
```

### analyze dependencies for blocked ticket
```
issueKey: "PROJ-123"
depth: 3
autoDiscover: true
```

### search confluence for architecture docs
```
cql: "text ~ 'microservices' AND (title ~ 'architecture' OR title ~ 'design') AND space = ENG"
limit: 10
```

### get daily brief for last 24 hours
```
from: "2025-10-08T12:00:00-03:00"
to: "2025-10-09T12:00:00-03:00"
projects: ["ABC", "DMD"]
labelsBlocked: ["Blocked", "Impeded"]
```

---

## advanced workflows

### dependency analysis (3-stage process)

**stage 1: jira/confluence discovery**
analyzes ticket dependencies, extracts confluence docs, identifies blockers
**output:** `jira_analysis.json` with suggested code search prompt

**stage 2: code analysis**
uses suggested_prompt from stage 1 with github cli in your repository
searches for related prs, commits, implementation patterns
**output:** `code_analysis.json` with structured findings

**stage 3: synthesis**
correlates both analyses with confidence tracking
generates tech lead context + developer implementation guide
**output:** `synthesis_analysis.json`

**see:** [DEPENDENCY_ANALYSIS.md](./DEPENDENCY_ANALYSIS.md) for detailed workflow
**see:** [SYNTHESIS_PROMPT.md](./SYNTHESIS_PROMPT.md) for stage 3 template

### using with gemini cli

gemini cli is google's terminal-based ai assistant. connect this jira mcp server to:
- ask questions about jira projects in plain english
- search issues, boards, confluence pages from your terminal
- get daily reports through conversational queries
- combine jira data with github in a single ai session

**detailed setup:** [GEMINI_SETUP.md](./GEMINI_SETUP.md)
includes: advanced configuration, combining with github mcp, jql patterns, troubleshooting

---

## testing connectivity

```bash
# verify jira connection
npm run ping

# or manually
JIRA_BASE_URL=https://your-site.atlassian.net \
JIRA_EMAIL=you@example.com \
JIRA_API_TOKEN=your-token \
npm run start:jira-min
```

---

## architecture

### where things live
- **minimal servers:** `scripts/minimal-server.mjs`, `scripts/confluence-minimal-server.mjs`, `scripts/report-minimal-server.mjs`
- **jira client:** `src/jira/client.ts` (http + retries, agile + core apis)
- **issue normalization:** `src/jira/issues.ts` (adf to plain text, field mapping)
- **mcp integration:** `src/mcp/tools.ts` (tool registration, input/output schemas)
- **schemas:** `src/schemas.ts` (zod schemas for validation)

### confidence tracking
all analysis outputs include explicit confidence scores:
- **high (0.8-1.0):** direct evidence (ticket id in pr, exact component match)
- **medium (0.5-0.8):** inferred match (similar patterns, related terms)
- **low (0.0-0.5):** weak connection (keyword match only, old references)

gaps are flagged explicitly rather than filled with assumptions.

---

## troubleshooting

**common issues:**
- tool list caching in mcp clients
- logs not visible (use stderr for debugging)
- 404 on confluence (missing /wiki in base url)
- jira 410 errors (search api migration)
- mcp server name collisions

**see:** [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for solutions

---

## security

- keep your atlassian api token secret
- rotate it if it appears in shell history or logs
- use environment variables, not hardcoded tokens in configs

---

## license

mit
