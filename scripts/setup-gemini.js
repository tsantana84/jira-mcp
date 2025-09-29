#!/usr/bin/env node

/**
 * Interactive setup script for Gemini CLI integration with Jira MCP
 * This script helps users set up environment variables and basic configuration
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { createInterface } from 'readline';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function detectShell() {
  const shell = process.env.SHELL || '';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('bash')) return 'bash';
  return 'bash'; // default
}

function getShellConfigFile() {
  const shell = detectShell();
  const home = homedir();
  return shell === 'zsh' ? join(home, '.zshrc') : join(home, '.bashrc');
}

function validateUrl(url) {
  try {
    new URL(url);
    // Check for duplicate .atlassian.net patterns
    const atlassianPattern = /\.atlassian\.net/g;
    const matches = url.match(atlassianPattern);
    if (matches && matches.length > 1) {
      console.log('[-] Please enter a valid Atlassian URL (https://company.atlassian.net)');
      return false;
    }
    return url.startsWith('https://') && url.includes('.atlassian.net');
  } catch {
    return false;
  }
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function testJiraConnection(baseUrl, email, token) {
  console.log('\n[*] Testing Jira connection...');
  try {
    // Simple test using the existing ping script approach
    const env = {
      ...process.env,
      JIRA_BASE_URL: baseUrl,
      JIRA_EMAIL: email,
      JIRA_API_TOKEN: token
    };

    execSync('npm run ping', {
      env,
      stdio: 'pipe',
      cwd: process.cwd()
    });

    console.log('[+] Jira connection successful!');
    return true;
  } catch (error) {
    console.log('[-] Jira connection failed. Please check your credentials.');
    console.log('   Error:', error.message);
    return false;
  }
}

function addToShellConfig(configFile, envVars) {
  console.log(`\n Adding environment variables to ${configFile}...`);

  const marker = '# Jira MCP Configuration';
  const configContent = envVars.map(([key, value]) => `export ${key}="${value}"`).join('\n');
  const block = `\n${marker}\n${configContent}\n`;

  if (existsSync(configFile)) {
    const content = readFileSync(configFile, 'utf8');
    if (content.includes(marker)) {
      console.log('[!] Configuration already exists. Please update manually if needed.');
      return;
    }
  }

  appendFileSync(configFile, block);
  console.log('[+] Environment variables added to shell configuration');
  console.log(`   Please run: source ${configFile}`);
}

async function main() {
  console.log('=== Jira MCP + Gemini CLI Setup ===');
  console.log('=====================================\n');

  console.log('This script will help you configure Jira MCP for use with Gemini CLI.');
  console.log('We\'ll set up environment variables and test your connection.\n');

  // Get current working directory for JIRA_MCP_PATH
  const currentPath = process.cwd();

  console.log('Please provide your Atlassian credentials:\n');
  console.log('Why we need this:');
  console.log('   - Jira URL: To connect to your company\'s Jira instance');
  console.log('   - Email: Your Atlassian account email');
  console.log('   - API Token: For secure authentication (create at: https://id.atlassian.com/manage-profile/security/api-tokens)\n');

  // Get Jira configuration
  let jiraUrl;
  while (!jiraUrl) {
    const url = await question('Jira Base URL (e.g., https://company.atlassian.net): ');
    if (validateUrl(url)) {
      jiraUrl = url.replace(/\/$/, ''); // Remove trailing slash
    } else {
      console.log('[-] Please enter a valid Atlassian URL (https://company.atlassian.net)');
    }
  }

  let email;
  while (!email) {
    const inputEmail = await question('Your Atlassian email: ');
    if (validateEmail(inputEmail)) {
      email = inputEmail;
    } else {
      console.log('[-] Please enter a valid email address');
    }
  }

  const token = await question('Atlassian API Token: ');
  if (!token.trim()) {
    console.log('[-] API token cannot be empty');
    process.exit(1);
  }

  // Test the connection
  const connectionWorking = await testJiraConnection(jiraUrl, email, token);
  if (!connectionWorking) {
    const continueAnyway = await question('\\nConnection failed. Continue anyway? (y/N): ');
    if (!continueAnyway.toLowerCase().startsWith('y')) {
      console.log('Setup cancelled. Please check your credentials and try again.');
      process.exit(1);
    }
  }

  // Confluence URL (derive from Jira URL)
  const confluenceUrl = `${jiraUrl}/wiki`;

  console.log('\\n Configuration Summary:');
  console.log(`   Jira URL: ${jiraUrl}`);
  console.log(`   Confluence URL: ${confluenceUrl}`);
  console.log(`   Email: ${email}`);
  console.log(`   Token: ${token.substring(0, 8)}...`);
  console.log(`   Project Path: ${currentPath}\\n`);

  const confirm = await question('Save this configuration? (Y/n): ');
  if (confirm.toLowerCase() === 'n') {
    console.log('Setup cancelled.');
    process.exit(0);
  }

  // Prepare environment variables
  const envVars = [
    ['JIRA_BASE_URL', jiraUrl],
    ['JIRA_EMAIL', email],
    ['JIRA_API_TOKEN', token],
    ['CONFLUENCE_BASE_URL', confluenceUrl],
    ['ATLASSIAN_EMAIL', email],
    ['ATLASSIAN_API_TOKEN', token],
    ['JIRA_MCP_PATH', currentPath]
  ];

  // Add to shell configuration
  const configFile = getShellConfigFile();
  addToShellConfig(configFile, envVars);

  console.log('\\n=== Setup Complete! ===\\n');
  console.log('Next steps:');
  console.log('1. Reload your shell configuration:');
  console.log(`   source ${configFile}`);
  console.log('2. Generate Gemini CLI configuration:');
  console.log('   npm run gemini:config');
  console.log('3. Test the integration:');
  console.log('   npm run gemini:test\\n');
  console.log('For detailed usage instructions, see GEMINI_SETUP.md');

  rl.close();
}

main().catch((error) => {
  console.error('[-] Setup failed:', error.message);
  rl.close();
  process.exit(1);
});