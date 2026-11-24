const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

class PermissionsManager extends EventEmitter {
  constructor() {
    super();
    // Modes: 'auto' | 'smart' | 'manual'
    this.mode = 'smart';
    this.pendingApprovals = new Map();
    this.sessionApprovedTools = new Set();

    // Per-tool override matrix: { toolName: 'auto' | 'ask' | 'deny' }
    // Takes precedence over the global mode. Empty = follow the mode.
    this.toolPolicies = {};

    // Tools considered safe (read-only) for 'smart' mode
    this.safeTools = new Set([
      'read_file',
      'list_directory',
      'search_code',
      'get_file_info',
      'get_project_context',
      'git_status',
      'git_diff',
      'git_log',
      'get_system_info',
      'get_job_status',
      'list_jobs',
      'get_job_output',
      'sqlite_schema',
      'check_port',
      'list_processes',
      'list_backups',
      'mysql_schema',
      'mysql_databases',
      'list_checkpoints',
      'vault_list',
      'codebase_map',
      'list_ui_templates',
      'docker_ps'
    ]);
  }

  setMode(mode) {
    if (['auto', 'smart', 'manual'].includes(mode)) {
      this.mode = mode;
      this.emit('modeChanged', this.mode);
    }
  }

  getMode() {
    return this.mode;
  }

  setToolPolicies(policies = {}) {
    const clean = {};
    for (const [tool, policy] of Object.entries(policies || {})) {
      if (['auto', 'ask', 'deny'].includes(policy)) clean[tool] = policy;
    }
    this.toolPolicies = clean;
    this.emit('policiesChanged', this.toolPolicies);
  }

  getToolPolicies() {
    return { ...this.toolPolicies };
  }

  clearSessionApprovals() {
    this.sessionApprovedTools.clear();
  }

  approveAllForTool(toolName) {
    this.sessionApprovedTools.add(toolName);
  }

  /**
   * Checks if an action needs approval.
   * If yes, puts it into pendingApprovals queue and waits for user decision via Electron UI.
   */
  async requestApproval({ tool, params, description, isCritical = false }) {
    // 0. Per-tool override matrix wins over everything else.
    const policy = this.toolPolicies[tool];
    if (policy === 'deny') {
      return { approved: false, reason: `Tool "${tool}" is blocked by your permission matrix (set to Deny).` };
    }
    if (policy === 'auto') {
      return { approved: true, auto: true, policy: 'auto' };
    }
    // policy === 'ask' falls through to the manual-approval path below.

    // 1. Auto mode: Always approve (unless the tool was explicitly set to 'ask')
    if (this.mode === 'auto' && policy !== 'ask') {
      return { approved: true, auto: true };
    }

    // 2. Session whitelist check
    if (this.sessionApprovedTools.has(tool) && policy !== 'ask') {
      return { approved: true, auto: true, sessionWhitelisted: true };
    }

    // 3. Smart mode: safe read-only tools auto-approved
    if (this.mode === 'smart' && this.safeTools.has(tool) && !isCritical && policy !== 'ask') {
      return { approved: true, auto: true, smartMode: true };
    }

    // 4. Manual approval required: create pending request
    const approvalId = `apr-${uuidv4().slice(0, 8)}`;
    const request = {
      id: approvalId,
      tool,
      params,
      description: description || `AI is attempting to call tool "${tool}"`,
      timestamp: Date.now()
    };

    return new Promise((resolve) => {
      // Setup timeout (default 5 minutes)
      const timer = setTimeout(() => {
        if (this.pendingApprovals.has(approvalId)) {
          this.pendingApprovals.delete(approvalId);
          this.emit('approvalExpired', request);
          resolve({ approved: false, reason: 'Approval timed out after 5 minutes.' });
        }
      }, 5 * 60 * 1000);

      this.pendingApprovals.set(approvalId, {
        request,
        resolve: (result) => {
          clearTimeout(timer);
          this.pendingApprovals.delete(approvalId);
          resolve(result);
        }
      });

      // Notify Electron renderer UI & trigger sound alert
      this.emit('approvalRequested', request);
    });
  }

  /**
   * User approves the pending request from UI
   */
  approve(approvalId, approveAllForSession = false) {
    const item = this.pendingApprovals.get(approvalId);
    if (!item) return false;

    if (approveAllForSession) {
      this.sessionApprovedTools.add(item.request.tool);
    }

    item.resolve({ approved: true, userApproved: true });
    this.emit('approvalResolved', { id: approvalId, approved: true });
    return true;
  }

  /**
   * User denies the pending request from UI
   */
  deny(approvalId, feedbackMessage = null) {
    const item = this.pendingApprovals.get(approvalId);
    if (!item) return false;

    const reason = feedbackMessage || 'Action was denied by the user.';
    item.resolve({ approved: false, reason });
    this.emit('approvalResolved', { id: approvalId, approved: false, reason });
    return true;
  }

  getPending() {
    return Array.from(this.pendingApprovals.values()).map(v => v.request);
  }
}

module.exports = new PermissionsManager();
