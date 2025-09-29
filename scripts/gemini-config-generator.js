#!/usr/bin/env node

/**
 * Gemini CLI Configuration Generator for Jira MCP
 * Generates or updates Gemini CLI settings.json with proper Jira MCP server configuration
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

function getGeminiConfigPath() {
  return join(homedir(), '.gemini', 'settings.json');
}

function getEnvVar(name, required = true) {
  const value = process.env[name];
  if (required && !value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadExistingConfig(configPath) {
  if (!existsSync(configPath)) {
    // Return default config structure
    return {
      selectedAuthType: "vertex-ai",
      theme: "Default",
      mcpServers: {}
    };
  }

  try {
    const content = readFileSync(configPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse existing config: ${error.message}`);
  }
}

function generateJiraMcpConfig() {
  const jiraMcpPath = getEnvVar('JIRA_MCP_PATH');
  const jiraBaseUrl = getEnvVar('JIRA_BASE_URL');
  const jiraEmail = getEnvVar('JIRA_EMAIL');
  const jiraApiToken = getEnvVar('JIRA_API_TOKEN');
  const confluenceBaseUrl = getEnvVar('CONFLUENCE_BASE_URL');
  const atlassianEmail = getEnvVar('ATLASSIAN_EMAIL');
  const atlassianApiToken = getEnvVar('ATLASSIAN_API_TOKEN');

  return {
    "jira-min": {
      command: "node",
      args: [join(jiraMcpPath, "scripts", "minimal-server.mjs")],
      cwd: jiraMcpPath,
      env: {
        JIRA_BASE_URL: jiraBaseUrl,
        JIRA_EMAIL: jiraEmail,
        JIRA_API_TOKEN: jiraApiToken
      }
    },
    "confluence-min": {
      command: "node",
      args: [join(jiraMcpPath, "scripts", "confluence-minimal-server.mjs")],
      cwd: jiraMcpPath,
      env: {
        CONFLUENCE_BASE_URL: confluenceBaseUrl,
        ATLASSIAN_EMAIL: atlassianEmail,
        ATLASSIAN_API_TOKEN: atlassianApiToken
      }
    },
    "reports-min": {
      command: "node",
      args: [join(jiraMcpPath, "scripts", "report-minimal-server.mjs")],
      cwd: jiraMcpPath,
      env: {
        JIRA_BASE_URL: jiraBaseUrl,
        JIRA_EMAIL: jiraEmail,
        JIRA_API_TOKEN: jiraApiToken,
        CONFLUENCE_BASE_URL: confluenceBaseUrl,
        ATLASSIAN_EMAIL: atlassianEmail,
        ATLASSIAN_API_TOKEN: atlassianApiToken
      }
    }
  };
}

function mergeConfigurations(existingConfig, jiraMcpConfig) {
  // Preserve existing configuration and add/update Jira MCP servers
  const mergedConfig = { ...existingConfig };

  // Ensure mcpServers exists
  if (!mergedConfig.mcpServers) {
    mergedConfig.mcpServers = {};
  }

  // Add or update Jira MCP servers
  Object.assign(mergedConfig.mcpServers, jiraMcpConfig);

  return mergedConfig;
}

function validateConfiguration(config) {
  // Check if required MCP servers are present
  const requiredServers = ['jira-min', 'confluence-min', 'reports-min'];
  const mcpServers = config.mcpServers || {};

  for (const server of requiredServers) {
    if (!mcpServers[server]) {
      throw new Error(`Missing required MCP server configuration: ${server}`);
    }

    const serverConfig = mcpServers[server];
    if (!serverConfig.command || !serverConfig.args || !serverConfig.cwd) {
      throw new Error(`Invalid configuration for server ${server}: missing command, args, or cwd`);
    }
  }
}

function main() {
  console.log('Generating Gemini CLI Configuration for Jira MCP');
  console.log('==================================================\\n');

  try {
    // Check required environment variables
    console.log('[*] Checking environment variables...');
    const requiredVars = [
      'JIRA_MCP_PATH',
      'JIRA_BASE_URL',
      'JIRA_EMAIL',
      'JIRA_API_TOKEN',
      'CONFLUENCE_BASE_URL',
      'ATLASSIAN_EMAIL',
      'ATLASSIAN_API_TOKEN'
    ];

    for (const varName of requiredVars) {
      const value = getEnvVar(varName, true);
      console.log(`   [+] ${varName}: ${varName.includes('TOKEN') ? value.substring(0, 8) + '...' : value}`);
    }

    // Load existing Gemini configuration
    const configPath = getGeminiConfigPath();
    console.log(`\\n[*] Gemini config path: ${configPath}`);

    // Ensure .gemini directory exists
    const geminiDir = dirname(configPath);
    if (!existsSync(geminiDir)) {
      console.log('[*] Creating .gemini directory...');
      mkdirSync(geminiDir, { recursive: true });
    }

    console.log('[*] Loading existing configuration...');
    const existingConfig = loadExistingConfig(configPath);

    if (existingConfig.mcpServers && Object.keys(existingConfig.mcpServers).length > 0) {
      console.log(`   Found ${Object.keys(existingConfig.mcpServers).length} existing MCP server(s)`);
    } else {
      console.log('   No existing MCP servers found');
    }

    // Generate Jira MCP configuration
    console.log('[*] Generating Jira MCP server configurations...');
    const jiraMcpConfig = generateJiraMcpConfig();

    // Merge configurations
    console.log('[*] Merging with existing configuration...');
    const finalConfig = mergeConfigurations(existingConfig, jiraMcpConfig);

    // Validate the final configuration
    console.log('[*] Validating configuration...');
    validateConfiguration(finalConfig);

    // Write the configuration
    console.log('[*] Writing configuration file...');
    writeFileSync(configPath, JSON.stringify(finalConfig, null, 2));

    console.log('\\n=== Gemini CLI configuration updated successfully! ===\\n');
    console.log('MCP Servers configured:');
    Object.keys(finalConfig.mcpServers).forEach(server => {
      const isJira = ['jira-min', 'confluence-min', 'reports-min'].includes(server);
      console.log(`   ${isJira ? '[+]' : '   '} ${server}`);
    });

    console.log('\\nNext steps:');
    console.log('1. Test the configuration:');
    console.log('   npm run gemini:test');
    console.log('2. For help and examples:');
    console.log('   cat GEMINI_SETUP.md\n');

  } catch (error) {
    console.error('[-] Configuration generation failed:', error.message);
    console.error('\nTroubleshooting:');
    console.error('1. Make sure you ran: npm run setup:gemini');
    console.error('2. Check that environment variables are set: env | grep JIRA');
    console.error('3. Ensure you sourced your shell config: source ~/.bashrc');
    process.exit(1);
  }
}

main();