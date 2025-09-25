Jira MCP Server

Scope
- Jira Cloud only, API token auth (email + token)
- Issues-focused tools: search, read, create, update, comment, list/perform transitions
- No webhooks, boards/sprints, attachments, or links (for now)

Setup
- Requirements: Node.js >= 18, npm
- Env vars (required):
  - `JIRA_BASE_URL` (e.g., https://your-domain.atlassian.net)
  - `JIRA_EMAIL`
  - `JIRA_API_TOKEN`
- Env vars (optional):
  - `DEFAULT_PROJECT_KEY`
  - `DEFAULT_ISSUE_TYPE` (e.g., Task, Bug)

Install
1) Install deps
   npm install
2) Build
   npm run build

Run (stdio)
- Dev (ts-node):
  JIRA_BASE_URL=... JIRA_EMAIL=... JIRA_API_TOKEN=... npx ts-node src/index.ts
- Built JS:
  JIRA_BASE_URL=... JIRA_EMAIL=... JIRA_API_TOKEN=... node dist/index.js
 - Minimal Jira (known-good for MCP UIs):
   JIRA_BASE_URL=... JIRA_EMAIL=... JIRA_API_TOKEN=... npm run start:jira-min

MCP Client Configuration
- Example Claude Desktop `mcp.json` entry:
  {
    "mcpServers": {
      "jira": {
        "command": "node",
        "args": ["dist/index.js"],
        "env": {
          "JIRA_BASE_URL": "https://your-domain.atlassian.net",
          "JIRA_EMAIL": "you@example.com",
          "JIRA_API_TOKEN": "<token>",
          "DEFAULT_PROJECT_KEY": "ABC",
          "DEFAULT_ISSUE_TYPE": "Task"
        }
      }
    }
  }

Available Tools (currently exposed)
- `jira_list_issues(jql, limit?, startAt?, fields?)`

Notes
- Other Jira operations (get_issue, create/update, comments, transitions, projects) are implemented but not exposed to the client to keep the surface minimal during initial setup. We can re-enable them later.

Behavior & Safety
- Mutating tools require `confirm=true`. If omitted/false, server returns a preview of the outbound Jira request instead of mutating.
- Description/comment inputs are plain text; server wraps to minimal Atlassian ADF.

Notes
- HTTP calls are implemented via `undici` in `src/jira/client.ts`. Mutations respect `confirm=true` and otherwise return a preview payload.
- Normalization helpers live in `src/jira/issues.ts`.

Development Tips
- Start by implementing read-only calls (`search`, `get_issue`, `list_projects`, `list_transitions`).
- Add retries for 429/5xx and respect Retry-After.
- Pass `fields` to Jira for lean responses by default (e.g., summary-only).

Confluence (Minimal) — Optional
- You can use the same Atlassian email + API token for Confluence.
- Base URL is different: `CONFLUENCE_BASE_URL=https://<site>.atlassian.net/wiki`.
- A minimal stdio server is provided that exposes one tool: `confluence_search_pages`.

Run (Confluence minimal)
- Build the repo (to install deps):
  npm install && npm run build
- Configure env:
  CONFLUENCE_BASE_URL=https://<site>.atlassian.net/wiki
  ATLASSIAN_EMAIL=you@example.com
  ATLASSIAN_API_TOKEN=<token>
- Start:
  node scripts/confluence-minimal-server.mjs

MCP config example (Confluence minimal)
{
  "mcpServers": {
    "confluence-min": {
      "command": "/usr/bin/node", // or your node path
      "args": ["/absolute/path/to/scripts/confluence-minimal-server.mjs"],
      "cwd": "/absolute/path/to/repo",
      "transport": "stdio",
      "env": {
        "CONFLUENCE_BASE_URL": "https://your-domain.atlassian.net/wiki",
        "ATLASSIAN_EMAIL": "you@example.com",
        "ATLASSIAN_API_TOKEN": "<token>"
      }
    }
  }
}

Tool parameters
- `confluence_search_pages` accepts:
  - `cql` (string, required)
  - `limit` (1–100), `start` (offset)
  - `includeBody` (boolean), `bodyFormat` ("storage" | "atlas_doc")
  - `includeExcerpt` (boolean, default true)
  - `types` (["page" | "blogpost"]), default ["page"]
  - `spaceKey` (string): convenience to append space=KEY to CQL if not present
  - `maxChars` (truncate text), default 800

Client Config Examples
- A full example with providers and MCP servers is in `examples/mcp.example.json`. Copy and adjust absolute paths and envs for your machine.

Troubleshooting
- See TROUBLESHOOTING.md for common issues (tool caching, logs, 410/404 fixes, name collisions).

Security
- Treat your Atlassian API token like a password. Rotate it if it appears in command history or logs.
