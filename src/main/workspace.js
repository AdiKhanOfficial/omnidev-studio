const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

class WorkspaceManager extends EventEmitter {
  constructor(initialDir = null) {
    super();
    this.currentDir = initialDir || process.cwd();
    this.allowEscape = false; // By default, jail tools to workspace
    this.watcher = null;
    this._debounceTimer = null;
    this.startWatcher();
  }

  getWorkspace() {
    return this.currentDir;
  }

  setWorkspace(newDir) {
    if (!fs.existsSync(newDir)) {
      fs.mkdirSync(newDir, { recursive: true });
    }
    const stat = fs.statSync(newDir);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${newDir}`);
    }
    this.currentDir = path.resolve(newDir);
    this.startWatcher();
    this.notifyChanged();
    return this.currentDir;
  }

  startWatcher() {
    if (this.watcher) {
      try { this.watcher.close(); } catch (_) {}
      this.watcher = null;
    }
    if (!fs.existsSync(this.currentDir)) return;

    try {
      this.watcher = fs.watch(this.currentDir, { recursive: true }, (eventType, filename) => {
        // Filter out noisy temporary/hidden files and git directory
        if (filename) {
          const fn = filename.toString();
          if (fn.includes('.git') || fn.includes('node_modules') || fn.includes('.omnidev') || fn.endsWith('.tmp') || fn.endsWith('~')) {
            return;
          }
        }
        this.notifyChanged();
      });
    } catch (err) {
      console.warn('[Workspace] Watcher notice (fallback polling):', err.message);
    }
  }

  notifyChanged() {
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this.emit('fs-changed', { dir: this.currentDir });
    }, 600);
  }

  setAllowEscape(allowed) {
    this.allowEscape = Boolean(allowed);
  }

  /**
   * Resolves a target path relative to current workspace.
   * If allowEscape is false, prevents directory traversal outside workspace.
   */
  resolvePath(targetPath) {
    if (!targetPath) return this.currentDir;

    let resolved;
    if (path.isAbsolute(targetPath)) {
      resolved = path.resolve(targetPath);
    } else {
      resolved = path.resolve(this.currentDir, targetPath);
    }

    if (!this.allowEscape) {
      const relative = path.relative(this.currentDir, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(
          `Access Denied: Path "${targetPath}" resolves outside active workspace (${this.currentDir}). Enable "Allow external paths" in settings if needed.`
        );
      }
    }

    return resolved;
  }

  /**
   * Returns workspace metadata: files count, project type, git presence, etc.
   */
  getInfo() {
    const exists = fs.existsSync(this.currentDir);
    if (!exists) {
      return { path: this.currentDir, exists: false };
    }

    const hasGit = fs.existsSync(path.join(this.currentDir, '.git'));
    const hasPackageJson = fs.existsSync(path.join(this.currentDir, 'package.json'));
    const hasPython = fs.existsSync(path.join(this.currentDir, 'requirements.txt')) || 
                      fs.existsSync(path.join(this.currentDir, 'pyproject.toml'));
    const hasVenv = fs.existsSync(path.join(this.currentDir, 'venv')) || 
                    fs.existsSync(path.join(this.currentDir, '.venv'));

    let filesCount = 0;
    try {
      const items = fs.readdirSync(this.currentDir);
      filesCount = items.length;
    } catch {
      filesCount = 0;
    }

    return {
      path: this.currentDir,
      name: path.basename(this.currentDir),
      exists: true,
      hasGit,
      hasPackageJson,
      hasPython,
      hasVenv,
      itemsCount: filesCount,
      allowEscape: this.allowEscape
    };
  }
}

module.exports = new WorkspaceManager();
