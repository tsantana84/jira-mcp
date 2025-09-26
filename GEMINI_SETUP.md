# Gemini CLI Setup Guide

Complete guide for using this Jira MCP server with Gemini CLI from your terminal.

## What is this?

**MCP (Model Context Protocol)** is a standard that allows AI assistants to use external tools safely and consistently. Think of it as a bridge that lets AI access your Jira data.

**Gemini CLI** is Google's terminal-based AI assistant. Instead of using a web interface, you can chat with AI directly from your command line.

**This Jira MCP Server** exposes your Jira and Confluence data as tools that Gemini CLI can use when you ask questions.

## Why use this approach?

* **Natural Language**: Ask "show me bugs assigned to me" instead of learning JQL syntax
* **Terminal Workflow**: Stay in your development environment
* **Secure**: Your credentials stay on your machine
* **Combinable**: Use Jira data alongside other MCP tools (GitHub, files, etc.)
* **Scriptable**: Build automated workflows and reports

## Prerequisites

Before starting, make sure you have:

1. **Node.js 18+** installed
2. **Gemini CLI** installed:
   ```bash
   npm install -g @google/gemini-cli
   ```
3. **Atlassian API Token** - [Create one here](https://id.atlassian.com/manage-profile/security/api-tokens)
4. **This repository** cloned and built:
   ```bash
   git clone <this-repo>
   cd jira-mcp
   npm install
   npm run build
   ```

## Quick Setup (Recommended)

### Step 1: Interactive Setup
```bash
npm run setup:gemini
```

This script will:
- **Why?** Securely store your credentials as environment variables
- Walk you through entering your Jira URL, email, and API token
- Add the configuration to your shell profile (`.bashrc` or `.zshrc`)
- Validate your credentials work

### Step 2: Generate Gemini Configuration
```bash
npm run gemini:config
```

This script will:
- **Why?** Tell Gemini CLI how to start and communicate with your Jira MCP server
- Create or update your Gemini CLI settings file
- Configure all three server variants (jira-min, confluence-min, reports-min)
- Preserve any existing MCP servers you have configured

### Step 3: Test the Setup
```bash
npm run gemini:test
```

This will:
- **Why?** Verify everything is working before you start using it
- Test your Jira connection
- List available MCP tools in Gemini
- Show example commands you can try

## Manual Setup (Advanced)

If you prefer to configure everything yourself:

### 1. Set Environment Variables

Add these to your `~/.bashrc` or `~/.zshrc`:

```bash
# Jira MCP Configuration
export JIRA_BASE_URL="https://your-company.atlassian.net"
export JIRA_EMAIL="your-email@company.com"
export JIRA_API_TOKEN="your-api-token-here"
export CONFLUENCE_BASE_URL="https://your-company.atlassian.net/wiki"
export ATLASSIAN_EMAIL="your-email@company.com"
export ATLASSIAN_API_TOKEN="your-api-token-here"
export JIRA_MCP_PATH="/absolute/path/to/jira-mcp"
```

**Why environment variables?**
- Keeps credentials out of config files
- Easy to update without touching code
- Can be different per project/environment

### 2. Configure Gemini CLI

Edit your Gemini CLI settings file (`~/.gemini/settings.json`):

```json
{
  "selectedAuthType": "vertex-ai",
  "theme": "Default",
  "mcpServers": {
    "jira-min": {
      "command": "node",
      "args": ["/absolute/path/to/jira-mcp/scripts/minimal-server.mjs"],
      "cwd": "/absolute/path/to/jira-mcp",
      "env": {
        "JIRA_BASE_URL": "https://your-company.atlassian.net",
        "JIRA_EMAIL": "your-email@company.com",
        "JIRA_API_TOKEN": "your-api-token-here"
      }
    },
    "confluence-min": {
      "command": "node",
      "args": ["/absolute/path/to/jira-mcp/scripts/confluence-minimal-server.mjs"],
      "cwd": "/absolute/path/to/jira-mcp",
      "env": {
        "CONFLUENCE_BASE_URL": "https://your-company.atlassian.net/wiki",
        "ATLASSIAN_EMAIL": "your-email@company.com",
        "ATLASSIAN_API_TOKEN": "your-api-token-here"
      }
    },
    "github": {
      "httpUrl": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "Bearer your-github-token"
      },
      "timeout": 5000
    }
  }
}
```

**Why multiple servers?**
- **jira-min**: Core Jira functionality (issues, projects, boards)
- **confluence-min**: Confluence pages and search
- **reports-min**: Combined reporting across both systems
- **github**: Example of combining with other tools


## Understanding the Configuration

### Server Types Explained

1. **jira-min** (Minimal Jira Server)
   - **Purpose**: Core Jira operations
   - **Tools**: `jira_list_issues`, `jira_list_projects`, `jira_list_boards`, `jira_board_issues`
   - **When to use**: General issue tracking, project management

2. **confluence-min** (Minimal Confluence Server)
   - **Purpose**: Confluence content search
   - **Tools**: `confluence_search_pages`
   - **When to use**: Finding documentation, decisions, runbooks

3. **reports-min** (Combined Reporting Server)
   - **Purpose**: Cross-system analytics
   - **Tools**: `ops_daily_brief`, `ops_shift_delta`, `ops_jira_review_radar`
   - **When to use**: Team reports, operational insights

### Environment Variables Explained

| Variable | Purpose | Example |
|----------|---------|---------|
| `JIRA_BASE_URL` | Your Jira instance URL | `https://company.atlassian.net` |
| `JIRA_EMAIL` | Your Atlassian account email | `you@company.com` |
| `JIRA_API_TOKEN` | API token for authentication | `ATATT3x...` |
| `CONFLUENCE_BASE_URL` | Confluence URL with /wiki path | `https://company.atlassian.net/wiki` |
| `JIRA_MCP_DEBUG` | Enable debug logging (optional) | `1` |

## Common Use Cases

### Daily Standup Preparation
```bash
gemini "show me what I worked on yesterday and what's assigned to me today"
```

### Project Health Checks
```bash
gemini "give me a daily brief for project ABC for the last 24 hours"
gemini "show me any blocked or high-priority issues"
```

### Documentation Discovery
```bash
gemini "find recent architecture decisions in the ENG space"
gemini "search for documentation about our deployment process"
```

### Cross-tool Analysis
```bash
# If you have multiple MCP servers
gemini "compare my Jira workload with my GitHub activity"
```

## Troubleshooting

### "No MCP servers found"
- **Check**: Gemini CLI is properly installed and updated
- **Check**: Your settings.json file exists and has proper syntax
- **Try**: `gemini --version` and `npm run gemini:config`

### "Authentication failed"
- **Check**: Environment variables are set correctly: `echo $JIRA_BASE_URL`
- **Check**: API token is valid and has proper permissions
- **Try**: `npm run ping` to test Jira connectivity directly

### "Tool not found"
- **Check**: MCP server is starting properly
- **Try**: `JIRA_MCP_DEBUG=1 npm run start:jira-min` to see debug logs
- **Try**: Restart Gemini CLI after configuration changes

### "Permission denied"
- **Check**: File paths in settings.json are absolute and correct
- **Check**: Scripts have execute permissions: `chmod +x scripts/*.mjs`

### Environment Variables Not Loaded
- **Try**: Restart your terminal after adding to `.bashrc`/`.zshrc`
- **Check**: Source your profile: `source ~/.bashrc` or `source ~/.zshrc`
- **Check**: Variables are exported: `export JIRA_BASE_URL=...`

## Advanced Configuration

### Adding Custom Aliases
Add to your shell profile for convenience:

```bash
# Quick setup commands
alias setup-jira='npm run setup:gemini'
alias config-jira='npm run gemini:config'
```

### Project-Specific Configuration
For different projects, you can override environment variables:

```bash
# In project A directory
export JIRA_BASE_URL="https://projecta.atlassian.net"

# In project B directory
export JIRA_BASE_URL="https://projectb.atlassian.net"
```

### Combining Multiple MCP Servers
Your settings.json can include multiple servers:

```json
{
  "mcpServers": {
    "jira-min": { /* Jira config */ },
    "github": { /* GitHub config */ },
    "filesystem": { /* File system tools */ },
    "custom-tools": { /* Your custom tools */ }
  }
}
```

## Security Best Practices

🔒 **Never commit API tokens** to version control
🔒 **Use environment variables** for all credentials
🔒 **Rotate tokens regularly** (quarterly recommended)
🔒 **Limit token permissions** to only what you need
🔒 **Use different tokens** for different environments

## Getting Help

- **Documentation**: Check this guide and the main README.md
- **Debug mode**: Set `JIRA_MCP_DEBUG=1` for detailed logs
- **Test commands**: Use `npm run ping` and `npm run gemini:test`
- **Community**: Check GitHub issues for common problems

## Next Steps

Once you have this working:

1. **Explore other MCP servers** - There are many available for different tools
2. **Create custom workflows** - Combine multiple tools in single queries
3. **Build automation** - Use Gemini CLI in scripts for regular reports
4. **Share with your team** - Help others set up the same configuration