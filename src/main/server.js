const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const toolRegistry = require('./tools');
const jobsManager = require('./jobs');
const workspaceManager = require('./workspace');
const projectsManager = require('./projects');
const settingsManager = require('./settings');
const tunnelManager = require('./tunnel');

class ServerManager {
  constructor() {
    this.app = express();
    this.server = null;
    this.port = 3721;
    this.sseSessions = new Map();
    this.setupRoutes();
  }

  getSecretToken() {
    return settingsManager.get().mcpSecretToken;
  }

  getLocalMcpUrl() {
    return `http://127.0.0.1:${this.port}/mcp/${encodeURIComponent(this.getSecretToken())}`;
  }

  getMcpUrl() {
    const token = this.getSecretToken();
    if (settingsManager.get().tunnelType === 'local') return this.getLocalMcpUrl();
    const base = tunnelManager.getInfo().url;
    return base ? `${base}/mcp/${encodeURIComponent(token)}` : '';
  }

  setupRoutes() {
    // Permissive CORS & Headers
    this.app.use(cors({ origin: true, credentials: true }));
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    this.app.use((req, res, next) => {
      res.setHeader('bypass-tunnel-reminder', 'true');
      res.setHeader('ngrok-skip-browser-warning', 'true');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
      res.setHeader('Access-Control-Allow-Headers', '*');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });

    // Token Validator Helper
    const validateToken = (req) => {
      const activeToken = settingsManager.get().mcpSecretToken;
      if (!activeToken) return true; // If no token configured

      const pathToken = req.params?.token;
      const queryToken = req.query?.token;
      const authHeader = req.headers?.authorization;

      let bearer = null;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        bearer = authHeader.slice(7).trim();
      }

      return (
        pathToken === activeToken ||
        queryToken === activeToken ||
        bearer === activeToken
      );
    };

    this.app.use('/api', (req, res, next) => {
      if (req.get('Authorization') !== `Bearer ${this.getSecretToken()}`) {
        return res.status(403).json({ error: 'Invalid or missing authorization.' });
      }
      if (this.requireProject && req.path.startsWith('/fs/') && req.path !== '/fs/tree' && !projectsManager.getActive()) {
        return res.status(409).json({ error: 'Open a workspace first.' });
      }
      next();
    });

    // Health check endpoint
    this.app.get('/api/health', (req, res) => {
      const activeProject = projectsManager.getActive();
      res.json({
        status: 'online',
        server: 'OmniDev Studio MCP',
        version: '2.0.0',
        activeProject: activeProject ? { name: activeProject.name, path: activeProject.path } : null,
        workspace: workspaceManager.getInfo(),
        tunnel: tunnelManager.getInfo(),
        mcpEndpoint: this.getMcpUrl(),
        tools_registered: toolRegistry.getSchemas().length
      });
    });

    // Unified MCP JSON-RPC Handler
    const handleMcpJsonRpc = async (req, res) => {
      if (!validateToken(req)) {
        return res.status(403).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Forbidden: Invalid or missing security token. Please use the secure URL from OmniDev Studio (https://.../mcp/:token).'
          }
        });
      }

      const body = req.body;
      if (!body || typeof body !== 'object' || body.jsonrpc !== '2.0') {
        return res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Invalid Request: Expected JSON-RPC 2.0' }
        });
      }

      const id = body.id;
      const method = body.method;
      const activeProject = projectsManager.getActive();
      const workspacePath = this.requireProject && !activeProject ? null : workspaceManager.getWorkspace();

      // MCP: initialize
      if (method === 'initialize') {
        let instructions = `You are connected to OmniDev Studio, the AI-powered desktop development workspace.\n`;
        instructions += workspacePath
          ? `Active Project: ${activeProject?.name || 'Workspace'}\nWorkspace Directory: ${workspacePath}\n`
          : 'Open a workspace in OmniDev Studio before using tools.\n';
        if (activeProject?.notes) {
          instructions += `Environment & Developer Notes: ${activeProject.notes}\n`;
        }
        const toolCount = toolRegistry.getSchemas().length;
        instructions += `You have ${toolCount} tools to read/write/edit files, run PowerShell/CMD terminal commands, inspect SQLite & MySQL databases, manage processes, reverse-engineer binaries/APKs, drive a headless browser, and check ports. Check get_project_context for environment credentials.`;

        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']
              .includes(body.params?.protocolVersion) ? body.params.protocolVersion : '2025-03-26',
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'OmniDev-Studio',
              version: '2.0.0'
            },
            instructions
          }
        });
      }

      // MCP: notifications/initialized
      if (id === undefined) return res.status(202).end();
      if (method === 'ping') return res.json({ jsonrpc: '2.0', id, result: {} });

      // MCP: tools/list
      if (method === 'tools/list') {
        const schemas = toolRegistry.getSchemas();
        const mcpTools = schemas.map(s => ({
          name: s.name,
          description: s.description,
          inputSchema: s.inputSchema
        }));

        return res.json({
          jsonrpc: '2.0',
          id,
          result: { tools: mcpTools }
        });
      }

      // MCP: tools/call
      if (method === 'tools/call') {
        if (this.requireProject && !activeProject) {
          return res.json({ jsonrpc: '2.0', id, result: { isError: true, content: [
            { type: 'text', text: 'Open a workspace in OmniDev Studio before using tools.' }
          ] } });
        }
        const { name, arguments: args } = body.params || {};
        try {
          const toolResult = await toolRegistry.executeTool(name, args || {});
          const isError = toolResult && toolResult.approved === false;

          let textContent = '';
          if (typeof toolResult === 'string') {
            textContent = toolResult;
          } else {
            textContent = JSON.stringify(toolResult, null, 2);
          }

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: textContent
                }
              ],
              isError: Boolean(isError)
            }
          });
        } catch (err) {
          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `Tool Error: ${err.message}` }],
              isError: true
            }
          });
        }
      }

      return res.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method "${method}" not recognized by OmniDev MCP.` }
      });
    };

    // Mount Secure MCP routes (supporting /mcp/:token, /mcp, /sse/:token, /sse, /messages/:token)
    this.app.post('/mcp/:token', handleMcpJsonRpc);
    this.app.post('/mcp', handleMcpJsonRpc);
    this.app.post('/messages/:token', handleMcpJsonRpc);
    this.app.post('/messages', handleMcpJsonRpc);

    // SSE Transport
    const handleSse = (req, res) => {
      if (!validateToken(req)) {
        return res.status(403).send('Forbidden: Invalid security token.');
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const activeToken = settingsManager.get().mcpSecretToken;
      const endpointUri = `/messages/${activeToken}`;
      res.write(`event: endpoint\ndata: ${endpointUri}\n\n`);

      req.on('close', () => {});
    };

    this.app.get('/mcp/:token', (req, res) => {
      const accept = req.headers.accept || '';
      if (accept.includes('text/event-stream')) {
        return res.sendStatus(validateToken(req) ? 405 : 403);
      }
      res.json({
        service: 'OmniDev Studio MCP Server',
        status: 'ready',
        endpoint: `/mcp/${req.params.token}`
      });
    });

    this.app.get('/mcp', (req, res) => {
      const accept = req.headers.accept || '';
      if (accept.includes('text/event-stream')) {
        return res.sendStatus(validateToken(req) ? 405 : 403);
      }
      res.json({
        service: 'OmniDev Studio MCP Server',
        status: 'ready'
      });
    });

    this.app.get('/sse/:token', handleSse);
    this.app.get('/sse', handleSse);

    // File Explorer APIs for VS Code GUI
    this.app.get('/api/fs/tree', async (req, res) => {
      if (this.requireProject && !projectsManager.getActive()) return res.json({ tree: [] });
      const wsPath = workspaceManager.getWorkspace();
      try {
        const buildTree = async (dir, depth = 0) => {
          if (depth > 4 || res.destroyed) return [];
          const list = await fs.promises.readdir(dir, { withFileTypes: true });
          const nodes = [];

          // Sort directories first, then files
          list.sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name);
          });

          for (const item of list) {
            if (res.destroyed) break;
            if (item.name === 'node_modules' || item.name === '.git' || item.name === '.venv') {
              nodes.push({
                name: item.name,
                path: path.relative(wsPath, path.join(dir, item.name)).replace(/\\/g, '/'),
                isDirectory: true,
                children: []
              });
              continue;
            }

            const itemFull = path.join(dir, item.name);
            const relPath = path.relative(wsPath, itemFull).replace(/\\/g, '/');

            if (item.isDirectory()) {
              nodes.push({
                name: item.name,
                path: relPath,
                isDirectory: true,
                children: await buildTree(itemFull, depth + 1)
              });
            } else {
              let size = 0;
              try { size = (await fs.promises.stat(itemFull)).size; } catch {}
              nodes.push({
                name: item.name,
                path: relPath,
                isDirectory: false,
                size
              });
            }
          }
          return nodes;
        };

        const tree = await buildTree(wsPath);
        if (!res.destroyed) res.json({ root: path.basename(wsPath), fullPath: wsPath, tree });
      } catch (err) {
        if (!res.destroyed) res.status(500).json({ error: err.message });
      }
    });

    this.app.get('/api/fs/file', (req, res) => {
      const relPath = req.query.path;
      if (!relPath) return res.status(400).json({ error: 'path is required' });

      try {
        const resolved = workspaceManager.resolvePath(relPath);
        if (!fs.existsSync(resolved)) {
          return res.status(404).json({ error: 'File not found' });
        }
        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
          return res.status(400).json({ error: 'Path is a directory' });
        }
        const content = fs.readFileSync(resolved, 'utf8');
        res.json({
          path: relPath,
          size: stat.size,
          modified: stat.mtime,
          content
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.post('/api/fs/save', (req, res) => {
      const { path: relPath, content } = req.body;
      if (!relPath || content === undefined) {
        return res.status(400).json({ error: 'path and content are required' });
      }

      try {
        const resolved = workspaceManager.resolvePath(relPath);
        fs.writeFileSync(resolved, content, 'utf8');
        workspaceManager.notifyChanged();
        res.json({ success: true, path: relPath });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Tools & Jobs internal endpoints
    this.app.get('/api/jobs', (req, res) => {
      res.json({ jobs: jobsManager.listJobs() });
    });

    this.app.get('/api/jobs/:id/output', (req, res) => {
      const output = jobsManager.getJobOutput(req.params.id, 500);
      if (!output) return res.status(404).json({ error: 'Job not found' });
      res.json(output);
    });

    this.app.post('/api/jobs/:id/cancel', (req, res) => {
      res.json(jobsManager.cancelJob(req.params.id, req.body?.reason));
    });
  }

  async start(port = 3721, { requireProject = false } = {}) {
    this.port = Number(port);
    this.requireProject = requireProject;
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, '127.0.0.1', () => {
        this.port = this.server.address().port;
        resolve({ port: this.port });
      });
      this.server.on('error', reject);
    });
  }

  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(resolve);
        this.server = null;
      });
    }
  }
}

module.exports = new ServerManager();
