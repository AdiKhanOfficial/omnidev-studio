#!/usr/bin/env node

/**
 * OmniDev Studio Standalone Server (Headless Mode)
 */

const serverManager = require('./server');
const tunnelManager = require('./tunnel');
const workspaceManager = require('./workspace');
const settingsManager = require('./settings');
const path = require('path');

async function main() {
  const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  workspaceManager.setWorkspace(targetDir);

  const port = process.env.PORT || settingsManager.get().serverPort || 3721;
  await serverManager.start(port);

  console.log('========================================================');
  console.log('⚡ OmniDev Studio MCP Server (Headless Mode) Online');
  console.log('========================================================');
  console.log(`📁 Active Workspace : ${workspaceManager.getWorkspace()}`);
  console.log(`🔌 Local Server    : http://localhost:${port}`);
  console.log(`🔑 Secret Token     : ${settingsManager.get().mcpSecretToken}`);
  console.log('--------------------------------------------------------');

  if (settingsManager.get().tunnelType === 'local') {
    console.log(`🤖 Tokenized MCP URL : ${serverManager.getMcpUrl()}`);
    return;
  }
  console.log('🌐 Starting Ngrok tunnel...');
  try {
    await tunnelManager.start({ port });
    console.log(`🚀 Public Ngrok URL   : ${tunnelManager.getInfo().url}`);
    console.log(`🤖 Tokenized MCP URL : ${serverManager.getMcpUrl()}`);
    console.log('💡 In ChatGPT Custom MCP Server, use the Tokenized MCP URL with "No authentication".');
  } catch (err) {
    console.warn('⚠️  Could not start Ngrok tunnel:', err.message);
  }
  console.log('========================================================\n');
}

main().catch(console.error);
