Using These Tools (for Gemini)

Place this file (GEMINI.md) in the working directory where you run the Gemini CLI. Gemini reads GEMINI.md files to guide tool usage and routing.

Goal
- Route natural‑language requests to the right MCP tools in this repo. Keep arguments explicit and pass time windows as ISO strings.

Servers and tools
- jira-min
  - jira_list_issues — JQL search; accepts fields as CSV/array or "summary"/"all"; supports includeComments
  - jira_list_projects — list/search projects
  - jira_list_boards — list Agile boards (filter by project/type/name)
  - jira_board_issues — issues for a board (resolves board filter; falls back to Agile endpoint)
- confluence-min
  - confluence_search_pages — CQL search; filter by labels/space; optional body (storage/ADF)
- reports-min
  - ops_daily_brief — last 24h window summary: Jira (new/transitions/blocked/unassigned) + Confluence (Decision/ADR)
  - ops_shift_delta — changes from a given time window; risk-focused
  - ops_jira_review_radar — issues stuck in review > idle threshold

Time windows
- Always pass ISO timestamps (from, to). For “last 24h”: from = now-24h, to = now. Respect user timezone when provided (e.g., America/Sao_Paulo).

JQL/CQL patterns
- Jira (JQL)
  - New in window: created >= "<from>" AND created <= "<to>"
  - Blocked: status CHANGED TO ("Blocked","Impeded") DURING ("<from>","<to>")
  - Unassigned: assignee IS EMPTY AND updated >= "<from>" AND updated <= "<to>"
  - In‑review idle: status in ("In Review","Code Review") AND updated <= "<cutoff>"
- Confluence (CQL)
  - Decisions/ADRs: lastmodified >= "<from>" AND label in ("Decision","ADR") [AND space = KEY]
  - Runbooks: label = "runbook" [AND space = KEY]

Examples
- “Daily brief for last 24h (America/Sao_Paulo) for projects ABC,DMD”
  → ops_daily_brief { from:"…", to:"…", projects:["ABC","DMD"], labelsBlocked:["Blocked","Impeded"] }
- “What changed since I logged off at 19:00 yesterday?”
  → ops_shift_delta { from:"…", to:"…" }
- “Issues waiting for review >18h in ABC”
  → ops_jira_review_radar { idleHours:18, projects:["ABC"], statusesInReview:["In Review","Code Review"], limit:50 }
- “Find Confluence decisions updated this week in ENG”
  → confluence_search_pages { cql:"lastmodified >= '…' AND label in ('Decision','ADR') AND space = ENG", limit:25 }
- “List Jira bugs last 7d for DMD by priority”
  → jira_list_issues { jql:"project = DMD AND type=Bug AND created >= '…' ORDER BY priority DESC", fields:"summary" }

Outputs
- Tools return a single text content item containing a JSON string. Extract fields to present tables or bullet lists with links.

Operational hints
- If a tool is missing, restart the client or use a fresh server name (jira-min, confluence-min, reports-min) to bypass cached tool lists.
