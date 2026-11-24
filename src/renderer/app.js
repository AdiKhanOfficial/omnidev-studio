const { ipcRenderer, shell } = require('electron');

let state = {
  projects: [],
  activeProject: null,
  settings: null,
  mcpUrl: '',
  tunnel: { status: 'disconnected', url: null },
  pendingApprovals: [],
  jobs: [],
  activities: [],
  selectedJobId: null,
  currentlyInspecting: null, // { type: 'tool'|'job', id: string, rec: object }
  currentFile: null,
  fileTree: []
};

let cmEditor = null;
let treeRequest;
let explorerProject;
let configuringClient = false;
const outputLimit = 200_000;
let pendingTerminal = '';
let terminalFrame = 0;
let terminalBuffer = ''; // mirror of terminal text; avoids reading back huge textContent
let fileTreeReloadTimer = null;

// ========================================================
// DOM References
// ========================================================
// Header
const btnBrandHome = document.getElementById('btn-brand-home');
const btnProjectDropdown = document.getElementById('btn-project-dropdown');
const hdrProjectName = document.getElementById('hdr-project-name');
const projectDropdownMenu = document.getElementById('project-dropdown-menu');
const projectDropdownItems = document.getElementById('project-dropdown-items');
const btnHdrNewProj = document.getElementById('btn-hdr-new-proj');
const hdrMcpUrlDisplay = document.getElementById('hdr-mcp-url-display');
const btnHdrCopyMcp = document.getElementById('btn-hdr-copy-mcp');
const btnHdrConnectGuide = document.getElementById('btn-hdr-connect-guide');
const btnHdrSound = document.getElementById('btn-hdr-sound');
const hdrSoundLabel = document.getElementById('hdr-sound-label');
const btnHdrSettings = document.getElementById('btn-hdr-settings');

// Approvals Strip
const approvalStrip = document.getElementById('approval-strip');
const approvalToolTag = document.getElementById('approval-tool-tag');
const approvalParamsJson = document.getElementById('approval-params-json');
const btnApproveAction = document.getElementById('btn-approve-action');
const btnApproveSession = document.getElementById('btn-approve-session');
const btnDenyAction = document.getElementById('btn-deny-action');

// Activity Rail & Sidebar
const btnRailSettings = document.getElementById('btn-rail-settings');
const sidebarPanel = document.getElementById('sidebar-panel');
const explorerFileTree = document.getElementById('explorer-file-tree');
const btnRefreshTree = document.getElementById('btn-refresh-tree');
const btnNewWorkspaceSide = document.getElementById('btn-new-workspace-side');
const sbRootFolderName = document.getElementById('sb-root-folder-name');
const sbRootType = document.getElementById('sb-root-type');
const sbNotesText = document.getElementById('sb-notes-text');
const btnTriggerEditNotes = document.getElementById('btn-trigger-edit-notes');

// Activity & Jobs Sidebar
const jobsActiveBadge = document.getElementById('jobs-active-badge');
const jobsMiniList = document.getElementById('jobs-mini-list');
const activityFeedScroll = document.getElementById('activity-feed-scroll');
const btnClearActivityFeed = document.getElementById('btn-clear-activity-feed');

// Main Editor Viewport & Tabs
const editorTabsRail = document.getElementById('editor-tabs-rail');
const screenBlank = document.getElementById('screen-blank');
const screenWelcome = document.getElementById('screen-welcome');
const screenCodeEditor = document.getElementById('screen-code-editor');
const screenActivityInspector = document.getElementById('screen-activity-inspector');
const blankWorkspaceTitle = document.getElementById('blank-workspace-title');
const blankWorkspacePath = document.getElementById('blank-workspace-path');
const codeFileName = document.getElementById('code-file-name');
const btnSaveCodeFile = document.getElementById('btn-save-code-file');
const recentWorkspacesScroll = document.getElementById('recent-workspaces-scroll');

// Activity & Process Inspector Elements
const inspStatusBadge = document.getElementById('insp-status-badge');
const inspToolTitle = document.getElementById('insp-tool-title');
const inspDuration = document.getElementById('insp-duration');
const inspTime = document.getElementById('insp-time');
const btnInspKillJob = document.getElementById('btn-insp-kill-job');
const btnInspCopyOutput = document.getElementById('btn-insp-copy-output');
const btnCopyInspParams = document.getElementById('btn-copy-insp-params');
const inspParamsBox = document.getElementById('insp-params-box');
const inspOutputBox = document.getElementById('insp-output-box');

// Resizers
const sidebarResizer = document.getElementById('sidebar-resizer');
const panelResizer = document.getElementById('panel-resizer');
const activitySectionResizer = document.getElementById('activity-section-resizer');

// Bottom Panel
const bottomPanel = document.getElementById('bottom-panel');
const terminalStreamBox = document.getElementById('terminal-stream-box');
const execTableBody = document.getElementById('exec-table-body');
const panelShellStatus = document.getElementById('panel-shell-status');
const btnKillProc = document.getElementById('btn-kill-proc');
const btnClearTerm = document.getElementById('btn-clear-term');
const btnTogglePanel = document.getElementById('btn-toggle-panel');

// Statusbar
const sbGitBranchInfo = document.getElementById('sb-git-branch-info');
const sbBranchLabel = document.getElementById('sb-branch-label');
const sbActiveWsPath = document.getElementById('sb-active-ws-path');
const sbNgrokDomainText = document.getElementById('sb-ngrok-domain-text');
const sbEditorCursorPos = document.getElementById('sb-editor-cursor-pos');
const sbEditorModeLabel = document.getElementById('sb-editor-mode-label');

// Modals
const modalNewProject = document.getElementById('modal-new-project');
const btnCloseNewProj = document.getElementById('btn-close-new-proj');
const btnCancelNewProj = document.getElementById('btn-cancel-new-proj');
const btnCreateNewProj = document.getElementById('btn-create-new-proj');
const btnWizBrowse = document.getElementById('btn-wiz-browse');
const wizName = document.getElementById('wiz-name');
const wizPath = document.getElementById('wiz-path');
const wizType = document.getElementById('wiz-type');
const wizNotes = document.getElementById('wiz-notes');

const modalEditNotes = document.getElementById('modal-edit-notes');
const btnCloseEditNotes = document.getElementById('btn-close-edit-notes');
const btnCancelEditNotes = document.getElementById('btn-cancel-edit-notes');
const btnSaveEditNotes = document.getElementById('btn-save-edit-notes');
const editNotesInput = document.getElementById('edit-notes-input');

const modalSettings = document.getElementById('modal-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnCancelSettings = document.getElementById('btn-cancel-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const setNgrokToken = document.getElementById('set-ngrok-token');
const setNgrokDomain = document.getElementById('set-ngrok-domain');
const setMcpToken = document.getElementById('set-mcp-token');
const btnRegenTokenSettings = document.getElementById('btn-regen-token-settings');
const setPermMode = document.getElementById('set-perm-mode');
const setChkSound = document.getElementById('set-chk-sound');
const setChkSandbox = document.getElementById('set-chk-sandbox');
const btnTestChime = document.getElementById('btn-test-chime');

const setTunnelType = document.getElementById('set-tunnel-type');
const settingsMcpUrl = document.getElementById('settings-mcp-url');

// Custom Window Controls & Close Confirmation Modal
const btnWinMin = document.getElementById('btn-win-min');
const btnWinMax = document.getElementById('btn-win-max');
const btnWinClose = document.getElementById('btn-win-close');
const modalCloseConfirm = document.getElementById('modal-close-confirm');
const btnCloseConfirmX = document.getElementById('btn-close-confirm-x');
const btnCloseCancel = document.getElementById('btn-close-cancel');
const btnCloseExit = document.getElementById('btn-close-exit');
const btnCloseTray = document.getElementById('btn-close-tray');

// ========================================================
// 1. Initialize CodeMirror Editor
// ========================================================
function initCodeMirror() {
  const wrapper = document.getElementById('codemirror-wrapper');
  if (!wrapper || cmEditor) return;

  cmEditor = CodeMirror(wrapper, {
    value: '// Select a file from the explorer on the left to start editing',
    mode: 'javascript',
    theme: 'material-darker',
    lineNumbers: true,
    matchBrackets: true,
    styleActiveLine: true,
    indentUnit: 4,
    tabSize: 4,
    lineWrapping: false
  });

  cmEditor.on('cursorActivity', () => {
    const pos = cmEditor.getCursor();
    sbEditorCursorPos.textContent = `Ln ${pos.line + 1}, Col ${pos.ch + 1}`;
  });

}

// ========================================================
// 2. Initial Application Data Loading
// ========================================================
async function init() {
  applyTheme(localStorage.getItem('omnidev-theme'));
  initResizers();

  const data = await ipcRenderer.invoke('get-app-state');
  state.projects = data.projects || [];
  state.activeProject = data.activeProject || null;
  state.settings = data.settings || {};
  state.mcpUrl = data.mcpUrl || '';
  state.tunnel = data.tunnel || {};
  state.pendingApprovals = data.pendingApprovals || [];
  state.jobs = data.jobs || [];

  updateProjectUI();
  updateTunnelUI();
  updateSoundUI();
  updateApprovalsUI();
  renderRecentWorkspaces();
  renderJobsList();
  loadFileTree();
  setupEventListeners();

  // If a project is already active, show the clean Blank Screen as requested
  if (state.activeProject) {
    showBlankScreen();
  } else {
    showScreen('screen-welcome');
  }
}

// ========================================================
// 3. Viewport Screen Switching (Blank / Welcome / Editor / Inspector)
// ========================================================
function showScreen(screenId) {
  document.querySelectorAll('.viewport-screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) {
    target.classList.add('active');
  }

  if (screenId === 'screen-code-editor') {
    sbEditorCursorPos.style.display = 'inline-block';
    if (cmEditor) setTimeout(() => cmEditor.refresh(), 30);
  } else {
    sbEditorCursorPos.style.display = 'none';
  }
}

function showBlankScreen() {
  if (state.activeProject) {
    blankWorkspaceTitle.textContent = state.activeProject.name;
    blankWorkspacePath.textContent = state.activeProject.path;
  }
  showScreen('screen-blank');
}

// ========================================================
// 4. Project UI & Workspace Management
// ========================================================
function updateProjectUI() {
  const project = state.activeProject;
  for (const id of ['explorer-workspace', 'explorer-notes', 'btn-close-workspace']) {
    document.getElementById(id).hidden = !project;
  }
  document.getElementById('explorer-empty').hidden = Boolean(project);
  btnRefreshTree.disabled = !project;
  if (explorerProject !== project?.id) {
    explorerProject = project?.id;
    state.currentFile = null;
    state.currentlyInspecting = null;
    editorTabsRail.replaceChildren();
    explorerFileTree.replaceChildren();
  }
  hdrProjectName.textContent = project?.name || 'No workspace';
  sbActiveWsPath.textContent = project?.path || 'No workspace';
  renderProjectDropdown();
  if (phase2ProjectKey !== wsKey()) { phase2ProjectKey = wsKey(); resetProjectTools(); }
  if (!project) return;

  hdrProjectName.textContent = state.activeProject.name;
  sbRootFolderName.textContent = state.activeProject.name.toUpperCase();
  sbRootType.textContent = state.activeProject.type || 'Workspace';
  sbActiveWsPath.textContent = state.activeProject.path;

  const notes = state.activeProject.notes || 'No environment notes configured yet. Click ✏️ to add localhost URL, XAMPP port, MySQL credentials.';
  sbNotesText.textContent = notes;

  blankWorkspaceTitle.textContent = state.activeProject.name;
  blankWorkspacePath.textContent = state.activeProject.path;

}

function updateTunnelUI() {
  const local = state.settings.tunnelType === 'local';
  hdrMcpUrlDisplay.textContent = local ? 'Local' : (state.tunnel?.url || 'ngrok offline');
  document.documentElement.dataset.tunnelStatus = state.tunnel?.status || 'disconnected';
  btnHdrCopyMcp.disabled = !state.mcpUrl;
  setMcpToken.value = state.settings?.mcpSecretToken || '';
  sbNgrokDomainText.textContent = local ? 'Local' : (state.tunnel?.status || 'Disconnected');
  document.getElementById('server-output-box').textContent =
    `Local MCP port: ${state.settings?.serverPort || 3721}\nTunnel: ${state.tunnel?.status || 'disconnected'}`
    + (state.tunnel?.error ? `\n${state.tunnel.error}` : '');
  renderTunnelSettings();
}

function updateSoundUI() {
  const enabled = state.settings.soundEnabled !== false;
  if (window.soundEffects) window.soundEffects.enabled = enabled;
  hdrSoundLabel.textContent = `Sound: ${enabled ? 'ON' : 'OFF'}`;
}

function renderTunnelSettings() {
  const local = setTunnelType.value === 'local';
  const saved = setTunnelType.value === state.settings.tunnelType;
  document.getElementById('settings-ngrok-fields').hidden = local;
  document.getElementById('settings-local-clients').hidden = !local;
  document.getElementById('settings-remote-guides').hidden = local;
  const localUrl = state.settings.mcpSecretToken
    ? `http://127.0.0.1:${state.settings.serverPort || 3721}/mcp/${encodeURIComponent(state.settings.mcpSecretToken)}` : '';
  settingsMcpUrl.value = local ? localUrl : (saved ? state.mcpUrl : '');
  settingsMcpUrl.placeholder = local ? 'Local endpoint unavailable' : 'Available once ngrok connects';
  document.getElementById('btn-copy-settings-url').disabled = !saved || !state.mcpUrl;
  document.getElementById('btn-reconnect-tunnel').disabled = !saved;
  document.querySelectorAll('[data-mcp-client]').forEach(button => { button.disabled = !local || configuringClient; });
  document.getElementById('settings-tunnel-status').textContent = !saved
    ? (local ? 'Choose an installed client to switch to Local and configure it in one step.' : 'Save settings to switch to ngrok.')
    : local ? 'Loopback endpoint for clients on this computer.'
    : state.tunnel?.error || (state.mcpUrl ? 'Public tunnel connected.' : 'Waiting for a public tunnel.');
}

function workspaceFetch(route, options = {}) {
  const port = state.settings.serverPort || 3721;
  return fetch(`http://127.0.0.1:${port}/api/fs/${route}`, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${state.settings.mcpSecretToken}` }
  });
}

function applyTheme(theme) {
  const selected = theme === 'graphite' ? 'graphite' : 'midnight';
  document.documentElement.dataset.theme = selected;
  const button = document.getElementById('btn-theme');
  button.textContent = selected === 'graphite' ? 'Graphite' : 'Midnight';
  button.setAttribute('aria-label', `Theme: ${button.textContent}. Switch theme`);
}

function selectPanel(id) {
  bottomPanel.classList.remove('collapsed');
  btnTogglePanel.setAttribute('aria-expanded', 'true');
  document.querySelectorAll('.p-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.panel === id));
  document.querySelectorAll('.panel-screen').forEach(panel => panel.classList.toggle('active', panel.id === id));
  if (cmEditor) requestAnimationFrame(() => cmEditor.refresh());
}

function appendTerminal(text) {
  pendingTerminal = (pendingTerminal + text).slice(-outputLimit);
  if (terminalFrame) return;
  terminalFrame = requestAnimationFrame(() => {
    terminalFrame = 0;
    const panel = terminalStreamBox.parentElement;
    const follow = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 24;
    terminalBuffer = (terminalBuffer + pendingTerminal).slice(-outputLimit);
    terminalStreamBox.textContent = terminalBuffer;
    pendingTerminal = '';
    if (follow) panel.scrollTop = panel.scrollHeight;
    if (state.currentlyInspecting?.type === 'job') {
      const job = state.jobs.find(item => item.id === state.currentlyInspecting.id);
      if (job?.output !== undefined) {
        inspOutputBox.textContent = job.output;
        inspOutputBox.scrollTop = inspOutputBox.scrollHeight;
      }
    }
  });
}

function renderProjectDropdown() {
  projectDropdownItems.innerHTML = '';
  state.projects.forEach(p => {
    const item = document.createElement('div');
    item.className = `dropdown-item ${p.id === state.activeProject?.id ? 'active' : ''}`;
    item.innerHTML = `
      <span>${escapeHtml(p.name)}</span>
      <span class="badge-tag">${escapeHtml(p.type || 'General')}</span>
    `;
    item.onclick = async () => {
      projectDropdownMenu.style.display = 'none';
      const res = await ipcRenderer.invoke('set-active-project', p.id);
      state.activeProject = res.activeProject;
      state.mcpUrl = res.mcpUrl;
      updateProjectUI();
      loadFileTree();
      renderRecentWorkspaces();
      showBlankScreen();
      showToast(`Switched workspace: ${p.name}`);
    };
    projectDropdownItems.appendChild(item);
  });
}

function renderRecentWorkspaces() {
  recentWorkspacesScroll.innerHTML = '';
  state.projects.forEach(p => {
    const card = document.createElement('div');
    card.className = 'recent-card';
    card.innerHTML = `
      <strong>${escapeHtml(p.name)}</strong>
      <span>${escapeHtml(p.path)}</span>
    `;
    card.onclick = async () => {
      const res = await ipcRenderer.invoke('set-active-project', p.id);
      state.activeProject = res.activeProject;
      state.mcpUrl = res.mcpUrl;
      updateProjectUI();
      loadFileTree();
      showBlankScreen();
      showToast(`Opened workspace: ${p.name}`);
    };
    recentWorkspacesScroll.appendChild(card);
  });
}

// ========================================================
// 5. File Explorer Tree & CodeMirror Integration
// ========================================================
async function loadFileTree() {
  treeRequest?.abort();
  if (!state.activeProject) {
    state.fileTree = [];
    explorerFileTree.replaceChildren();
    return;
  }
  const request = new AbortController();
  treeRequest = request;
  try {
    const res = await workspaceFetch('tree', { signal: request.signal });
    const data = await res.json();
    if (request.signal.aborted) return;
    if (!res.ok) throw new Error(data.error || res.statusText);
    state.fileTree = data.tree || [];
    renderTree(state.fileTree, explorerFileTree);
  } catch (e) {
    if (!request.signal.aborted) explorerFileTree.textContent = `Could not load files: ${e.message}`;
  }
}

function renderTree(nodes, container, depth = 0) {
  container.innerHTML = '';
  if (!nodes || nodes.length === 0) {
    container.innerHTML = '<div class="empty-placeholder">Empty folder</div>';
    return;
  }

  nodes.forEach(node => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'tree-row';
    row.style.paddingLeft = `${depth * 14 + 10}px`;

    const chevron = node.isDirectory ? document.querySelector('#acc-hdr-root svg').outerHTML : '<span class="tree-chev"></span>';
    const icon = getFileIcon(node);

    row.innerHTML = `
      ${chevron}
      <span class="tree-sym">${icon}</span>
      <span class="tree-name">${escapeHtml(node.name)}</span>
    `;

    if (node.isDirectory) {
      const childContainer = document.createElement('div');
      childContainer.hidden = true;
      row.setAttribute('aria-expanded', 'false');
      let rendered = false;

      row.onclick = (e) => {
        e.stopPropagation();
        const isOpen = !childContainer.hidden;
        if (!isOpen && !rendered) {
          if (node.children?.length) renderTree(node.children, childContainer, depth + 1);
          rendered = true;
        }
        childContainer.hidden = isOpen;
        row.setAttribute('aria-expanded', String(!isOpen));
      };

      container.appendChild(row);
      container.appendChild(childContainer);
    } else {
      row.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.tree-row').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        openFile(node.path, node.name);
      };
      container.appendChild(row);
    }
  });
}

function getFileIcon(node) {
  if (node.isDirectory) return '📁';
  const ext = node.name.split('.').pop().toLowerCase();
  switch (ext) {
    case 'php': return '<span style="color:#c586c0; font-weight:700;">PHP</span>';
    case 'js':
    case 'mjs': return '<span style="color:#dcdcaa; font-weight:700;">JS</span>';
    case 'ts': return '<span style="color:#007acc; font-weight:700;">TS</span>';
    case 'json': return '<span style="color:#ce9178; font-weight:700;">{}</span>';
    case 'html': return '<span style="color:#e44d26; font-weight:700;">&lt;&gt;</span>';
    case 'css': return '<span style="color:#264de4; font-weight:700;">#</span>';
    case 'py': return '<span style="color:#4ec9b0; font-weight:700;">PY</span>';
    case 'sql': return '<span style="color:#4ec9b0; font-weight:700;">SQL</span>';
    case 'md': return '<span style="color:#007acc; font-weight:700;">MD</span>';
    default: return '📄';
  }
}

async function openFile(relPath, fileName) {
  const project = state.activeProject;
  if (!project) return;
  try {
    const res = await workspaceFetch(`file?path=${encodeURIComponent(relPath)}`);
    const data = await res.json();
    if (state.activeProject?.id !== project.id) return;
    if (data.error) throw new Error(data.error);

    state.currentFile = relPath;
    codeFileName.textContent = `${relPath} (${data.size} bytes)`;

    // Detect mode for CodeMirror
    initCodeMirror();
    const mode = getEditorMode(fileName);
    cmEditor.setOption('mode', mode.mode);
    sbEditorModeLabel.textContent = mode.label;

    cmEditor.setValue(data.content || '');
    cmEditor.clearHistory();
    cmEditor.markClean();

    // Switch view to code editor
    showScreen('screen-code-editor');

    // Manage Editor Tabs
    renderEditorTab(relPath, fileName);
  } catch (err) {
    showToast(`Error opening file: ${err.message}`);
  }
}

function getEditorMode(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  switch (ext) {
    case 'php': return { mode: 'application/x-httpd-php', label: 'PHP' };
    case 'js':
    case 'mjs': return { mode: 'javascript', label: 'JavaScript' };
    case 'json': return { mode: { name: 'javascript', json: true }, label: 'JSON' };
    case 'html': return { mode: 'htmlmixed', label: 'HTML' };
    case 'css': return { mode: 'css', label: 'CSS' };
    case 'py': return { mode: 'python', label: 'Python' };
    case 'sql': return { mode: 'sql', label: 'SQL' };
    case 'md': return { mode: 'markdown', label: 'Markdown' };
    default: return { mode: 'text/plain', label: 'Plain Text' };
  }
}

function renderEditorTab(filePath, fileName) {
  let tab = document.querySelector(`.tab-item[data-tab="${filePath}"]`);
  if (!tab) {
    tab = document.createElement('div');
    tab.className = 'tab-item active';
    tab.dataset.tab = filePath;
    tab.innerHTML = `
      <span>${escapeHtml(fileName)}</span>
      <span class="tab-close-x">&times;</span>
    `;
    tab.onclick = () => {
      document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      showScreen('screen-code-editor');
      setTimeout(() => cmEditor.refresh(), 30);
    };
    tab.querySelector('.tab-close-x').onclick = (e) => {
      e.stopPropagation();
      tab.remove();
      const remainingTabs = document.querySelectorAll('.tab-item[data-tab]');
      if (remainingTabs.length > 0) {
        remainingTabs[remainingTabs.length - 1].click();
      } else {
        showBlankScreen();
        sbEditorModeLabel.textContent = 'Plain Text';
      }
    };
    editorTabsRail.appendChild(tab);
  }

  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
}

async function saveCurrentFile() {
  if (!state.activeProject || !state.currentFile || !cmEditor) return;
  try {
    const res = await workspaceFetch('save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: state.currentFile,
        content: cmEditor.getValue()
      })
    });
    const data = await res.json();
    if (data.success) {
      cmEditor.markClean();
      showToast(`Saved: ${state.currentFile}`);
    } else {
      showToast(`Save failed: ${data.error}`);
    }
  } catch (e) {
    showToast(`Save error: ${e.message}`);
  }
}

// ========================================================
// 6. Live AI Activity & Process Inspector (User Req #3 & #4)
// ========================================================
function openActivityInspector(rec) {
  state.currentlyInspecting = { type: 'tool', id: rec.id || rec.tool, rec };

  // Status Badge
  inspStatusBadge.textContent = rec.success ? 'SUCCESS' : 'FAILED';
  inspStatusBadge.className = `status-badge ${rec.success ? '' : 'failed'}`;

  // Tool Title, Duration, Time
  inspToolTitle.textContent = rec.tool || 'tool_call';
  inspDuration.textContent = `${rec.duration_ms || 0}ms`;
  inspTime.textContent = rec.timestamp ? new Date(rec.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();

  // Hide kill process button for normal tool executions
  btnInspKillJob.style.display = 'none';

  // Format Input Parameters
  try {
    inspParamsBox.textContent = JSON.stringify(rec.params || {}, null, 2);
  } catch (_) {
    inspParamsBox.textContent = String(rec.params || '{}');
  }

  // Format Execution Result / Output
  if (rec.result !== undefined && rec.result !== null) {
    if (typeof rec.result === 'object') {
      inspOutputBox.textContent = JSON.stringify(rec.result, null, 2);
    } else {
      inspOutputBox.textContent = String(rec.result);
    }
  } else if (rec.error) {
    inspOutputBox.textContent = `Error: ${rec.error}`;
  } else {
    inspOutputBox.textContent = '(Completed with no return data)';
  }

  // Switch to inspector screen
  showScreen('screen-activity-inspector');

  // Add Inspector Tab
  renderInspectorTab(`tool-${rec.tool}`, `⚡ ${rec.tool}`);
}

function openJobInspector(job) {
  state.currentlyInspecting = { type: 'job', id: job.id, rec: job };
  state.selectedJobId = job.id;

  // Status Badge
  const isRunning = job.status === 'running';
  inspStatusBadge.textContent = (job.status || 'running').toUpperCase();
  inspStatusBadge.className = `status-badge ${isRunning ? '' : job.status === 'completed' ? '' : 'failed'}`;
  if (isRunning) {
    inspStatusBadge.style.backgroundColor = 'rgba(234, 179, 8, 0.2)';
    inspStatusBadge.style.color = '#fde047';
  } else {
    inspStatusBadge.style.backgroundColor = '';
    inspStatusBadge.style.color = '';
  }

  // Tool Title & Duration
  inspToolTitle.textContent = `Process: ${job.id}`;
  const elapsed = Math.round((Date.now() - (job.startTime || Date.now())) / 1000);
  inspDuration.textContent = isRunning ? `${elapsed}s elapsed` : 'Finished';
  inspTime.textContent = new Date(job.startTime || Date.now()).toLocaleTimeString();

  // Show kill button if running
  btnInspKillJob.style.display = isRunning ? 'inline-block' : 'none';
  btnInspKillJob.onclick = async () => {
    await ipcRenderer.invoke('cancel-job', job.id);
    job.status = 'killed';
    btnInspKillJob.style.display = 'none';
    inspStatusBadge.textContent = 'KILLED';
    inspStatusBadge.className = 'status-badge failed';
    renderJobsList();
    showToast(`Terminated process ${job.id}`);
  };

  // Input Parameters: command and working directory
  inspParamsBox.textContent = JSON.stringify({
    job_id: job.id,
    command: job.command,
    cwd: job.cwd || state.activeProject?.path || ''
  }, null, 2);

  // Output Logs
  inspOutputBox.textContent = job.output || (isRunning ? 'Process is running. Waiting for stream output...' : '(No output returned)');

  // Switch to inspector screen
  showScreen('screen-activity-inspector');

  // Add Inspector Tab
  renderInspectorTab(`job-${job.id}`, `▶ ${job.id}`);
}

function renderInspectorTab(tabId, tabTitle) {
  let tab = document.querySelector(`.tab-item[data-tab="${tabId}"]`);
  if (!tab) {
    tab = document.createElement('div');
    tab.className = 'tab-item active';
    tab.dataset.tab = tabId;
    tab.innerHTML = `
      <span>${escapeHtml(tabTitle)}</span>
      <span class="tab-close-x">&times;</span>
    `;
    tab.onclick = () => {
      document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      showScreen('screen-activity-inspector');
    };
    tab.querySelector('.tab-close-x').onclick = (e) => {
      e.stopPropagation();
      tab.remove();
      const remainingTabs = document.querySelectorAll('.tab-item[data-tab]');
      if (remainingTabs.length > 0) {
        remainingTabs[remainingTabs.length - 1].click();
      } else {
        showBlankScreen();
      }
    };
    editorTabsRail.appendChild(tab);
  }

  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
}

// ========================================================
// 7. Background Tasks / Jobs List Rendering
// ========================================================
function renderJobsList() {
  const activeJobs = state.jobs.filter(j => j.status === 'running');
  jobsActiveBadge.textContent = activeJobs.length;

  if (!state.jobs || state.jobs.length === 0) {
    jobsMiniList.innerHTML = '<div class="empty-placeholder-sm">No running processes.</div>';
    return;
  }

  jobsMiniList.innerHTML = '';
  state.jobs.forEach(job => {
    const card = document.createElement('div');
    card.className = 'job-card-item';
    const isRunning = job.status === 'running';
    const statusColor = isRunning ? '#eab308' : (job.status === 'completed' ? '#10b981' : '#ef4444');

    card.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:3px;">
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:${statusColor};"></span>
          <strong style="font-family:var(--font-code); font-size:11px; color:#38bdf8;">${escapeHtml(job.id)}</strong>
        </div>
        <span style="font-size:10px; color:#858585;">${job.status}</span>
      </div>
      <div style="font-family:var(--font-code); font-size:10.5px; color:#cccccc; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
        ${escapeHtml(job.command)}
      </div>
    `;

    card.onclick = () => openJobInspector(job);
    jobsMiniList.appendChild(card);
  });
}

function addActivityFeedItem(rec) {
  state.activities.unshift(rec);

  // Sidebar Activity Feed Card
  const item = document.createElement('div');
  item.className = 'feed-item';
  item.style.cursor = 'pointer';
  item.title = 'Click to view full details and execution logs';
  const color = rec.success ? 'var(--green)' : 'var(--red)';
  const icon = rec.success ? '✓' : '✗';
  item.innerHTML = `
    <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
      <span style="color:${color}; font-weight:600;">${icon} ${escapeHtml(rec.tool)}</span>
      <span style="color:#858585; font-size:10px;">${rec.duration_ms || 0}ms</span>
    </div>
    <div style="font-family:var(--font-code); font-size:10px; color:#858585; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
      ${escapeHtml(JSON.stringify(rec.params || {}))}
    </div>
  `;
  item.onclick = () => openActivityInspector(rec);

  if (activityFeedScroll.querySelector('.empty-placeholder')) {
    activityFeedScroll.innerHTML = '';
  }
  activityFeedScroll.insertBefore(item, activityFeedScroll.firstChild);

  // Bottom Panel Execution Table Row
  const tr = document.createElement('tr');
  tr.style.cursor = 'pointer';
  tr.title = 'Click to inspect full details';

  // Build a short 1-line preview of the arguments (max 120 chars)
  const argsRaw = JSON.stringify(rec.params || {});
  const argsPreview = argsRaw.length > 120 ? argsRaw.slice(0, 118) + '…' : argsRaw;

  tr.innerHTML = `
    <td><span style="color:${color}; font-weight:600;">${icon} ${rec.success ? 'OK' : 'ERR'}</span></td>
    <td><code style="color:#dcdcaa;">${escapeHtml(rec.tool)}</code></td>
    <td style="color:#858585;">${new Date(rec.timestamp || Date.now()).toLocaleTimeString()}</td>
    <td style="color:#858585;">${rec.duration_ms || 0}ms</td>
    <td class="args-cell" title="${escapeHtml(argsRaw)}">${escapeHtml(argsPreview)}</td>
  `;
  tr.onclick = () => openActivityInspector(rec);

  if (execTableBody.querySelector('.empty-cell')) {
    execTableBody.innerHTML = '';
  }
  execTableBody.insertBefore(tr, execTableBody.firstChild);
}

// ========================================================
// 8. Custom Draggable Layout Resizers (User Req #5)
// ========================================================
function initResizers() {
  // ---- 1. Sidebar Width Resizer (left panel ↔ editor) ----
  if (sidebarResizer) {
    let isResizingSidebar = false;
    sidebarResizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isResizingSidebar = true;
      sidebarResizer.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    window.addEventListener('mousemove', (e) => {
      if (!isResizingSidebar) return;
      const newWidth = Math.max(160, Math.min(e.clientX - 48, window.innerWidth * 0.5));
      sidebarPanel.style.width = `${newWidth}px`;
      if (cmEditor) cmEditor.refresh();
    });
    window.addEventListener('mouseup', () => {
      if (!isResizingSidebar) return;
      isResizingSidebar = false;
      sidebarResizer.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (cmEditor) setTimeout(() => cmEditor.refresh(), 30);
    });
  }

  // ---- 2. Bottom Panel Height Resizer (editor ↔ terminal) ----
  if (panelResizer) {
    let isResizingBottom = false;
    panelResizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isResizingBottom = true;
      panelResizer.classList.add('resizing');
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    });
    window.addEventListener('mousemove', (e) => {
      if (!isResizingBottom) return;
      const newHeight = Math.max(70, Math.min(window.innerHeight - e.clientY - 24, window.innerHeight * 0.8));
      bottomPanel.style.height = `${newHeight}px`;
      if (cmEditor) cmEditor.refresh();
    });
    window.addEventListener('mouseup', () => {
      if (!isResizingBottom) return;
      isResizingBottom = false;
      panelResizer.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (cmEditor) setTimeout(() => cmEditor.refresh(), 30);
    });
  }

  // ---- 3. Activity Sidebar — Section A/B Height Resizer ----
  const jobsSection = document.getElementById('activity-section-jobs');
  if (activitySectionResizer && jobsSection) {
    let isResizingActivity = false;
    let startY = 0;
    let startH = 0;

    activitySectionResizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isResizingActivity = true;
      startY = e.clientY;
      startH = jobsSection.offsetHeight;
      activitySectionResizer.classList.add('resizing');
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isResizingActivity) return;
      const delta = e.clientY - startY;
      // Min 50px, max 70% of pane height
      const paneH = document.getElementById('pane-activity')?.offsetHeight || 400;
      const newH = Math.max(50, Math.min(startH + delta, paneH * 0.75));
      jobsSection.style.height = `${newH}px`;
    });

    window.addEventListener('mouseup', () => {
      if (!isResizingActivity) return;
      isResizingActivity = false;
      activitySectionResizer.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }
}

// ========================================================
// 9. Approvals Strip
// ========================================================
function updateApprovalsUI() {
  if (!state.pendingApprovals || state.pendingApprovals.length === 0) {
    approvalStrip.style.display = 'none';
    return;
  }

  const cur = state.pendingApprovals[0];
  approvalToolTag.textContent = cur.tool;
  renderApprovalPreview(cur);
  approvalStrip.style.display = 'block';

  if (window.soundEffects) {
    window.soundEffects.playChime();
  }
}

// Render a human-readable preview (diff for file edits) instead of raw JSON
function renderApprovalPreview(cur) {
  const p = cur.params || {};
  const tool = cur.tool;
  let diffEl = document.getElementById('approval-diff-preview');
  if (!diffEl) {
    diffEl = document.createElement('div');
    diffEl.id = 'approval-diff-preview';
    diffEl.className = 'approval-diff';
    approvalParamsJson.parentNode.insertBefore(diffEl, approvalParamsJson.nextSibling);
  }
  diffEl.style.display = 'none';
  approvalParamsJson.style.display = 'block';

  const esc = escapeHtml;
  if (tool === 'edit_file_replace' && typeof p.target === 'string') {
    approvalParamsJson.textContent = `✎ ${p.path || ''}`;
    diffEl.innerHTML =
      p.target.split('\n').map(l => `<div class="d-del">- ${esc(l)}</div>`).join('') +
      String(p.replacement ?? '').split('\n').map(l => `<div class="d-add">+ ${esc(l)}</div>`).join('');
    diffEl.style.display = 'block';
  } else if (tool === 'edit_file_multi' && Array.isArray(p.edits)) {
    approvalParamsJson.textContent = `✎ ${p.path || ''} · ${p.edits.length} edit(s)`;
    diffEl.innerHTML = p.edits.map(e =>
      String(e.target ?? '').split('\n').map(l => `<div class="d-del">- ${esc(l)}</div>`).join('') +
      String(e.replacement ?? '').split('\n').map(l => `<div class="d-add">+ ${esc(l)}</div>`).join('') +
      '<div class="d-ctx">———</div>'
    ).join('');
    diffEl.style.display = 'block';
  } else if (tool === 'write_file' && typeof p.content === 'string') {
    const preview = p.content.split('\n').slice(0, 40);
    approvalParamsJson.textContent = `✎ ${p.path || ''} · new content (${p.content.split('\n').length} lines)`;
    diffEl.innerHTML = preview.map(l => `<div class="d-add">+ ${esc(l)}</div>`).join('') +
      (p.content.split('\n').length > 40 ? '<div class="d-ctx">… (truncated)</div>' : '');
    diffEl.style.display = 'block';
  } else {
    approvalParamsJson.textContent = JSON.stringify(p);
  }
}

// ========================================================
// 10. Event Listeners & IPC Setup
// ========================================================
function setupEventListeners() {
  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveCurrentFile();
    }
  });
  document.getElementById('btn-theme').onclick = () => {
    const theme = document.documentElement.dataset.theme === 'midnight' ? 'graphite' : 'midnight';
    applyTheme(theme);
    localStorage.setItem('omnidev-theme', theme);
  };

  // Brand Logo -> Show Welcome Screen / Workspace List
  btnBrandHome.onclick = () => {
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    showScreen('screen-welcome');
  };

  // Project Dropdown Toggle
  btnProjectDropdown.onclick = (e) => {
    e.stopPropagation();
    const isOpen = projectDropdownMenu.style.display === 'block';
    projectDropdownMenu.style.display = isOpen ? 'none' : 'block';
  };

  window.addEventListener('click', () => {
    projectDropdownMenu.style.display = 'none';
  });

  // Inspector Copy Buttons
  btnInspCopyOutput.onclick = () => {
    navigator.clipboard.writeText(inspOutputBox.textContent);
    showToast('Execution output copied to clipboard!');
  };

  btnCopyInspParams.onclick = () => {
    navigator.clipboard.writeText(inspParamsBox.textContent);
    showToast('Parameters JSON copied to clipboard!');
  };

  const settingsSections = [...document.querySelectorAll('[data-settings-section]')];
  const chooseSettingsSection = section => {
    for (const button of settingsSections) {
      const active = button.dataset.settingsSection === section;
      button.setAttribute('aria-current', active ? 'true' : 'false');
      document.getElementById('settings-' + button.dataset.settingsSection).hidden = !active;
    }
    if (section === 'plugins') refreshPluginsList().catch(error => showToast(error.message));
  };

  const openSettings = () => {
    setTunnelType.value = state.settings.tunnelType || 'local';
    setNgrokToken.value = state.settings.ngrokAuthToken || '';
    setNgrokDomain.value = state.settings.ngrokStaticDomain || '';
    setMcpToken.value = state.settings.mcpSecretToken || '';
    setPermMode.value = state.settings.permissionMode || 'smart';
    setChkSound.checked = state.settings.soundEnabled !== false;
    setChkSandbox.checked = !state.settings.allowEscape;
    settingsMcpUrl.type = 'password';
    const reveal = document.getElementById('btn-reveal-mcp-url');
    reveal.textContent = 'Show';
    reveal.setAttribute('aria-pressed', 'false');
    chooseSettingsSection('tunnel');
    renderTunnelSettings();
    modalSettings.style.display = 'flex';
    settingsSections[0].focus();
  };

  const closeSettings = () => { modalSettings.style.display = 'none'; };
  btnHdrSettings.onclick = btnRailSettings.onclick = btnHdrConnectGuide.onclick = openSettings;
  btnCloseSettings.onclick = btnCancelSettings.onclick = closeSettings;
  modalSettings.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSettings();
  });
  settingsSections.forEach(button => {
    button.onclick = () => chooseSettingsSection(button.dataset.settingsSection);
  });
  setTunnelType.onchange = renderTunnelSettings;

  const copyMcpUrl = async () => {
    if (!state.mcpUrl) return;
    await navigator.clipboard.writeText(state.mcpUrl);
    showToast('MCP URL copied.');
  };
  btnHdrCopyMcp.onclick = document.getElementById('btn-copy-settings-url').onclick = copyMcpUrl;
  document.getElementById('btn-reveal-mcp-url').onclick = event => {
    const show = settingsMcpUrl.type === 'password';
    settingsMcpUrl.type = show ? 'text' : 'password';
    event.currentTarget.textContent = show ? 'Hide' : 'Show';
    event.currentTarget.setAttribute('aria-pressed', String(show));
  };

  const docUrls = {
    chatgpt: 'https://developers.openai.com/api/docs/guides/custom-mcp-server',
    claude: 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp',
    gemini: 'https://geminicli.com/docs/tools/mcp-server/'
  };
  document.querySelectorAll('[data-mcp-doc]').forEach(button => {
    button.onclick = () => shell.openExternal(docUrls[button.dataset.mcpDoc]);
  });
  document.querySelectorAll('[data-skills-client]').forEach(button => {
    button.onclick = async () => {
      try {
        await ipcRenderer.invoke('open-client-skills-dir', button.dataset.skillsClient);
      } catch (error) {
        showToast(error.message);
      }
    };
  });
  document.querySelectorAll('[data-mcp-client]').forEach(button => {
    button.onclick = async () => {
      const label = button.querySelector('small');
      const status = document.getElementById('settings-client-status');
      configuringClient = true;
      setTunnelType.disabled = true;
      btnSaveSettings.disabled = true;
      renderTunnelSettings();
      status.textContent = 'Checking client installation…';
      try {
        const result = await ipcRenderer.invoke('configure-local-mcp-client', button.dataset.mcpClient);
        applySettingsResponse(result);
        label.textContent = 'Configured';
        status.textContent = (result.changed ? 'Added to ' : 'Already configured in ') + result.path + ' · Restart the client to reload.';
      } catch (error) {
        status.textContent = error.message;
      } finally {
        configuringClient = false;
        setTunnelType.disabled = false;
        btnSaveSettings.disabled = false;
        renderTunnelSettings();
      }
    };
  });

  function applySettingsResponse(res) {
    if (res.settings) state.settings = res.settings;
    state.mcpUrl = res.mcpUrl;
    state.tunnel = res.tunnel;
    updateSoundUI();
    updateTunnelUI();
  }
  btnHdrSound.onclick = async () => {
    try {
      applySettingsResponse(await ipcRenderer.invoke('update-settings', { soundEnabled: !state.settings.soundEnabled }));
    } catch (error) {
      showToast(error.message);
    }
  };
  btnTestChime.onclick = () => {
    if (!window.soundEffects) return;
    const previous = window.soundEffects.enabled;
    window.soundEffects.enabled = true;
    window.soundEffects.playChime();
    window.soundEffects.enabled = previous;
  };
  document.getElementById('btn-clear-approvals').onclick = async () => {
    await ipcRenderer.invoke('clear-session-approvals');
    showToast('Session approvals cleared.');
  };
  document.getElementById('btn-reconnect-tunnel').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      applySettingsResponse(await ipcRenderer.invoke('reconnect-tunnel'));
    } catch (error) {
      showToast(error.message);
    } finally {
      renderTunnelSettings();
    }
  };
  btnRegenTokenSettings.onclick = async () => {
    if (!window.confirm('Regenerate the MCP token? Connected clients will need the new URL.')) return;
    const res = await ipcRenderer.invoke('regenerate-mcp-token');
    state.settings.mcpSecretToken = res.token;
    state.mcpUrl = res.mcpUrl;
    document.querySelectorAll('[data-mcp-client] small').forEach(label => { label.textContent = 'Configure'; });
    document.getElementById('settings-client-status').textContent = '';
    updateTunnelUI();
    showToast('MCP token regenerated.');
  };

  btnSaveSettings.onclick = async () => {
    btnSaveSettings.disabled = true;
    try {
      const res = await ipcRenderer.invoke('update-settings', {
        tunnelType: setTunnelType.value,
        ngrokAuthToken: setNgrokToken.value.trim(),
        ngrokStaticDomain: setNgrokDomain.value.trim(),
        permissionMode: setPermMode.value,
        soundEnabled: setChkSound.checked,
        allowEscape: !setChkSandbox.checked
      });
      applySettingsResponse(res);
      showToast('Settings saved.');
    } catch (error) {
      showToast(error.message);
    } finally {
      btnSaveSettings.disabled = false;
    }
  };

  // ── Plugins Management ────────────────────────────────────────────────────
  const pluginsList = document.getElementById('plugins-list');
  const btnOpenPluginsDir = document.getElementById('btn-open-plugins-dir');
  const btnReloadPlugins = document.getElementById('btn-reload-plugins');

  // Track plugin errors from IPC events
  const pluginErrors = Object.create(null);

  const refreshPluginsList = async () => {
    if (!pluginsList) return;
    const plugins = await ipcRenderer.invoke('get-plugins');
    if (!plugins.length && !Object.keys(pluginErrors).length) {
      pluginsList.innerHTML = '<div class="plugins-empty-state">No plugins loaded yet. Add .js files to the plugins/ folder.</div>';
      return;
    }
    pluginsList.innerHTML = plugins.map(p => `
      <div class="plugin-item plugin-ok" title="${escapeHtml(p.description)}">
        <div class="plugin-dot"></div>
        <span class="plugin-name">${escapeHtml(p.name)}</span>
        <span class="plugin-file">${escapeHtml(p.file)}</span>
        ${p.isCritical ? '<span class="plugin-critical-badge">critical</span>' : ''}
      </div>
    `).join('');

    // Also show any recent errors
    Object.entries(pluginErrors).forEach(([file, errMsg]) => {
      const isLoaded = plugins.some(p => p.file === file);
      if (!isLoaded) {
        pluginsList.innerHTML += `
          <div class="plugin-item plugin-error" title="${escapeHtml(file)}: ${escapeHtml(errMsg)}">
            <div class="plugin-dot"></div>
            <span class="plugin-name">${escapeHtml(file)}</span>
            <span class="plugin-error-msg">${escapeHtml(errMsg)}</span>
          </div>
        `;
      }
    });
  };

  if (btnOpenPluginsDir) {
    btnOpenPluginsDir.onclick = async () => {
      await ipcRenderer.invoke('open-plugins-dir');
    };
  }

  if (btnReloadPlugins) {
    btnReloadPlugins.onclick = async () => {
      btnReloadPlugins.textContent = 'Reloading...';
      btnReloadPlugins.disabled = true;
      try {
        Object.keys(pluginErrors).forEach(file => { delete pluginErrors[file]; });
        const res = await ipcRenderer.invoke('reload-plugins');
        await refreshPluginsList();
        showToast(`Plugins reloaded: ${res.plugins.length} loaded, ${res.toolsCount} total tools`);
      } catch (err) {
        showToast('Plugin reload error: ' + err.message);
      } finally {
        btnReloadPlugins.textContent = '↺ Reload All Plugins';
        btnReloadPlugins.disabled = false;
      }
    };
  }

  // Activity Rail Navigation
  document.querySelectorAll('.rail-icon[data-pane]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.rail-icon[data-pane]').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.sidebar-view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      const pane = document.getElementById(btn.dataset.pane);
      if (pane) pane.classList.add('active');
    };
  });

  // Edit Developer Notes Modal
  btnTriggerEditNotes.onclick = () => {
    if (state.activeProject) {
      editNotesInput.value = state.activeProject.notes || '';
      modalEditNotes.style.display = 'flex';
    }
  };
  btnCloseEditNotes.onclick = () => { modalEditNotes.style.display = 'none'; };
  btnCancelEditNotes.onclick = () => { modalEditNotes.style.display = 'none'; };

  btnSaveEditNotes.onclick = async () => {
    if (!state.activeProject) return;
    const notes = editNotesInput.value.trim();
    await ipcRenderer.invoke('update-project', {
      id: state.activeProject.id,
      updates: { notes }
    });
    state.activeProject.notes = notes;
    sbNotesText.textContent = notes || 'No notes.';
    modalEditNotes.style.display = 'none';
    showToast('Updated environment notes!');
  };

  // New Workspace Wizard
  const openWiz = () => {
    wizName.value = '';
    wizPath.value = '';
    wizNotes.value = '';
    modalNewProject.style.display = 'flex';
  };
  btnHdrNewProj.onclick = openWiz;
  btnNewWorkspaceSide.onclick = openWiz;
  const btnWNewProj = document.getElementById('btn-w-new-proj');
  if (btnWNewProj) btnWNewProj.onclick = openWiz;

  const btnWOpenFolder = document.getElementById('btn-w-open-folder');
  if (btnWOpenFolder) {
    btnWOpenFolder.onclick = async () => {
      const selected = await ipcRenderer.invoke('select-directory-dialog');
      if (selected) {
        const folderName = selected.split(/\\|\//).pop() || 'Workspace';
        const res = await ipcRenderer.invoke('create-project', {
          name: folderName,
          path: selected,
          type: 'General',
          notes: ''
        });
        state.projects.unshift(res.project);
        state.activeProject = res.project;
        state.mcpUrl = res.mcpUrl;
        updateProjectUI();
        loadFileTree();
        renderRecentWorkspaces();
        showBlankScreen();
        showToast(`Opened folder: ${folderName}`);
      }
    };
  }

  document.getElementById('btn-w-connect-mcp').onclick = openSettings;

  btnWizBrowse.onclick = async () => {
    const selected = await ipcRenderer.invoke('select-directory-dialog');
    if (selected) {
      wizPath.value = selected;
      if (!wizName.value) {
        wizName.value = selected.split(/\\|\//).pop() || 'Project';
      }
    }
  };

  btnCloseNewProj.onclick = () => { modalNewProject.style.display = 'none'; };
  btnCancelNewProj.onclick = () => { modalNewProject.style.display = 'none'; };

  btnCreateNewProj.onclick = async () => {
    const name = wizName.value.trim();
    const dir = wizPath.value.trim();
    if (!name || !dir) {
      alert('Project Name and Directory are required.');
      return;
    }
    const res = await ipcRenderer.invoke('create-project', {
      name,
      path: dir,
      type: wizType.value,
      notes: wizNotes.value
    });
    state.projects.unshift(res.project);
    state.activeProject = res.project;
    state.mcpUrl = res.mcpUrl;
    modalNewProject.style.display = 'none';
    updateProjectUI();
    loadFileTree();
    renderRecentWorkspaces();
    showBlankScreen();
    showToast(`Created workspace: ${name}`);
  };

  btnRefreshTree.onclick = () => loadFileTree();
  for (const id of ['acc-hdr-root', 'acc-hdr-notes']) {
    const button = document.getElementById(id);
    button.onclick = () => {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      document.getElementById(button.getAttribute('aria-controls')).hidden = expanded;
      button.setAttribute('aria-expanded', String(!expanded));
    };
  }
  document.getElementById('btn-close-workspace').onclick = async () => {
    if (state.currentFile && cmEditor && !cmEditor.isClean()
      && !window.confirm('Close this workspace and discard unsaved editor changes?')) return;
    try {
      const res = await ipcRenderer.invoke('set-active-project', null);
      state.activeProject = res.activeProject;
      updateProjectUI();
      loadFileTree();
      showScreen('screen-welcome');
    } catch (error) {
      showToast(error.message);
    }
  };
  btnSaveCodeFile.onclick = saveCurrentFile;

  // Bottom Panel Tabs
  document.querySelectorAll('.p-tab').forEach(tab => {
    tab.onclick = () => selectPanel(tab.dataset.panel);
  });

  btnClearTerm.onclick = () => {
    pendingTerminal = '';
    terminalBuffer = '';
    terminalStreamBox.textContent = '';
  };
  btnTogglePanel.onclick = () => {
    const collapsed = bottomPanel.classList.toggle('collapsed');
    btnTogglePanel.setAttribute('aria-expanded', String(!collapsed));
    setTimeout(() => { if (cmEditor) cmEditor.refresh(); }, 50);
  };

  btnKillProc.onclick = async () => {
    if (state.selectedJobId) {
      await ipcRenderer.invoke('cancel-job', state.selectedJobId);
      showToast(`Killed job: ${state.selectedJobId}`);
    }
  };

  // Custom Window Controls (Frameless Titlebar)
  if (btnWinMin) btnWinMin.onclick = () => ipcRenderer.send('window-min');
  if (btnWinMax) btnWinMax.onclick = () => ipcRenderer.send('window-max');
  if (btnWinClose) btnWinClose.onclick = () => { modalCloseConfirm.style.display = 'flex'; };

  // Close Confirmation Modal
  if (btnCloseConfirmX) btnCloseConfirmX.onclick = () => { modalCloseConfirm.style.display = 'none'; };
  if (btnCloseCancel) btnCloseCancel.onclick = () => { modalCloseConfirm.style.display = 'none'; };
  if (btnCloseTray) {
    btnCloseTray.onclick = () => {
      modalCloseConfirm.style.display = 'none';
      ipcRenderer.send('window-minimize-to-tray');
    };
  }
  if (btnCloseExit) {
    btnCloseExit.onclick = () => {
      modalCloseConfirm.style.display = 'none';
      ipcRenderer.send('app-exit');
    };
  }

  btnClearActivityFeed.onclick = () => {
    activityFeedScroll.innerHTML = '<div class="empty-placeholder">Activity feed cleared.</div>';
    execTableBody.innerHTML = '<tr><td colspan="5" class="empty-cell">Execution log cleared.</td></tr>';
    state.activities = [];

    // Clear completed / failed / canceled jobs from view, but keep running tasks
    state.jobs = state.jobs.filter(j => j.status === 'running');
    renderJobsList();

    showToast('Activity feed and finished tasks cleared from view');
  };

  // Approval Handlers
  btnApproveAction.onclick = async () => {
    if (state.pendingApprovals.length === 0) return;
    const cur = state.pendingApprovals[0];
    await ipcRenderer.invoke('approve-action', { id: cur.id, approveAllForSession: false });
    if (window.soundEffects) window.soundEffects.playSuccess();
    state.pendingApprovals.shift();
    updateApprovalsUI();
    showToast(`Approved ${cur.tool}`);
  };

  btnApproveSession.onclick = async () => {
    if (state.pendingApprovals.length === 0) return;
    const cur = state.pendingApprovals[0];
    await ipcRenderer.invoke('approve-action', { id: cur.id, approveAllForSession: true });
    if (window.soundEffects) window.soundEffects.playSuccess();
    state.pendingApprovals.shift();
    updateApprovalsUI();
    showToast(`Whitelisted ${cur.tool} for session`);
  };

  btnDenyAction.onclick = async () => {
    if (state.pendingApprovals.length === 0) return;
    const cur = state.pendingApprovals[0];
    await ipcRenderer.invoke('deny-action', { id: cur.id, reason: 'Denied by user' });
    state.pendingApprovals.shift();
    updateApprovalsUI();
    showToast(`Denied ${cur.tool}`);
  };

  // ========================================================
  // IPC Events from Main Process
  // ========================================================
  ipcRenderer.on('approval-requested', (event, req) => {
    state.pendingApprovals.push(req);
    updateApprovalsUI();
  });

  ipcRenderer.on('approval-resolved', (event, data) => {
    state.pendingApprovals = state.pendingApprovals.filter(a => a.id !== data.id);
    updateApprovalsUI();
  });

  ipcRenderer.on('job-started', (event, job) => {
    state.selectedJobId = job.id;
    job.startTime = Date.now();
    job.output = '';
    const existing = state.jobs.find(j => j.id === job.id);
    if (existing) {
      Object.assign(existing, job);
    } else {
      state.jobs.unshift(job);
    }
    renderJobsList();

    panelShellStatus.textContent = `${job.id} [running]`;
    btnKillProc.style.display = 'inline-block';
    appendTerminal(`\n\n> [JOB: ${job.id}] ${job.command}\n`);
  });

  ipcRenderer.on('job-output', (event, data) => {
    const text = data.text || '';
    const targetJob = state.jobs.find(j => j.id === data.id);
    if (targetJob) {
      let o = (targetJob.output || '') + text;
      if (o.length > outputLimit) o = o.slice(-outputLimit);
      targetJob.output = o;
    }
    appendTerminal(text);
  });

  ipcRenderer.on('job-finished', (event, job) => {
    const existing = state.jobs.find(j => j.id === job.id);
    if (existing) {
      Object.assign(existing, job);
    }
    renderJobsList();

    appendTerminal(`\n[JOB: ${job.id}] ${job.status}${job.exitCode === null ? '' : ` (exit ${job.exitCode})`}\n`);
    if (state.selectedJobId === job.id) {
      const running = state.jobs.find(item => item.status === 'running');
      state.selectedJobId = running?.id || null;
      panelShellStatus.textContent = running ? `${running.id} [running]` : `${job.id} [${job.status}]`;
      btnKillProc.style.display = running ? 'inline-block' : 'none';
    }

    // If currently inspecting this job, update badge and hide kill button
    if (state.currentlyInspecting?.type === 'job' && state.currentlyInspecting.id === job.id) {
      inspStatusBadge.textContent = (job.status || 'FINISHED').toUpperCase();
      inspStatusBadge.className = `status-badge ${job.status === 'completed' ? '' : 'failed'}`;
      inspStatusBadge.style.backgroundColor = '';
      inspStatusBadge.style.color = '';
      btnInspKillJob.style.display = 'none';
    }
  });

  ipcRenderer.on('tool-executed', (event, rec) => {
    addActivityFeedItem(rec);
  });

  ipcRenderer.on('tunnel-status', (event, status) => {
    state.tunnel = status;
    state.mcpUrl = status.mcpUrl || '';
    updateTunnelUI();
  });

  // AI called update_project_context tool — live update sidebar & blank canvas
  ipcRenderer.on('project-context-updated', (event, project) => {
    if (state.activeProject && state.activeProject.id === project.id) {
      state.activeProject = { ...state.activeProject, ...project };
      sbNotesText.textContent = project.notes || 'No notes.';
      sbRootType.textContent = project.type || state.activeProject.type || 'General';
      blankWorkspaceTitle.textContent = project.name;
      // Update the projects list too
      const idx = state.projects.findIndex(p => p.id === project.id);
      if (idx >= 0) state.projects[idx] = { ...state.projects[idx], ...project };
    }
    // Show a toast so user knows AI updated the context
    showToast(`✓ AI updated project context: "${project.name}"`);
  });

  // Plugin events from main process
  ipcRenderer.on('plugin-loaded', (event, plugin) => {
    showToast(`Plugin loaded: ${plugin.name} (${plugin.file})`);
    if (pluginErrors) delete pluginErrors[plugin.file];
    // Silently refresh if settings modal is open
    if (pluginsList && modalSettings.style.display !== 'none') {
      refreshPluginsList();
    }
  });

  ipcRenderer.on('plugin-unloaded', (event, { name, file }) => {
    showToast(`Plugin unloaded: ${name}`);
    if (modalSettings.style.display !== 'none') refreshPluginsList();
  });

  ipcRenderer.on('plugin-error', (event, errInfo) => {
    pluginErrors[errInfo.file] = errInfo.error;
    showToast(`Plugin error (${errInfo.file}): ${errInfo.error.slice(0, 60)}`, 'error');
    if (modalSettings.style.display !== 'none') refreshPluginsList();
  });

  // Instant File Explorer Refresh when files are created/modified/deleted
  ipcRenderer.on('workspace-files-changed', () => {
    // Coalesce rapid file-change bursts (e.g. during a build) into one reload
    if (fileTreeReloadTimer) clearTimeout(fileTreeReloadTimer);
    fileTreeReloadTimer = setTimeout(() => { fileTreeReloadTimer = null; loadFileTree(); }, 500);
  });

  // Prompt close dialog on OS close / Alt+F4
  ipcRenderer.on('show-close-dialog', () => {
    if (modalCloseConfirm) modalCloseConfirm.style.display = 'flex';
  });

  // Window maximized state toggle for icon
  ipcRenderer.on('window-maximized-state', (event, isMax) => {
    if (btnWinMax) {
      btnWinMax.innerHTML = isMax ? '&#x274F;' : '&#x25A1;';
      btnWinMax.title = isMax ? 'Restore Window' : 'Maximize Window';
    }
  });
}

// ========================================================
// 11. Helper Utilities
// ========================================================
function showToast(msg) {
  const toast = document.getElementById('studio-toast');
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 2800);
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}


document.addEventListener('DOMContentLoaded', init);

// ========================================================
// 12. v2 — Skills, Tools Catalog, Audit, Command Palette
// ========================================================
const V2_THEMES = ['midnight', 'graphite', 'ocean', 'light'];
const V2_THEME_LABELS = { midnight: 'Midnight', graphite: 'Graphite', ocean: 'Ocean', light: 'Light' };

function applyThemeV2(theme) {
  const t = V2_THEMES.includes(theme) ? theme : 'midnight';
  document.documentElement.dataset.theme = t;
  const b = document.getElementById('btn-theme');
  if (b) {
    b.textContent = V2_THEME_LABELS[t];
    b.setAttribute('aria-label', `Theme: ${V2_THEME_LABELS[t]}. Switch theme`);
  }
  localStorage.setItem('omnidev-theme', t);
}

// ---- Skills & Plugins pane ----
async function refreshSkillsPane() {
  const list = document.getElementById('skills-list');
  if (!list) return;
  let plugins = [];
  try { plugins = await ipcRenderer.invoke('get-plugins'); } catch (_) {}
  if (!plugins.length) {
    list.innerHTML = '<div class="empty-placeholder">No skills yet. Click + to create one, or drop a .js file in the plugins folder.</div>';
    return;
  }
  list.innerHTML = plugins.map(renderSkillCard).join('');
  wireSkillCards(plugins);
}

function renderSkillCard(p) {
  const cfgRows = (p.configSchema || []).map(f => {
    const val = (p.config && p.config[f.key] !== undefined) ? p.config[f.key] : (f.default ?? '');
    return `<div class="skill-config-row">
      <label>${escapeHtml(f.label || f.key)}</label>
      <input data-cfg-key="${escapeHtml(f.key)}" value="${escapeHtml(String(val))}" placeholder="${escapeHtml(String(f.default ?? ''))}">
    </div>`;
  }).join('');
  return `<div class="skill-card ${p.enabled ? '' : 'disabled'}" data-skill="${escapeHtml(p.name)}">
    <div class="skill-card-top">
      <span class="skill-name">${escapeHtml(p.name)}</span>
      <span class="skill-cat">${escapeHtml(p.category || 'General')}</span>
      ${p.isCritical ? '<span class="skill-crit-badge">critical</span>' : ''}
      <span class="skill-ver">v${escapeHtml(p.version || '1.0.0')}</span>
    </div>
    <div class="skill-desc">${escapeHtml(p.description || '')}</div>
    <div class="skill-meta">${escapeHtml(p.file || '')}${p.author ? ' · by ' + escapeHtml(p.author) : ''}</div>
    ${cfgRows ? `<div class="skill-config-box">${cfgRows}<button class="btn btn-xs btn-outline btn-save-cfg">Save config</button></div>` : ''}
    <div class="skill-actions">
      <span class="toggle-switch ${p.enabled ? 'on' : ''}" title="Enable / disable"></span>
      <span class="skill-meta">${p.enabled ? 'Enabled' : 'Disabled'}</span>
    </div>
  </div>`;
}

function wireSkillCards(plugins) {
  document.querySelectorAll('#skills-list .skill-card').forEach(card => {
    const name = card.dataset.skill;
    const toggle = card.querySelector('.toggle-switch');
    if (toggle) toggle.onclick = async () => {
      const enable = !toggle.classList.contains('on');
      try {
        await ipcRenderer.invoke('toggle-plugin', { name, enabled: enable });
        refreshSkillsPane();
        showToast(`Skill "${name}" ${enable ? 'enabled' : 'disabled'}.`);
      } catch (e) { showToast(e.message); }
    };
    const saveBtn = card.querySelector('.btn-save-cfg');
    if (saveBtn) saveBtn.onclick = async () => {
      const config = {};
      card.querySelectorAll('[data-cfg-key]').forEach(inp => { config[inp.dataset.cfgKey] = inp.value; });
      try {
        await ipcRenderer.invoke('set-plugin-config', { name, config });
        showToast(`Saved config for "${name}".`);
      } catch (e) { showToast(e.message); }
    };
  });
}

// ---- Tools catalog pane ----
let toolsCatalogCache = [];
async function refreshToolsPane() {
  try { toolsCatalogCache = await ipcRenderer.invoke('get-tools-catalog'); } catch (_) { toolsCatalogCache = []; }
  const badge = document.getElementById('tools-count-badge');
  if (badge) badge.textContent = toolsCatalogCache.length;
  renderToolsList(document.getElementById('tools-search')?.value || '');
}

function renderToolsList(filter) {
  const list = document.getElementById('tools-catalog-list');
  if (!list) return;
  const f = (filter || '').toLowerCase();
  const rows = toolsCatalogCache.filter(t =>
    t.name.toLowerCase().includes(f) || (t.description || '').toLowerCase().includes(f) || (t.category || '').toLowerCase().includes(f));
  if (!rows.length) { list.innerHTML = '<div class="empty-placeholder">No matching tools.</div>'; return; }

  // Group by category
  const groups = {};
  rows.forEach(t => { const c = t.category || 'Other'; (groups[c] = groups[c] || []).push(t); });
  const order = Object.keys(groups).sort((a, b) => a.localeCompare(b));

  const rowHtml = (t) => {
    const dotCls = t.isPlugin ? 'plugin' : (t.isCritical ? 'crit' : '');
    return `<div class="tool-row" data-tool="${escapeHtml(t.name)}">
      <div class="tool-info">
        <div class="tool-name"><span class="tool-dot ${dotCls}"></span>${escapeHtml(t.name)}</div>
        <div class="tool-desc">${escapeHtml(t.description || '')}</div>
      </div>
      <select class="tool-policy ${t.policy}">
        <option value="default" ${t.policy === 'default' ? 'selected' : ''}>Default</option>
        <option value="auto" ${t.policy === 'auto' ? 'selected' : ''}>Auto</option>
        <option value="ask" ${t.policy === 'ask' ? 'selected' : ''}>Ask</option>
        <option value="deny" ${t.policy === 'deny' ? 'selected' : ''}>Deny</option>
      </select>
    </div>`;
  };

  // When searching, keep groups expanded; otherwise also expanded by default.
  list.innerHTML = order.map(cat => `
    <div class="tools-group">
      <div class="tools-group-hdr"><span class="grp-caret">▾</span><span class="grp-name">${escapeHtml(cat)}</span><span class="grp-count">${groups[cat].length}</span></div>
      <div class="tools-group-body">${groups[cat].map(rowHtml).join('')}</div>
    </div>`).join('');

  list.querySelectorAll('.tools-group-hdr').forEach(h => {
    h.onclick = () => h.parentElement.classList.toggle('collapsed');
  });

  list.querySelectorAll('.tool-row').forEach(row => {
    const sel = row.querySelector('.tool-policy');
    sel.onchange = async () => {
      const policies = {};
      toolsCatalogCache.forEach(t => { if (t.policy && t.policy !== 'default') policies[t.name] = t.policy; });
      const name = row.dataset.tool;
      if (sel.value === 'default') delete policies[name]; else policies[name] = sel.value;
      try {
        await ipcRenderer.invoke('set-tool-policies', policies);
        const t = toolsCatalogCache.find(x => x.name === name); if (t) t.policy = sel.value;
        sel.className = 'tool-policy ' + sel.value;
        showToast(`Policy for "${name}" → ${sel.value}.`);
      } catch (e) { showToast(e.message); }
    };
  });
}

// ---- Audit history pane ----
async function refreshAuditPane() {
  const list = document.getElementById('audit-list');
  if (!list) return;
  let entries = [];
  try { entries = await ipcRenderer.invoke('get-audit-log', 250); } catch (_) {}
  if (!entries.length) { list.innerHTML = '<div class="empty-placeholder">No audit entries yet.</div>'; return; }

  // Analytics summary
  const total = entries.length;
  const ok = entries.filter(e => e.success).length;
  const rate = Math.round((ok / total) * 100);
  const durs = entries.filter(e => typeof e.duration_ms === 'number');
  const avg = durs.length ? Math.round(durs.reduce((s, e) => s + e.duration_ms, 0) / durs.length) : 0;
  const counts = {};
  entries.forEach(e => { counts[e.tool] = (counts[e.tool] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const analytics = `<div class="analytics-bar">
      <div class="an-card"><div class="an-val">${total}</div><div class="an-lbl">calls</div></div>
      <div class="an-card"><div class="an-val">${rate}%</div><div class="an-lbl">success</div></div>
      <div class="an-card"><div class="an-val">${avg}ms</div><div class="an-lbl">avg time</div></div>
    </div>
    <div class="an-top">Top: ${top.map(t => `<b>${escapeHtml(t[0])}</b> (${t[1]})`).join(' · ') || '—'}</div>`;

  list.innerHTML = analytics + entries.map(e => {
    const time = (e.ts || '').replace('T', ' ').slice(0, 19);
    return `<div class="audit-row">
      <span class="audit-ic ${e.success ? 'ok' : 'fail'}"></span>
      <span class="audit-tool">${escapeHtml(e.tool || '?')}</span>
      <span class="audit-dur">${e.duration_ms != null ? e.duration_ms + 'ms' : ''}</span>
      <span class="audit-time">${escapeHtml(time)}</span>
    </div>`;
  }).join('');
}

// ---- Command palette ----
function buildPaletteCommands() {
  const cmds = [
    { kind: 'Pane', label: 'Open Explorer', ic: '📁', run: () => activateRailPane('pane-explorer') },
    { kind: 'Pane', label: 'Open Live Activity', ic: '⚡', run: () => activateRailPane('pane-activity') },
    { kind: 'Pane', label: 'Open Skills & Plugins', ic: '✦', run: () => activateRailPane('pane-skills') },
    { kind: 'Pane', label: 'Open Tools & Permissions', ic: '🛠', run: () => activateRailPane('pane-tools') },
    { kind: 'Pane', label: 'Open Audit History', ic: '🕑', run: () => activateRailPane('pane-history') },
    { kind: 'Pane', label: 'Open Checkpoints', ic: '↺', run: () => activateRailPane('pane-checkpoints') },
    { kind: 'Pane', label: 'Open Live Preview', ic: '🖥', run: () => activateRailPane('pane-preview') },
    { kind: 'Pane', label: 'Open Database Browser', ic: '🗄', run: () => activateRailPane('pane-db') },
    { kind: 'Action', label: 'Create a new skill', ic: '＋', run: () => openNewSkillModal() },
    { kind: 'Action', label: 'Open plugins folder', ic: '📂', run: () => ipcRenderer.invoke('open-plugins-dir') },
    { kind: 'Action', label: 'Reload all skills', ic: '↺', run: async () => { await ipcRenderer.invoke('reload-plugins'); refreshSkillsPane(); showToast('Skills reloaded.'); } },
    { kind: 'Action', label: 'Open Settings', ic: '⚙', run: () => document.getElementById('btn-hdr-settings')?.click() },
    { kind: 'Action', label: 'Cycle theme', ic: '🎨', run: () => document.getElementById('btn-theme')?.click() },
    { kind: 'Action', label: 'New workspace', ic: '🗂', run: () => document.getElementById('btn-hdr-new-proj')?.click() }
  ];
  toolsCatalogCache.forEach(t => cmds.push({ kind: 'Tool', label: t.name, ic: '∴', run: () => { activateRailPane('pane-tools'); const s = document.getElementById('tools-search'); if (s) { s.value = t.name; renderToolsList(t.name); } } }));
  return cmds;
}

function activateRailPane(id) {
  const btn = document.querySelector(`.rail-icon[data-pane="${id}"]`);
  if (btn) btn.click();
}

let paletteCmds = [];
let paletteActive = 0;
function openPalette() {
  const bd = document.getElementById('cmd-palette');
  const input = document.getElementById('cmd-palette-input');
  if (!bd) return;
  paletteCmds = buildPaletteCommands();
  bd.style.display = 'flex';
  input.value = '';
  renderPalette('');
  input.focus();
}
function closePalette() {
  const bd = document.getElementById('cmd-palette');
  if (bd) bd.style.display = 'none';
}
function renderPalette(q) {
  const box = document.getElementById('cmd-palette-results');
  const f = (q || '').toLowerCase();
  const rows = paletteCmds.filter(c => c.label.toLowerCase().includes(f) || c.kind.toLowerCase().includes(f)).slice(0, 40);
  paletteActive = 0;
  box.innerHTML = rows.map((c, i) =>
    `<div class="cmd-item ${i === 0 ? 'active' : ''}" data-i="${i}"><span class="cmd-ic">${c.ic}</span><span>${escapeHtml(c.label)}</span><span class="cmd-kind">${c.kind}</span></div>`
  ).join('') || '<div class="cmd-item">No matches</div>';
  box._rows = rows;
  box.querySelectorAll('.cmd-item[data-i]').forEach(el => {
    el.onclick = () => { const r = box._rows[Number(el.dataset.i)]; closePalette(); if (r) r.run(); };
  });
}

function openNewSkillModal() {
  const m = document.getElementById('modal-new-skill');
  document.getElementById('skill-name').value = '';
  document.getElementById('skill-desc').value = '';
  document.getElementById('skill-category').value = 'Custom';
  document.getElementById('skill-critical').checked = false;
  m.style.display = 'flex';
  document.getElementById('skill-name').focus();
}

function setupV2Features() {
  applyThemeV2(localStorage.getItem('omnidev-theme') || 'midnight');

  // Theme cycle (replaces the 2-theme toggle)
  const tbtn = document.getElementById('btn-theme');
  if (tbtn) tbtn.onclick = () => {
    const cur = document.documentElement.dataset.theme || 'midnight';
    applyThemeV2(V2_THEMES[(V2_THEMES.indexOf(cur) + 1) % V2_THEMES.length]);
  };

  // Lazy-load pane data when its rail icon is clicked
  document.querySelectorAll('.rail-icon[data-pane]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.pane;
      if (id === 'pane-skills') refreshSkillsPane();
      else if (id === 'pane-tools') refreshToolsPane();
      else if (id === 'pane-history') refreshAuditPane();
    });
  });

  // Skills pane buttons
  document.getElementById('btn-new-skill')?.addEventListener('click', openNewSkillModal);
  document.getElementById('btn-open-skills-dir')?.addEventListener('click', () => ipcRenderer.invoke('open-plugins-dir'));
  document.getElementById('btn-reload-skills')?.addEventListener('click', async () => {
    await ipcRenderer.invoke('reload-plugins'); refreshSkillsPane(); showToast('Skills reloaded.');
  });

  // New skill modal
  const closeSkill = () => { document.getElementById('modal-new-skill').style.display = 'none'; };
  document.getElementById('btn-close-new-skill')?.addEventListener('click', closeSkill);
  document.getElementById('btn-cancel-new-skill')?.addEventListener('click', closeSkill);
  document.getElementById('btn-create-new-skill')?.addEventListener('click', async () => {
    const name = document.getElementById('skill-name').value.trim();
    const description = document.getElementById('skill-desc').value.trim();
    const category = document.getElementById('skill-category').value.trim() || 'Custom';
    const critical = document.getElementById('skill-critical').checked;
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) { showToast('Name: lowercase letters, digits, underscores only.'); return; }
    try {
      await ipcRenderer.invoke('scaffold-plugin', { name, description, category, critical });
      closeSkill();
      setTimeout(refreshSkillsPane, 600);
      showToast(`Skill "${name}" created — file opened in your editor.`);
    } catch (e) { showToast(e.message); }
  });

  // Tools search
  document.getElementById('tools-search')?.addEventListener('input', (e) => renderToolsList(e.target.value));

  // Audit buttons
  document.getElementById('btn-refresh-audit')?.addEventListener('click', refreshAuditPane);
  document.getElementById('btn-clear-audit')?.addEventListener('click', async () => {
    await ipcRenderer.invoke('clear-audit-log'); refreshAuditPane(); showToast('Audit log cleared.');
  });

  // Command palette keyboard + nav
  const bd = document.getElementById('cmd-palette');
  const input = document.getElementById('cmd-palette-input');
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    else if (e.key === 'Escape' && bd && bd.style.display === 'flex') { closePalette(); }
  });
  if (input) {
    input.addEventListener('input', (e) => renderPalette(e.target.value));
    input.addEventListener('keydown', (e) => {
      const box = document.getElementById('cmd-palette-results');
      const items = [...box.querySelectorAll('.cmd-item[data-i]')];
      if (e.key === 'ArrowDown') { e.preventDefault(); paletteActive = Math.min(paletteActive + 1, items.length - 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); paletteActive = Math.max(paletteActive - 1, 0); }
      else if (e.key === 'Enter') { e.preventDefault(); const r = box._rows?.[paletteActive]; closePalette(); if (r) r.run(); return; }
      else return;
      items.forEach((it, i) => it.classList.toggle('active', i === paletteActive));
      items[paletteActive]?.scrollIntoView({ block: 'nearest' });
    });
  }
  if (bd) bd.addEventListener('click', (e) => { if (e.target === bd) closePalette(); });

  // Live refresh: when a tool runs, keep audit fresh if that pane is open
  ipcRenderer.on('tool-executed', () => {
    if (document.getElementById('pane-history')?.classList.contains('active')) refreshAuditPane();
  });
  ipcRenderer.on('plugin-loaded', () => { if (document.getElementById('pane-skills')?.classList.contains('active')) refreshSkillsPane(); });
  ipcRenderer.on('plugin-unloaded', () => { if (document.getElementById('pane-skills')?.classList.contains('active')) refreshSkillsPane(); });
}

document.addEventListener('DOMContentLoaded', setupV2Features);

// ========================================================
// 13. Phase 2 — Live Preview, Database Browser, Checkpoints, Automation
// ========================================================
const wsKey = () => (state.activeProject && state.activeProject.path) || '';
let phase2ProjectKey = null;
function resetProjectTools() {
  dbDiscovery = null; dbDiscoveredFor = null;
  document.getElementById('db-tables').replaceChildren();
  document.getElementById('modal-db-results').style.display = 'none';
  for (const [id, value] of Object.entries({'db-mysql-host':'127.0.0.1','db-mysql-port':'3306','db-mysql-user':'root','db-mysql-pass':'','db-mysql-db':'','db-sqlite-file':'app.db'})) document.getElementById(id).value = value;
  refreshCheckpoints();
  if (paneActive('pane-db')) dbDiscover();
  if (paneActive('pane-preview')) openPreviewPane();
}
const paneActive = (id) => Boolean(document.getElementById(id)?.classList.contains('active'));

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (!isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

// ---------------------------------------------------------------
// Live Preview  (<webview>, so X-Frame-Options / CSP can't block it)
// ---------------------------------------------------------------
let previewAutoTimer = null;
let previewReady = false;     // webview fired dom-ready (its methods are only safe after that)
let previewFailed = false;
let previewDetected = [];
let previewProject = null;    // workspace the preview was last initialised for
let previewPrevWidth = null;

const previewEl = () => document.getElementById('preview-frame');
const previewKey = () => 'omnidev.preview.' + wsKey();

function normalizePreviewUrl(raw) {
  const url = (raw || '').trim();
  if (!url) return '';
  if (/^(file|about|https?):/i.test(url)) return url;
  if (/^[a-z]:[\\/]/i.test(url)) return 'file:///' + url.replace(/\\/g, '/');
  if (/^:\d+/.test(url)) return 'http://localhost' + url;
  return 'http://' + url;
}

function setPreviewStatus(text, kind) {
  const el = document.getElementById('preview-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'preview-status' + (kind ? ' ' + kind : '');
}

function showPreviewOverlay(title, text) {
  const o = document.getElementById('preview-overlay');
  if (!o) return;
  document.getElementById('po-title').textContent = title;
  document.getElementById('po-text').textContent = text || '';
  o.hidden = false;
}
function hidePreviewOverlay() {
  const o = document.getElementById('preview-overlay');
  if (o) o.hidden = true;
}

function updatePreviewNav() {
  const wv = previewEl();
  const back = document.getElementById('btn-preview-back');
  const fwd = document.getElementById('btn-preview-forward');
  if (!wv || !previewReady || !back || !fwd) return;
  try { back.disabled = !wv.canGoBack(); fwd.disabled = !wv.canGoForward(); } catch (_) {}
}

function loadPreview(rawUrl) {
  const input = document.getElementById('preview-url');
  const wv = previewEl();
  if (!input || !wv) return;
  const url = normalizePreviewUrl(typeof rawUrl === 'string' ? rawUrl : input.value);
  if (!url) { showPreviewOverlay('Nothing to preview yet', 'Type a URL above, or start your dev server and press the ◎ button to detect it.'); return; }
  input.value = url;
  try { localStorage.setItem(previewKey(), url); } catch (_) {}
  previewFailed = false;
  hidePreviewOverlay();
  setPreviewStatus('Loading…', 'busy');
  if (previewReady) { wv.loadURL(url).catch(() => {}); }   // failures are reported via did-fail-load
  else { wv.setAttribute('src', url); }
  renderPreviewChips();
}

function friendlyLoadError(code, desc, url) {
  let host = url;
  try { host = new URL(url).host || url; } catch (_) {}
  switch (code) {
    case -102: return [`Nothing is listening on ${host}`, 'The server is not running (connection refused). Start it — e.g. "npm run dev", or Apache in XAMPP — then press Retry.'];
    case -105: case -137: return [`Can't resolve ${host}`, 'The host name could not be found. Check the URL for typos.'];
    case -6:   return ['File not found', `${url} does not exist.`];
    case -7: case -118: return [`${host} took too long to respond`, 'The server accepted the connection but did not answer in time.'];
    case -324: return [`${host} sent an empty response`, 'The server closed the connection without data. It may still be starting up — try Retry in a moment.'];
    default:   return [`Couldn't load ${host}`, `${desc || 'Load failed'} (error ${code}).`];
  }
}

function setupPreviewWebview() {
  const wv = previewEl();
  if (!wv) return;
  const input = document.getElementById('preview-url');
  const syncUrl = (u) => { if (u && !/^about:/i.test(u) && input && document.activeElement !== input) { input.value = u; renderPreviewChips(); } };

  wv.addEventListener('dom-ready', () => { previewReady = true; updatePreviewNav(); });
  wv.addEventListener('did-start-loading', () => { previewFailed = false; setPreviewStatus('Loading…', 'busy'); });
  wv.addEventListener('did-stop-loading', () => {
    updatePreviewNav();
    if (!previewFailed) { const u = (() => { try { return wv.getURL(); } catch (_) { return ''; } })(); setPreviewStatus(u && !/^about:/i.test(u) ? 'Live' : '', 'ok'); }
  });
  wv.addEventListener('did-navigate', (e) => { syncUrl(e.url); updatePreviewNav(); });
  wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) syncUrl(e.url); updatePreviewNav(); });
  wv.addEventListener('did-fail-load', (e) => {
    if (!e.isMainFrame || e.errorCode === -3) return;       // -3 = aborted (redirect / superseded)
    previewFailed = true;
    setPreviewStatus('Unreachable', 'err');
    const [title, text] = friendlyLoadError(e.errorCode, e.errorDescription, e.validatedURL);
    showPreviewOverlay(title, text);
  });
  wv.addEventListener('did-finish-load', () => { if (!previewFailed) hidePreviewOverlay(); });
}

function previewChipLabel(c) {
  if (c.source === 'static') return c.label.replace('Static file: ', '📄 ');
  try {
    const u = new URL(c.url);
    const p = u.pathname !== '/' ? u.pathname.replace(/\/$/, '') : '';
    const s = u.host + p;
    return s.length > 28 ? s.slice(0, 27) + '…' : s;
  } catch (_) { return c.url; }
}

function renderPreviewChips() {
  const box = document.getElementById('preview-detected');
  if (!box) return;
  if (!previewDetected.length) {
    box.innerHTML = '<span class="pd-hint">No dev server detected. Start one (<code>npm run dev</code>, XAMPP Apache…) then press ◎ to rescan.</span>';
    return;
  }
  const cur = normalizePreviewUrl(document.getElementById('preview-url')?.value || '');
  box.innerHTML = previewDetected.map((c, i) =>
    `<button type="button" class="pd-chip ${c.alive ? 'alive' : 'dead'} ${c.url === cur ? 'current' : ''}" data-i="${i}" title="${escapeHtml(c.url)} · ${escapeHtml(c.label)}${c.alive ? '' : ' — not running'}"><span class="pd-dot"></span>${escapeHtml(previewChipLabel(c))}</button>`
  ).join('');
  box.querySelectorAll('.pd-chip').forEach(b => b.onclick = () => loadPreview(previewDetected[Number(b.dataset.i)].url));
}

async function detectPreviewServers() {
  const box = document.getElementById('preview-detected');
  if (box) box.innerHTML = '<span class="pd-hint">Scanning for running servers…</span>';
  try {
    const key = wsKey();
    const res = await ipcRenderer.invoke('preview-detect');
    if (key !== wsKey()) return null;
    previewDetected = res.candidates || [];
    renderPreviewChips();
    return res;
  } catch (e) {
    previewDetected = [];
    if (box) box.innerHTML = `<span class="pd-hint" style="color:var(--red)">${escapeHtml(e.message)}</span>`;
    return null;
  }
}

async function openPreviewPane() {
  const input = document.getElementById('preview-url');
  if (!input) return;
  const key = wsKey();
  const firstForProject = previewProject !== key;
  if (firstForProject) { previewProject = key; input.value = ''; previewDetected = []; const wv = previewEl(); if (previewReady) wv.loadURL('about:blank').catch(() => {}); else wv.setAttribute('src', 'about:blank'); }
  if (!key) { showPreviewOverlay('No workspace selected', 'Open a project to preview it.'); return; }
  const res = await detectPreviewServers();
  if (key !== wsKey()) return;
  if (!firstForProject && input.value) return;              // keep whatever the user is looking at
  let saved = '';
  try { saved = localStorage.getItem(previewKey()) || ''; } catch (_) {}
  const savedLive = saved && previewDetected.find(c => c.url === saved && c.alive);
  const pick = savedLive ? savedLive.url : ((res && res.recommended && res.recommended.url) || saved || '');
  if (pick) loadPreview(pick);
  else {
    input.value = 'http://localhost:3000';
    setPreviewStatus('', '');
    showPreviewOverlay('No running dev server found', 'Start your project (e.g. "npm run dev", or Apache in XAMPP) — it will be picked up automatically — or type a URL above.');
  }
}

function schedulePreviewReload() {
  if (!paneActive('pane-preview')) return;
  if (previewProject !== wsKey()) { openPreviewPane(); return; }          // project was switched
  if (!document.getElementById('preview-auto')?.checked || !previewReady) return;
  if (previewAutoTimer) clearTimeout(previewAutoTimer);
  previewAutoTimer = setTimeout(() => {
    const wv = previewEl();
    try {
      const u = wv.getURL();
      if (u && !/^about:/i.test(u)) { setPreviewStatus('Reloading…', 'busy'); wv.reload(); }
      else if (previewFailed) loadPreview();
    } catch (_) {}
  }, 500);
}

function setupPreviewControls() {
  document.getElementById('btn-preview-go')?.addEventListener('click', () => loadPreview());
  document.getElementById('preview-url')?.addEventListener('keydown', e => { if (e.key === 'Enter') loadPreview(); });
  document.getElementById('btn-preview-reload')?.addEventListener('click', () => {
    const wv = previewEl();
    try { const u = previewReady ? wv.getURL() : ''; if (u && !/^about:/i.test(u) && !previewFailed) wv.reloadIgnoringCache(); else loadPreview(); } catch (_) { loadPreview(); }
  });
  document.getElementById('btn-preview-back')?.addEventListener('click', () => { try { previewEl().goBack(); } catch (_) {} });
  document.getElementById('btn-preview-forward')?.addEventListener('click', () => { try { previewEl().goForward(); } catch (_) {} });
  document.getElementById('btn-preview-detect')?.addEventListener('click', async () => {
    const res = await detectPreviewServers();
    if (res && res.recommended && (previewFailed || !document.getElementById('preview-url').value)) loadPreview(res.recommended.url);
  });
  document.getElementById('btn-po-retry')?.addEventListener('click', () => loadPreview());
  document.getElementById('btn-po-detect')?.addEventListener('click', async () => {
    const res = await detectPreviewServers();
    if (res && res.recommended) loadPreview(res.recommended.url); else showToast('No running server found yet.');
  });
  document.getElementById('btn-preview-devtools')?.addEventListener('click', () => { try { previewEl().openDevTools(); } catch (_) { showToast('Load a page first.'); } });
  document.getElementById('btn-preview-external')?.addEventListener('click', () => {
    let u = ''; try { u = previewReady ? previewEl().getURL() : ''; } catch (_) {}
    if (!u || /^about:/i.test(u)) u = normalizePreviewUrl(document.getElementById('preview-url').value);
    if (u) shell.openExternal(u);
  });
  document.getElementById('btn-preview-expand')?.addEventListener('click', () => {
    const sp = document.getElementById('sidebar-panel');
    if (!sp) return;
    if (previewPrevWidth === null) { previewPrevWidth = sp.style.width || ''; sp.classList.add('preview-wide'); sp.style.width = Math.round(Math.min(760, window.innerWidth * 0.5)) + 'px'; }
    else { sp.style.width = previewPrevWidth; previewPrevWidth = null; sp.classList.remove('preview-wide'); }
    if (typeof cmEditor !== 'undefined' && cmEditor) setTimeout(() => cmEditor.refresh(), 30);
  });
}

// ---------------------------------------------------------------
// Database Browser  (auto-discovers the active project's databases)
// ---------------------------------------------------------------
let dbCurrent = { engine: 'sqlite', database_file: 'app.db' };
let dbDiscovery = null;
let dbDiscoveredFor = null;
let dbDiscoveredAt = 0;

function dbQuoteIdent(name, engine) {
  return engine === 'mysql' ? '`' + String(name).replace(/`/g, '``') + '`' : '"' + String(name).replace(/"/g, '""') + '"';
}
function dbPayload() {
  const engine = document.getElementById('db-engine').value;
  if (engine === 'mysql') {
    return {
      engine: 'mysql',
      database: document.getElementById('db-mysql-db').value.trim(),
      host: document.getElementById('db-mysql-host').value.trim() || '127.0.0.1',
      port: document.getElementById('db-mysql-port').value.trim() || '3306',
      user: document.getElementById('db-mysql-user').value.trim() || 'root',
      password: document.getElementById('db-mysql-pass').value
    };
  }
  return { engine: 'sqlite', database_file: document.getElementById('db-sqlite-file').value.trim() || 'app.db' };
}

function fillManualFromDiscovery(d) {
  if (!d) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined && v !== null) el.value = v; };
  const c = d.mysql && d.mysql.creds;
  if (c && d.mysql.configured) {
    set('db-mysql-host', c.host); set('db-mysql-port', c.port); set('db-mysql-user', c.user);
    set('db-mysql-pass', c.password); set('db-mysql-db', c.database);
  }
  if (d.sqlite && d.sqlite.length) set('db-sqlite-file', d.sqlite[0].path);
}

function dbNodeHtml(kind, key, label, meta, badge) {
  return `<div class="dbt-node" data-kind="${kind}" data-key="${escapeHtml(key)}">
    <div class="dbt-row"><span class="dbt-caret">▸</span><span class="dbt-ic">${kind === 'sqlite' ? '🗎' : '🗄'}</span><span class="dbt-label">${escapeHtml(label)}</span>${badge ? `<span class="dbt-badge">${badge}</span>` : ''}${meta ? `<span class="dbt-meta">${escapeHtml(meta)}</span>` : ''}</div>
    <div class="dbt-children" hidden></div></div>`;
}

function renderDbTree() {
  const box = document.getElementById('db-discovered');
  if (!box || !dbDiscovery) return;
  const { sqlite, mysql, project } = dbDiscovery;
  let h = `<div class="dbt-project" title="${escapeHtml(dbDiscovery.workspace)}">${escapeHtml(project)}</div>`;

  // --- SQLite
  h += `<div class="dbt-group"><div class="dbt-hdr"><span class="dbt-gcaret">▾</span><span class="dbt-gname">SQLite files</span><span class="grp-count">${sqlite.length}</span></div><div class="dbt-body">`;
  h += sqlite.length
    ? sqlite.map(f => dbNodeHtml('sqlite', f.path, f.path, fmtBytes(f.size))).join('')
    : '<div class="dbt-empty">No SQLite files found in this project.</div>';
  h += '</div></div>';

  // --- MySQL / MariaDB
  const projDb = mysql.projectDatabase;
  const user = mysql.databases.filter(d => !d.system).sort((a, b) => (Number(b.name === projDb) - Number(a.name === projDb)) || a.name.localeCompare(b.name));
  const sys = mysql.databases.filter(d => d.system);
  const c = mysql.creds;
  h += `<div class="dbt-group"><div class="dbt-hdr"><span class="dbt-gcaret">▾</span><span class="dbt-gname">MySQL / MariaDB</span><span class="dbt-pill ${mysql.reachable ? 'ok' : 'off'}">${mysql.reachable ? 'online' : 'offline'}</span><span class="grp-count">${user.length}</span></div><div class="dbt-body">`;
  h += `<div class="dbt-sub">${escapeHtml(c.host)}:${escapeHtml(c.port)} · ${escapeHtml(c.user)} · ${mysql.source ? 'from ' + escapeHtml(mysql.source) : 'default login'}</div>`;
  if (!mysql.reachable) {
    const msg = mysql.cliMissing
      ? 'The "mysql" command-line client was not found. For XAMPP add C:\\xampp\\mysql\\bin to PATH and restart OmniDev.'
      : (mysql.error || 'Could not connect.');
    h += `<div class="dbt-error">${escapeHtml(msg)}</div>`;
    if (!mysql.cliMissing) h += '<div class="dbt-sub">Is MySQL / MariaDB started? Wrong login? <a href="#" data-act="edit-conn">Edit connection</a></div>';
  } else {
    if (projDb && !mysql.databases.some(d => d.name === projDb)) {
      h += `<div class="dbt-warn">Project database <b>${escapeHtml(projDb)}</b> (from ${escapeHtml(mysql.source || 'config')}) doesn't exist on this server yet.</div>`;
    }
    h += user.length ? user.map(d => dbNodeHtml('mysql', d.name, d.name, '', d.name === projDb ? 'project' : '')).join('') : '<div class="dbt-empty">No user databases on this server.</div>';
    if (sys.length) {
      h += `<div class="dbt-sys-toggle">▸ System schemas (${sys.length})</div><div class="dbt-sys" hidden>${sys.map(d => dbNodeHtml('mysql', d.name, d.name, '')).join('')}</div>`;
    }
  }
  h += '</div></div>';
  box.innerHTML = h;
}

function dbTargetFor(node) {
  if (node.dataset.kind === 'sqlite') return { engine: 'sqlite', database_file: node.dataset.key };
  return { engine: 'mysql', ...dbDiscovery.mysql.creds, database: node.dataset.key };
}

async function dbToggleNode(node) {
  const kids = node.querySelector('.dbt-children');
  if (!kids.hidden) { kids.hidden = true; node.classList.remove('open'); return; }
  kids.hidden = false; node.classList.add('open');
  if (kids.dataset.loaded) return;
  kids.innerHTML = '<div class="dbt-empty">Loading tables…</div>';
  try {
    const target = dbTargetFor(node);
    const res = await ipcRenderer.invoke('db-inspect', target);
    let items = [];
    if (target.engine === 'mysql') items = (res.tables || []).map(n => ({ name: n, type: 'table' }));
    else if (res.exists === false) { kids.innerHTML = '<div class="dbt-empty">File is missing or empty.</div>'; return; }
    else items = (res.schema || []).filter(s => s.type === 'table' || s.type === 'view').map(s => ({ name: s.name, type: s.type }));
    kids.dataset.loaded = '1';
    kids.innerHTML = items.length
      ? items.map(t => `<div class="dbt-table" data-table="${escapeHtml(t.name)}"><span class="dbt-ic">${t.type === 'view' ? '◧' : '▦'}</span>${escapeHtml(t.name)}</div>`).join('')
      : '<div class="dbt-empty">No tables.</div>';
  } catch (e) {
    kids.innerHTML = `<div class="dbt-error">${escapeHtml(e.message)}</div>`;
  }
}

async function dbDiscover() {
  const box = document.getElementById('db-discovered');
  if (!box) return;
  if (!dbDiscovery || dbDiscoveredFor !== wsKey()) box.innerHTML = '<div class="empty-placeholder-sm">Scanning project for databases…</div>';
  try {
    const key = wsKey();
    if (!key) { box.textContent = 'Open a workspace to discover databases.'; return; }
    const result = await ipcRenderer.invoke('db-discover');
    if (key !== wsKey()) return;
    dbDiscovery = result;
    dbDiscoveredFor = key;
    dbDiscoveredAt = Date.now();
    renderDbTree();
    fillManualFromDiscovery(dbDiscovery);
  } catch (e) {
    box.innerHTML = `<div class="dbt-error">${escapeHtml(e.message)}</div>`;
  }
}

function dbOpenPane() {
  if (!dbDiscovery || dbDiscoveredFor !== wsKey() || Date.now() - dbDiscoveredAt > 20000) dbDiscover();
}

function setupDbTree() {
  const box = document.getElementById('db-discovered');
  if (!box) return;
  box.addEventListener('click', (e) => {
    const hdr = e.target.closest('.dbt-hdr');
    if (hdr) { hdr.parentElement.classList.toggle('collapsed'); return; }
    if (e.target.closest('[data-act="edit-conn"]')) {
      e.preventDefault();
      const d = document.getElementById('db-manual'); if (d) d.open = true;
      document.getElementById('db-engine').value = 'mysql'; document.getElementById('db-engine').onchange();
      return;
    }
    const tog = e.target.closest('.dbt-sys-toggle');
    if (tog) { const s = tog.nextElementSibling; s.hidden = !s.hidden; tog.textContent = (s.hidden ? '▸' : '▾') + tog.textContent.slice(1); return; }
    const tbl = e.target.closest('.dbt-table');
    if (tbl) { openDbResults(tbl.dataset.table, dbTargetFor(tbl.closest('.dbt-node'))); return; }
    const row = e.target.closest('.dbt-row');
    if (row) dbToggleNode(row.parentElement);
  });
}

// ---- manual connection (fallback / custom server)
async function dbLoadTables() {
  const box = document.getElementById('db-tables');
  const payload = dbPayload();
  box.innerHTML = '<div class="empty-placeholder-sm">Loading…</div>';
  try {
    const res = await ipcRenderer.invoke('db-inspect', payload);
    if (payload.engine === 'mysql' && !payload.database) {
      const dbs = res.databases || [];
      box.innerHTML = dbs.length
        ? dbs.map(d => `<div class="db-table-item" data-db="${escapeHtml(d)}"><i class="ti-ic">🗄</i>${escapeHtml(d)}</div>`).join('')
        : '<div class="empty-placeholder-sm">No databases on this server.</div>';
      box.querySelectorAll('[data-db]').forEach(el => el.onclick = () => { document.getElementById('db-mysql-db').value = el.dataset.db; dbLoadTables(); });
      return;
    }
    const tables = payload.engine === 'mysql'
      ? (res.tables || [])
      : (res.schema || []).filter(s => s.type === 'table' || s.type === 'view').map(s => s.name);
    if (!tables.length) { box.innerHTML = '<div class="empty-placeholder-sm">No tables found.</div>'; return; }
    box.innerHTML = tables.map(t => `<div class="db-table-item" data-table="${escapeHtml(t)}"><i class="ti-ic">▦</i>${escapeHtml(t)}</div>`).join('');
    box.querySelectorAll('.db-table-item').forEach(el => { el.onclick = () => openDbResults(el.dataset.table, payload); });
  } catch (e) { box.innerHTML = `<div class="empty-placeholder-sm" style="color:var(--red)">${escapeHtml(e.message)}</div>`; }
}

async function runDbQuery(sql) {
  return ipcRenderer.invoke('db-query', { ...dbCurrent, sql });
}

function renderDbResult(res) {
  const out = document.getElementById('db-results-table');
  const rows = (res && res.rows) || [];
  if (!rows.length) {
    out.innerHTML = `<div class="empty-placeholder-sm">${escapeHtml((res && res.message) || '0 rows.')}</div>`;
    return;
  }
  const cols = Object.keys(rows[0]);
  const note = rows.length > 200 ? `<div class="empty-placeholder-sm">Showing first 200 of ${rows.length} rows.</div>` : '';
  out.innerHTML = `<table class="db-grid"><thead><tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.slice(0, 200).map(r => `<tr>${cols.map(c => `<td>${escapeHtml(String(r[c] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table>${note}`;
}

async function openDbResults(table, target) {
  if (target) dbCurrent = target;
  const where = dbCurrent.engine === 'mysql' ? (dbCurrent.database || 'mysql') : (dbCurrent.database_file || 'sqlite');
  document.getElementById('db-results-title').textContent = `${where} › ${table}`;
  const sql = `SELECT * FROM ${dbQuoteIdent(table, dbCurrent.engine)} LIMIT 100`;
  document.getElementById('db-sql-input').value = sql;
  document.getElementById('modal-db-results').style.display = 'flex';
  document.getElementById('db-results-table').innerHTML = '<div class="empty-placeholder-sm">Loading…</div>';
  try { renderDbResult(await runDbQuery(sql)); }
  catch (e) { document.getElementById('db-results-table').innerHTML = `<div class="empty-placeholder-sm" style="color:var(--red)">${escapeHtml(e.message)}</div>`; }
}

// ---------------------------------------------------------------
// Checkpoints (sidebar panel)
// ---------------------------------------------------------------
let cpBusy = false;
async function refreshCheckpoints() {
  const box = document.getElementById('cp-list');
  if (!box) return;
  let items = [];
  const key = wsKey();
  try { items = key ? await ipcRenderer.invoke('checkpoints-list') : []; if (key !== wsKey()) return; }
  catch (e) { box.innerHTML = `<div class="empty-placeholder" style="color:var(--red)">${escapeHtml(e.message)}</div>`; return; }
  const badge = document.getElementById('cp-count-badge');
  if (badge) badge.textContent = items.length;
  const rail = document.getElementById('rail-cp-count'); if (rail) { rail.textContent = items.length; rail.hidden = !items.length; }
  document.getElementById('btn-cp-create').disabled = !key || cpBusy;
  if (!items.length) {
    box.innerHTML = '<div class="empty-placeholder">No checkpoints yet.<br>Create one before a risky change.</div>';
    return;
  }
  box.innerHTML = items.map(c => {
    const auto = /^auto-/i.test(c.label || '');
    return `<div class="cp-card ${auto ? 'auto' : ''}" data-id="${escapeHtml(c.id)}">
      <div class="cp-top"><span class="cp-dot"></span><span class="cp-label" title="${escapeHtml(c.label)}">${escapeHtml(c.label)}</span>${auto ? '<span class="cp-tag">auto</span>' : ''}</div>
      <div class="cp-meta">${escapeHtml(timeAgo(c.at))} · ${c.files} files${c.bytes ? ' · ' + fmtBytes(c.bytes) : ''}</div>
      <div class="cp-meta cp-date">${escapeHtml((c.at || '').slice(0, 19).replace('T', ' '))}</div>
      <div class="cp-actions">
        <button class="btn btn-xs btn-outline" data-act="restore">↺ Restore</button>
        <button class="btn btn-xs btn-danger-outline" data-act="delete">Delete</button>
      </div></div>`;
  }).join('');
  box.querySelectorAll('.cp-card').forEach(card => {
    const id = card.dataset.id;
    const label = card.querySelector('.cp-label').textContent;
    card.querySelector('[data-act="restore"]').onclick = async (ev) => {
      if (!confirm(`Restore workspace from "${label}"?\n\nFiles are overwritten with the snapshot (newer files are kept). A safety checkpoint of the current state is saved first.`)) return;
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Restoring…';
      try {
        await ipcRenderer.invoke('checkpoints-restore', id);
        showToast(`Restored "${label}".`);
        if (typeof loadFileTree === 'function') loadFileTree();
      } catch (e) { showToast(e.message); }
      refreshCheckpoints();
    };
    card.querySelector('[data-act="delete"]').onclick = async () => {
      if (!confirm(`Delete checkpoint "${label}"? This cannot be undone.`)) return;
      try { await ipcRenderer.invoke('checkpoints-delete', id); showToast('Checkpoint deleted.'); }
      catch (e) { showToast(e.message); }
      refreshCheckpoints();
    };
  });
}

async function createCheckpointFromUi() {
  if (cpBusy) return;
  const btn = document.getElementById('btn-cp-create');
  const input = document.getElementById('cp-label');
  cpBusy = true;
  const old = btn.textContent; btn.disabled = true; btn.textContent = 'Saving snapshot…';
  try {
    await ipcRenderer.invoke('checkpoints-create', input.value.trim());
    input.value = '';
    showToast('Checkpoint created.');
  } catch (e) { showToast(e.message); }
  cpBusy = false; btn.disabled = false; btn.textContent = old;
  refreshCheckpoints();
}

// ---------------------------------------------------------------
// Vault & triggers (Settings → Automation & Safety)
// ---------------------------------------------------------------
async function refreshVault() {
  const box = document.getElementById('vault-list'); if (!box) return;
  const items = await ipcRenderer.invoke('vault-list').catch(() => []);
  box.innerHTML = items.length ? items.map(s => `<div class="auto-item"><div class="ai-main"><div>🔑 ${escapeHtml(s.key)}</div><div class="ai-sub">updated ${escapeHtml((s.updated || '').slice(0, 19).replace('T', ' '))}</div></div><button class="ai-del" data-vk="${escapeHtml(s.key)}">✕</button></div>`).join('') : '<div class="form-hint">Vault is empty.</div>';
  box.querySelectorAll('[data-vk]').forEach(b => b.onclick = async () => { await ipcRenderer.invoke('vault-delete', b.dataset.vk); refreshVault(); });
}
async function refreshTriggers() {
  const box = document.getElementById('trg-list'); if (!box) return;
  const items = await ipcRenderer.invoke('triggers-list').catch(() => []);
  box.innerHTML = items.length ? items.map(t => `<div class="auto-item"><div class="ai-main"><div>${escapeHtml(t.name)} <span class="ai-sub">→ ${escapeHtml(t.tool)}</span></div><div class="ai-sub">${t.type === 'interval' ? 'every ' + t.intervalMinutes + ' min' : 'on file change'}</div></div><span class="toggle-switch ${t.enabled ? 'on' : ''}" data-tg="${t.id}"></span><button class="ai-del" data-tr="${t.id}">✕</button></div>`).join('') : '<div class="form-hint">No triggers yet.</div>';
  box.querySelectorAll('[data-tg]').forEach(s => s.onclick = async () => { await ipcRenderer.invoke('triggers-toggle', { id: s.dataset.tg }); refreshTriggers(); });
  box.querySelectorAll('[data-tr]').forEach(b => b.onclick = async () => { await ipcRenderer.invoke('triggers-remove', b.dataset.tr); refreshTriggers(); });
}

// ---------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------
function setupPhase2() {
  setupPreviewWebview();
  setupPreviewControls();
  setupDbTree();

  // Lazy-load each pane when its rail icon is clicked
  document.querySelectorAll('.rail-icon[data-pane]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.pane;
      if (id === 'pane-preview') openPreviewPane();
      else if (id === 'pane-db') dbOpenPane();
      else if (id === 'pane-checkpoints') refreshCheckpoints();
    });
  });

  // File changes: live-reload the preview; follow project switches in DB / checkpoint panes
  ipcRenderer.on('workspace-files-changed', () => {
    schedulePreviewReload();
    if (paneActive('pane-db') && dbDiscoveredFor !== wsKey()) dbDiscover();
    if (paneActive('pane-checkpoints')) refreshCheckpoints();
  });
  // The AI can create/restore checkpoints through MCP tools — keep the panel fresh
  ipcRenderer.on('tool-executed', () => { refreshCheckpoints(); });

  // DB browser
  const engineSel = document.getElementById('db-engine');
  if (engineSel) engineSel.onchange = () => {
    const my = engineSel.value === 'mysql';
    document.getElementById('db-mysql-fields').hidden = !my;
    document.getElementById('db-sqlite-fields').hidden = my;
  };
  document.getElementById('btn-db-load')?.addEventListener('click', dbLoadTables);
  document.getElementById('btn-db-connect')?.addEventListener('click', dbDiscover);
  document.getElementById('btn-close-db-results')?.addEventListener('click', () => { document.getElementById('modal-db-results').style.display = 'none'; });
  document.getElementById('btn-db-run-sql')?.addEventListener('click', async () => {
    const sql = document.getElementById('db-sql-input').value.trim(); if (!sql) return;
    document.getElementById('db-results-table').innerHTML = '<div class="empty-placeholder-sm">Running…</div>';
    try { renderDbResult(await runDbQuery(sql)); }
    catch (e) { document.getElementById('db-results-table').innerHTML = `<div class="empty-placeholder-sm" style="color:var(--red)">${escapeHtml(e.message)}</div>`; }
  });

  // Checkpoints panel
  document.getElementById('btn-cp-create')?.addEventListener('click', createCheckpointFromUi);
  document.getElementById('cp-label')?.addEventListener('keydown', e => { if (e.key === 'Enter') createCheckpointFromUi(); });
  document.getElementById('btn-cp-refresh')?.addEventListener('click', refreshCheckpoints);
  document.getElementById('btn-open-checkpoints-pane')?.addEventListener('click', () => {
    if (typeof modalSettings !== 'undefined' && modalSettings) modalSettings.style.display = 'none';
    activateRailPane('pane-checkpoints');
  });

  // Settings → Automation & Safety
  document.querySelector('[data-settings-section="automation"]')?.addEventListener('click', () => {
    refreshVault(); refreshTriggers();
  });
  document.getElementById('btn-vault-add')?.addEventListener('click', async () => {
    const key = document.getElementById('vault-key').value.trim(), value = document.getElementById('vault-val').value;
    if (!key || !value) { showToast('Key and value required.'); return; }
    await ipcRenderer.invoke('vault-set', { key, value });
    document.getElementById('vault-key').value = ''; document.getElementById('vault-val').value = '';
    refreshVault(); showToast(`Secret "${key}" saved (encrypted).`);
  });
  document.getElementById('btn-trg-add')?.addEventListener('click', async () => {
    const def = {
      name: document.getElementById('trg-name').value.trim(),
      type: document.getElementById('trg-type').value,
      tool: document.getElementById('trg-tool').value.trim(),
      intervalMinutes: Number(document.getElementById('trg-mins').value) || 10
    };
    if (!def.tool) { showToast('Tool name required.'); return; }
    try { await ipcRenderer.invoke('triggers-add', def); document.getElementById('trg-name').value = ''; document.getElementById('trg-tool').value = ''; refreshTriggers(); showToast('Trigger added.'); }
    catch (e) { showToast(e.message); }
  });

  ipcRenderer.on('trigger-fired', (e, info) => showToast(`⚡ Trigger "${info.name}" ran ${info.tool}`));
}

document.addEventListener('DOMContentLoaded', setupPhase2);
