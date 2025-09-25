Troubleshooting

Tool list is empty or missing expected tools
- Use a fresh MCP server name in your client config (e.g., change `jira` → `jira-min` or `jira-dev`). Some clients cache tool lists by name.
- Ensure the process actually runs and stays up. Run it from a terminal to see stderr logs.
- Minimal servers (scripts/minimal-server.mjs and scripts/confluence-minimal-server.mjs) tend to be recognized more reliably by clients; prefer them to validate connectivity.

No logs visible in client
- Many MCP clients do not surface stderr. Run the server standalone to observe logs.
- For Jira full server, set `JIRA_MCP_DEBUG=1` to emit extra diagnostics to stderr.

Jira: 410 Gone on /rest/api/3/search
- This is expected on some sites. The client auto-migrates to `/rest/api/3/search/jql` internally.
- If you still see errors, try the minimal server first to isolate client issues.

Confluence: 404 Not Found on search
- Ensure your base URL includes the wiki path: `https://<site>.atlassian.net/wiki`.
- The minimal server auto-appends `/wiki` if omitted; double-check your env.

Tool name collisions across MCP servers
- Use prefixed tool names (this repo uses `jira_*` and `confluence_*`).
- If you have another server with the same tool name (e.g., `list_issues`), prefer unique names or disable the conflicting server.

Rate limiting (429) or transient 5xx
- Re-run. The Jira client includes backoff; for heavy usage add per-request concurrency limits.

Security: API tokens in history/logs
- Rotate tokens if they were pasted into shell history or committed by mistake.
- Prefer OS keychains or encrypted env stores. Never log tokens.

