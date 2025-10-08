Jira + Confluence MCP Servers (Cloud)

Simple, stdio-based MCP servers for Atlassian Jira and Confluence (Cloud, API token auth). No webhooks. Focus on issue search, boards, and Confluence search, plus a minimal “reports” server for daily briefs.

Quickstart
1) Prerequisites
   - Node.js 18+
   - Atlassian Cloud email + API token (same token works for Jira and Confluence)

2) Clone and install
   - git clone https://github.com/your-org/jira-mcp.git
   - cd jira-mcp
   - npm install
   - npm run build

3) Run a server (choose one)
   - Minimal Jira (recommended to start)
     JIRA_BASE_URL=https://<site>.atlassian.net \
     JIRA_EMAIL=you@example.com \
     JIRA_API_TOKEN=<token> \
     npm run start:jira-min

   - Minimal Confluence
     CONFLUENCE_BASE_URL=https://<site>.atlassian.net/wiki \
     ATLASSIAN_EMAIL=you@example.com \
     ATLASSIAN_API_TOKEN=<token> \
     npm run start:confluence-min

   - Minimal Reports (Jira + Confluence)
     JIRA_BASE_URL=https://<site>.atlassian.net \
     JIRA_EMAIL=you@example.com \
     JIRA_API_TOKEN=<token> \
     CONFLUENCE_BASE_URL=https://<site>.atlassian.net/wiki \
     ATLASSIAN_EMAIL=you@example.com \
     ATLASSIAN_API_TOKEN=<token> \
     npm run start:reports-min

4) Add to your MCP client config
   - Use absolute paths. Example entries:

   "mcpServers": {
     "jira-min": {
       "command": "node",
       "args": ["/ABS/PATH/jira-mcp/scripts/minimal-server.mjs"],
       "cwd": "/ABS/PATH/jira-mcp",
       "transport": "stdio",
       "env": { "JIRA_BASE_URL": "https://<site>.atlassian.net", "JIRA_EMAIL": "you@example.com", "JIRA_API_TOKEN": "<token>" }
     },
     "confluence-min": {
       "command": "node",
       "args": ["/ABS/PATH/jira-mcp/scripts/confluence-minimal-server.mjs"],
       "cwd": "/ABS/PATH/jira-mcp",
       "transport": "stdio",
       "env": { "CONFLUENCE_BASE_URL": "https://<site>.atlassian.net/wiki", "ATLASSIAN_EMAIL": "you@example.com", "ATLASSIAN_API_TOKEN": "<token>" }
     },
     "reports-min": {
       "command": "node",
       "args": ["/ABS/PATH/jira-mcp/scripts/report-minimal-server.mjs"],
       "cwd": "/ABS/PATH/jira-mcp",
       "transport": "stdio",
       "env": {
         "JIRA_BASE_URL": "https://<site>.atlassian.net",
         "JIRA_EMAIL": "you@example.com",
         "JIRA_API_TOKEN": "<token>",
         "CONFLUENCE_BASE_URL": "https://<site>.atlassian.net/wiki",
         "ATLASSIAN_EMAIL": "you@example.com",
         "ATLASSIAN_API_TOKEN": "<token>"
       }
     }
   }

5) Verify tools
   - jira-min: jira_list_issues, jira_list_projects, jira_list_boards, jira_board_issues, jira_get_issue, jira_issue_relationships, jira_get_changelog, jira_dependency_analysis, confluence_get_page, jira_issue_confluence_links, confluence_page_jira_links
   - confluence-min: confluence_search_pages
   - reports-min: ops_daily_brief, ops_shift_delta, ops_jira_review_radar
   - Or run: npm run ping (requires Jira env vars) to sanity-check the Jira server.

## Using with Gemini CLI (Terminal AI Assistant)

### Why Gemini CLI?
Gemini CLI is Google's terminal-based AI assistant that lets you interact with AI using natural language directly from your command line. By connecting this Jira MCP server to Gemini CLI, you can:
- Ask questions about your Jira projects in plain English
- Search issues, boards, and Confluence pages without leaving your terminal
- Get daily reports and project updates through conversational queries
- Combine Jira data with other tools (like GitHub) in a single AI session


### Quick Setup

1. **Set your credentials** (secure, reusable across projects)
   ```bash
   npm run setup:gemini
   ```
   This interactive script will guide you through setting up environment variables for your Jira and Confluence credentials.

2. **Configure Gemini CLI** (tell Gemini how to connect to your Jira server)
   ```bash
   npm run gemini:config
   ```
   This generates the proper configuration for Gemini CLI to use your Jira MCP server.

**Ready to use** - Your Gemini CLI is now configured to work with your Jira MCP server

### Detailed Setup
See [GEMINI_SETUP.md](./GEMINI_SETUP.md) for:
- Complete configuration options
- Combining with GitHub MCP and other servers
- Advanced usage examples and JQL patterns
- Troubleshooting guide
- Manual configuration steps

### Legacy Gemini Setup
If you prefer the manual approach:
- Copy the GEMINI.md file from this repo into the directory where you run the Gemini CLI. Gemini reads GEMINI.md to improve tool routing and parameter choices.
- If you work across multiple project folders, copy GEMINI.md into each folder where you'll invoke Gemini.

Common calls (examples)
- Jira: list issues with comments hydration
  { "jql": "project=ABC AND status != Done ORDER BY updated DESC", "fields": "summary,assignee,comment", "includeComments": true }

- Jira: get single issue with full details
  { "issueKey": "PROJ-123", "fields": "all" }

- Jira: analyze dependencies for a blocked ticket
  { "issueKey": "PROJ-123", "depth": 3 }

- Jira: traverse issue relationship graph
  { "issueKey": "PROJ-123", "depth": 3 }

- Jira: get issue changelog (status transitions, reassignments)
  { "issueKey": "PROJ-123", "maxResults": 100 }

- Confluence: get page with ancestors/breadcrumbs
  { "pageId": "123456", "expand": ["body.storage", "ancestors"] }

- Jira: extract confluence links from issue
  { "issueKey": "PROJ-123" }

- Confluence: extract jira keys from page
  { "pageId": "123456", "validate": true }

- Jira: list boards for a project
  { "projectKeyOrId": "ABC", "limit": 25 }

- Jira: issues for a board (exclude Done)
  { "boardId": 123, "jqlAppend": "status != Done", "fields": "summary,assignee", "limit": 50 }

- Confluence: search decisions/ADRs last 7d in ENG
  { "cql": "lastmodified >= '2025-09-18' AND label in ('Decision','ADR') AND space = ENG", "limit": 25 }

- Reports: daily brief for last 24h (São Paulo)
  { "from": "2025-09-24T12:00:00-03:00", "to": "2025-09-25T12:00:00-03:00", "projects": ["ABC","DMD"], "labelsBlocked": ["Blocked","Impeded"] }

Dependency Analysis Workflow (3-Stage Process)
For comprehensive dependency analysis across jira, code, and implementation planning:

**Stage 1: Jira/Confluence Discovery** (via jira_dependency_analysis tool)
- analyzes ticket dependencies (blocks, blocked by, relates to)
- extracts confluence documentation links
- identifies blocker patterns and bottlenecks
- outputs: jira_analysis.json with suggested code search prompt

**Stage 2: Code Analysis** (via github cli in your repository)
- uses suggested_prompt from stage 1 with claude/gemini in your repo
- searches github for related prs, commits, and cross-repo dependencies
- extracts implementation patterns from closed related tickets
- outputs: code_analysis.json with structured findings

**Stage 3: Synthesis** (correlates both analyses)
- uses SYNTHESIS_PROMPT.md template to analyze both json files
- generates tech lead context (for ticket descriptions)
- generates developer implementation guide (step-by-step plan)
- outputs: synthesis_analysis.json

See [DEPENDENCY_ANALYSIS.md](./DEPENDENCY_ANALYSIS.md) for detailed workflow and examples.
See [SYNTHESIS_PROMPT.md](./SYNTHESIS_PROMPT.md) for stage 3 template.

Where things live
- Minimal servers: scripts/minimal-server.mjs, scripts/confluence-minimal-server.mjs, scripts/report-minimal-server.mjs
- Jira client: src/jira/client.ts (HTTP + retries, Agile + Core APIs)
- Issue normalization: src/jira/issues.ts
- Main Jira server entry (optional): src/index.ts (exposes a minimal tool set)

Troubleshooting
- See TROUBLESHOOTING.md for common issues (tool list caching, logs not visible, 404 on Confluence without /wiki, Jira 410 search migration, name collisions).

Security
- Keep your Atlassian API token secret. Rotate it if it appears in shell history or logs.
