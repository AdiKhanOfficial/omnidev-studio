const { app, BrowserWindow, ipcMain, dialog, Notification, Tray, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

app.setName('OmniDev Studio');
if (app.isPackaged) {
  const dataDirectory = app.getPath('userData');
  fs.mkdirSync(dataDirectory, { recursive: true });
  process.chdir(dataDirectory);
}
app.setAppUserModelId('com.omnidev.studio');

const serverManager = require('./server');
const tunnelManager = require('./tunnel');
const workspaceManager = require('./workspace');
const permissionsManager = require('./permissions');
const jobsManager = require('./jobs');
const toolRegistry = require('./tools');
const projectsManager = require('./projects');
const settingsManager = require('./settings');
const pluginsManager = require('./plugins');
const audit = require('./audit');
const backups = require('./backups');
const checkpoints = require('./checkpoints');
const vault = require('./vault');
const triggersManager = require('./triggers');
const discovery = require('./discovery');
const dbTools = require('./tools/database');
const mysqlTools = require('./tools/mysql');
const browserTools = require('./tools/browser');
const { configureClient, getSkillsDirectory, requireInstalledClient } = require('./mcp-clients');

let tunnelTask = Promise.resolve();
function refreshTunnel() {
  tunnelTask = tunnelTask.then(async () => {
    await tunnelManager.stop();
    const settings = settingsManager.get();
    if (settings.tunnelType === 'ngrok') await tunnelManager.start({ port: settings.serverPort });
  }).catch(error => console.warn('[OmniDev] Tunnel:', error.message));
  return tunnelTask;
}

let mainWindow = null;
let tray = null;
let isQuitting = false;

// Links the previewed site tries to open in a new window go to the system browser,
// and the embedded page never gets Node access.
app.on('web-contents-created', (event, contents) => {
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
  }
  contents.on('will-attach-webview', (e, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });
});

function createWindow() {
  const iconPath = path.join(__dirname, '../../assets/icon.png');

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1020,
    minHeight: 680,
    frame: false, // Frameless custom window control bar
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    title: 'OmniDev Studio - AI Local Development Agent',
    backgroundColor: '#11111a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      // Live Preview uses <webview>: unlike an <iframe> it is not blocked by the
      // X-Frame-Options / frame-ancestors headers most dev servers send.
      webviewTag: true
    },
    autoHideMenuBar: true
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-maximized-state', true);
    }
  });

  mainWindow.on('unmaximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-maximized-state', false);
    }
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('show-close-dialog');
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const icon32 = path.join(__dirname, '../../assets/icon-32.png');
  const iconMain = path.join(__dirname, '../../assets/icon.png');
  const trayIconPath = fs.existsSync(icon32) ? icon32 : iconMain;

  try {
    tray = new Tray(trayIconPath);
    const contextMenu = Menu.buildFromTemplate([
      { label: 'OmniDev Studio', enabled: false },
      { label: `Status: MCP Server Online (Port ${settingsManager.get().serverPort || 3721})`, enabled: false },
      { type: 'separator' },
      {
        label: 'Open OmniDev Studio',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit OmniDev Studio',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setToolTip('OmniDev Studio - Local Development MCP Server');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible()) {
        if (mainWindow.isFocused()) {
          mainWindow.hide();
        } else {
          mainWindow.focus();
        }
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (err) {
    console.warn('[Tray] Notice:', err.message);
  }
}

app.whenReady().then(async () => {
  createWindow();
  createTray();

  // Load active project workspace
  const activeProj = projectsManager.getActive();
  if (activeProj && activeProj.path) {
    workspaceManager.setWorkspace(activeProj.path);
  } else {
    workspaceManager.setWorkspace(process.cwd());
  }

  // Load settings
  const settings = settingsManager.get();
  permissionsManager.setMode(settings.permissionMode || 'smart');
  permissionsManager.setToolPolicies(settings.toolPolicies || {});
  workspaceManager.setAllowEscape(settings.allowEscape || false);

  // Start internal Express + MCP server
  try {
    await serverManager.start(settings.serverPort || 3721, { requireProject: true });
    console.log(`[OmniDev] Server listening on port ${settings.serverPort || 3721}`);
  } catch (err) {
    console.error('[OmniDev] Server start error:', err);
  }

  // Event forwarding to Renderer
  permissionsManager.on('approvalRequested', (req) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('approval-requested', req);
      if (!mainWindow.isFocused()) {
        mainWindow.flashFrame(true);
        if (Notification.isSupported()) {
          new Notification({
            title: 'OmniDev: Action Approval Required',
            body: `AI requested: ${req.tool}`
          }).show();
        }
      }
    }
  });

  permissionsManager.on('approvalResolved', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('approval-resolved', data);
    }
  });

  jobsManager.on('jobStarted', (job) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('job-started', job);
    }
  });

  jobsManager.on('jobOutput', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('job-output', data);
    }
  });

  jobsManager.on('jobFinished', (job) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('job-finished', job);
    }
  });

  toolRegistry.on('toolExecuted', (record) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tool-executed', record);
    }
  });

  // When AI updates project context via update_project_context tool,
  // notify the renderer so the sidebar notes & blank canvas update instantly.
  projectsManager.on('projectUpdated', (project) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('project-context-updated', project);
    }
  });

  // Instant file explorer refresh watcher
  workspaceManager.on('fs-changed', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('workspace-files-changed', data);
    }
    triggersManager.onFileChange();
  });

  // Automation triggers — run tools on interval / file-change
  triggersManager.init((name, params) => toolRegistry.executeTool(name, params));
  triggersManager.start();
  triggersManager.on('triggerFired', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('trigger-fired', info);
  });

  tunnelManager.on('statusChanged', (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tunnel-status', {
        ...status,
        mcpUrl: serverManager.getMcpUrl()
      });
    }
  });

  tunnelManager.on('tunnelError', (err) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tunnel-error', err);
    }
  });
  if (serverManager.server?.listening && settings.tunnelType === 'ngrok') void refreshTunnel();

  // Load custom plugins from plugins/ directory
  pluginsManager.on('pluginLoaded', (plugin) => {
    // Register into tool registry (overwrite if already exists by name)
    // Remove old schema entry if any
    toolRegistry.schemas = toolRegistry.schemas.filter(s => s.name !== plugin.name);
    delete toolRegistry.tools[plugin.name];

    toolRegistry.register(plugin.name, plugin.description, plugin.inputSchema, plugin.handler, plugin.isCritical);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('plugin-loaded', {
        name: plugin.name,
        file: plugin.file,
        loadedAt: plugin.loadedAt
      });
    }
    console.log(`[Main] Plugin registered as tool: ${plugin.name}`);
  });

  pluginsManager.on('pluginUnloaded', ({ name, file }) => {
    // Remove from tool registry
    toolRegistry.schemas = toolRegistry.schemas.filter(s => s.name !== name);
    delete toolRegistry.tools[name];

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('plugin-unloaded', { name, file });
    }
    console.log(`[Main] Plugin unregistered: ${name}`);
  });

  pluginsManager.on('pluginError', (errInfo) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('plugin-error', errInfo);
    }
    console.error(`[Main] Plugin error (${errInfo.file}):`, errInfo.error);
  });

  // Load plugins after main startup (non-blocking)
  pluginsManager.loadPlugins().then(() => {
    console.log(`[Main] Plugins loaded: ${pluginsManager.getLoadedPlugins().length} custom tool(s)`);
  }).catch(err => {
    console.error('[Main] Plugin load error:', err.message);
  });
});

app.on('window-all-closed', async () => {
  if (isQuitting) {
    if (tray) {
      try { tray.destroy(); } catch (_) {}
    }
    pluginsManager.stop();
    triggersManager.stop();
    await browserTools.closeBrowser();
    await tunnelManager.stop();
    await serverManager.stop();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  }
});

// Custom Window Controls IPC
ipcMain.on('window-min', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-max', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window-close-request', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('show-close-dialog');
  }
});

ipcMain.on('window-minimize-to-tray', () => {
  if (mainWindow) {
    mainWindow.hide();
    if (Notification.isSupported()) {
      const iconPath = path.join(__dirname, '../../assets/icon.png');
      new Notification({
        title: 'OmniDev Studio Running in Background',
        body: 'MCP server & tunnel remain online. Click tray icon to reopen.',
        icon: fs.existsSync(iconPath) ? iconPath : undefined
      }).show();
    }
  }
});

ipcMain.on('app-exit', async () => {
  isQuitting = true;
  if (tray) {
    try { tray.destroy(); } catch (_) {}
  }
  pluginsManager.stop();
  triggersManager.stop();
  await browserTools.closeBrowser();
  await tunnelManager.stop();
  await serverManager.stop();
  app.quit();
});

// IPC Handlers
ipcMain.handle('get-app-state', () => {
  return {
    projects: projectsManager.list(),
    activeProject: projectsManager.getActive(),
    workspace: workspaceManager.getInfo(),
    settings: settingsManager.get(),
    mcpUrl: serverManager.getMcpUrl(),
    tunnel: tunnelManager.getInfo(),
    pendingApprovals: permissionsManager.getPending(),
    jobs: jobsManager.listJobs(),
    toolsCount: toolRegistry.getSchemas().length
  };
});

ipcMain.handle('regenerate-mcp-token', () => {
  settingsManager.regenerateMcpToken();
  return {
    token: settingsManager.get().mcpSecretToken,
    mcpUrl: serverManager.getMcpUrl()
  };
});

ipcMain.handle('list-projects', () => {
  return projectsManager.list();
});

ipcMain.handle('create-project', (event, projectData) => {
  const newProj = projectsManager.create(projectData);
  workspaceManager.setWorkspace(newProj.path);
  return {
    project: newProj,
    workspace: workspaceManager.getInfo(),
    mcpUrl: serverManager.getMcpUrl()
  };
});

ipcMain.handle('update-project', (event, { id, updates }) => {
  const updated = projectsManager.update(id, updates);
  if (projectsManager.activeProjectId === id) {
    workspaceManager.setWorkspace(updated.path);
  }
  return updated;
});

ipcMain.handle('delete-project', (event, id) => {
  const success = projectsManager.delete(id);
  const activeProj = projectsManager.getActive();
  if (activeProj) {
    workspaceManager.setWorkspace(activeProj.path);
  }
  return { success, activeProject: activeProj };
});

ipcMain.handle('set-active-project', (event, id) => {
  const active = projectsManager.setActive(id);
  workspaceManager.setWorkspace(active?.path || process.cwd());
  return {
    activeProject: active,
    workspace: workspaceManager.getInfo(),
    mcpUrl: serverManager.getMcpUrl()
  };
});

ipcMain.handle('select-directory-dialog', async (event, title = 'Select Folder') => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title,
    properties: ['openDirectory', 'createDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('update-settings', async (event, updates) => {
  const previous = settingsManager.get();
  const allowed = {};
  if (['local', 'ngrok'].includes(updates.tunnelType)) allowed.tunnelType = updates.tunnelType;
  if (['smart', 'manual', 'auto'].includes(updates.permissionMode)) allowed.permissionMode = updates.permissionMode;
  for (const key of ['ngrokAuthToken', 'ngrokStaticDomain']) {
    if (typeof updates[key] === 'string') allowed[key] = updates[key].trim();
  }
  for (const key of ['soundEnabled', 'allowEscape']) {
    if (typeof updates[key] === 'boolean') allowed[key] = updates[key];
  }
  if (['dark', 'light', 'midnight', 'ocean'].includes(updates.theme)) allowed.theme = updates.theme;
  if (updates.toolPolicies && typeof updates.toolPolicies === 'object') allowed.toolPolicies = updates.toolPolicies;
  const updated = settingsManager.update(allowed);
  if (previous.permissionMode !== updated.permissionMode) permissionsManager.clearSessionApprovals();
  permissionsManager.setMode(updated.permissionMode);
  permissionsManager.setToolPolicies(updated.toolPolicies || {});
  workspaceManager.setAllowEscape(updated.allowEscape);
  if (['tunnelType', 'ngrokAuthToken', 'ngrokStaticDomain'].some(key => previous[key] !== updated[key])) await refreshTunnel();
  return {
    settings: updated,
    mcpUrl: serverManager.getMcpUrl(),
    tunnel: tunnelManager.getInfo()
  };
});

ipcMain.handle('reconnect-tunnel', async () => {
  await refreshTunnel();
  return {
    tunnel: tunnelManager.getInfo(),
    mcpUrl: serverManager.getMcpUrl()
  };
});

ipcMain.handle('configure-local-mcp-client', async (event, client) => {
  await requireInstalledClient(client);
  if (!serverManager.server?.listening) throw new Error('The local MCP server is not listening.');
  const result = configureClient(client, serverManager.getLocalMcpUrl());
  if (settingsManager.get().tunnelType !== 'local') {
    settingsManager.update({ tunnelType: 'local' });
    await refreshTunnel();
  }
  return { ...result, settings: settingsManager.get(), tunnel: tunnelManager.getInfo(), mcpUrl: serverManager.getMcpUrl() };
});

ipcMain.handle('clear-session-approvals', () => permissionsManager.clearSessionApprovals());

ipcMain.handle('open-client-skills-dir', async (event, client) => {
  const directory = getSkillsDirectory(client);
  await fs.promises.mkdir(directory, { recursive: true });
  const error = await require('electron').shell.openPath(directory);
  if (error) throw new Error(error);
});

ipcMain.handle('approve-action', (event, { id, approveAllForSession }) => {
  return permissionsManager.approve(id, approveAllForSession);
});

ipcMain.handle('deny-action', (event, { id, reason }) => {
  return permissionsManager.deny(id, reason);
});

ipcMain.handle('cancel-job', (event, jobId) => {
  return jobsManager.cancelJob(jobId);
});

// Plugin IPC handlers
ipcMain.handle('get-plugins', () => {
  return pluginsManager.getLoadedPlugins();
});

ipcMain.handle('reload-plugins', async () => {
  const plugins = await pluginsManager.reloadAll();
  return { plugins, toolsCount: toolRegistry.getSchemas().length };
});

ipcMain.handle('open-plugins-dir', () => {
  const { shell } = require('electron');
  const pluginsPath = require('path').join(process.cwd(), 'plugins');
  if (!require('fs').existsSync(pluginsPath)) {
    require('fs').mkdirSync(pluginsPath, { recursive: true });
  }
  shell.openPath(pluginsPath);
  return { path: pluginsPath };
});

ipcMain.handle('toggle-plugin', (event, { name, enabled }) => {
  return pluginsManager.setEnabled(name, enabled);
});

ipcMain.handle('set-plugin-config', (event, { name, config }) => {
  return pluginsManager.setConfig(name, config);
});

ipcMain.handle('scaffold-plugin', (event, opts) => {
  const file = pluginsManager.scaffold(opts || {});
  try { require('electron').shell.openPath(file); } catch (_) {}
  return { file };
});

// Tools catalog (for the Tools pane) — every registered tool + its policy
ipcMain.handle('get-tools-catalog', () => {
  const policies = permissionsManager.getToolPolicies();
  const pluginCat = {};
  for (const p of pluginsManager.getLoadedPlugins()) pluginCat[p.name] = p.category || 'Skills';
  return toolRegistry.getSchemas().map(s => {
    const isPlugin = Object.prototype.hasOwnProperty.call(pluginCat, s.name);
    return {
      name: s.name,
      description: s.description,
      isCritical: Boolean(toolRegistry.tools[s.name]?.isCritical),
      isPlugin,
      category: isPlugin ? `Skill · ${pluginCat[s.name]}` : toolRegistry.getCategory(s.name),
      policy: policies[s.name] || 'default'
    };
  });
});

ipcMain.handle('get-tool-policies', () => permissionsManager.getToolPolicies());

ipcMain.handle('set-tool-policies', (event, policies) => {
  settingsManager.update({ toolPolicies: policies || {} });
  permissionsManager.setToolPolicies(policies || {});
  return permissionsManager.getToolPolicies();
});

// Audit log
ipcMain.handle('get-audit-log', (event, limit = 200) => audit.recent(limit));
ipcMain.handle('clear-audit-log', () => audit.clear());

// File backups / rollback
ipcMain.handle('list-backups', (event, limit = 100) => backups.list(limit));
ipcMain.handle('restore-backup', (event, id) => {
  const res = backups.restore(id);
  workspaceManager.notifyChanged();
  return res;
});

// Checkpoints (workspace-wide restore points)
ipcMain.handle('checkpoints-list', () => checkpoints.list());
ipcMain.handle('checkpoints-create', (event, label) => checkpoints.create(label || ''));
ipcMain.handle('checkpoints-restore', (event, id) => checkpoints.restore(id));
ipcMain.handle('checkpoints-delete', (event, id) => checkpoints.remove(id));

// Project discovery (Live Preview servers, Database Browser sources)
ipcMain.handle('preview-detect', () => discovery.detectPreview());
ipcMain.handle('db-discover', () => discovery.discoverDatabases());

// Secrets vault (UI never reads values — only names)
ipcMain.handle('vault-list', () => vault.listKeys());
ipcMain.handle('vault-set', (event, { key, value }) => vault.set(key, value));
ipcMain.handle('vault-delete', (event, key) => vault.remove(key));

// Automation triggers
ipcMain.handle('triggers-list', () => triggersManager.list());
ipcMain.handle('triggers-add', (event, def) => triggersManager.add(def || {}));
ipcMain.handle('triggers-remove', (event, id) => triggersManager.remove(id));
ipcMain.handle('triggers-toggle', (event, { id, enabled }) => triggersManager.toggle(id, enabled));

// DB browser
ipcMain.handle('db-inspect', async (event, payload = {}) => {
  if (payload.engine === 'mysql') {
    if (payload.table) return mysqlTools.mysql_schema(payload);
    if (payload.database) return mysqlTools.mysql_schema(payload);
    return mysqlTools.mysql_databases(payload);
  }
  return dbTools.sqlite_schema({ database_file: payload.database_file });
});
ipcMain.handle('db-query', async (event, payload = {}) => {
  if (payload.engine === 'mysql') return mysqlTools.mysql_query(payload);
  return dbTools.sqlite_query({ database_file: payload.database_file, sql: payload.sql });
});
