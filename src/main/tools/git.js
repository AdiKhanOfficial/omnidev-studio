const { exec } = require('child_process');
const workspaceManager = require('../workspace');

function execGit(cmd) {
  return new Promise((resolve, reject) => {
    exec(`git ${cmd}`, { cwd: workspaceManager.getWorkspace() }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr || stdout || err.message));
      }
      resolve(stdout.trim());
    });
  });
}

module.exports = {
  git_status: async () => {
    try {
      const branch = await execGit('branch --show-current').catch(() => 'detached');
      const statusRaw = await execGit('status --porcelain');
      const lines = statusRaw ? statusRaw.split('\n') : [];

      const staged = [];
      const unstaged = [];
      const untracked = [];

      lines.forEach(line => {
        if (!line) return;
        const indexStatus = line[0];
        const worktreeStatus = line[1];
        const file = line.slice(3).trim();

        if (indexStatus === '?' && worktreeStatus === '?') {
          untracked.push(file);
        } else {
          if (indexStatus !== ' ' && indexStatus !== '?') staged.push({ file, status: indexStatus });
          if (worktreeStatus !== ' ' && worktreeStatus !== '?') unstaged.push({ file, status: worktreeStatus });
        }
      });

      return {
        is_git_repo: true,
        branch,
        staged,
        unstaged,
        untracked,
        total_changes: lines.length
      };
    } catch (err) {
      return {
        is_git_repo: false,
        message: `Not a git repository or git is not installed: ${err.message}`
      };
    }
  },

  git_diff: async ({ staged = false, file = null } = {}) => {
    try {
      let cmd = 'diff';
      if (staged) cmd += ' --staged';
      if (file) cmd += ` -- "${file}"`;
      const diff = await execGit(cmd);
      return {
        diff: diff || '(No differences found)'
      };
    } catch (err) {
      throw new Error(`Git diff failed: ${err.message}`);
    }
  },

  git_log: async ({ max_count = 10 } = {}) => {
    try {
      const count = Number(max_count) || 10;
      const log = await execGit(`log -n ${count} --pretty=format:"%h|%an|%ad|%s" --date=short`);
      const commits = log ? log.split('\n').map(l => {
        const [hash, author, date, message] = l.split('|');
        return { hash, author, date, message };
      }) : [];

      return {
        total: commits.length,
        commits
      };
    } catch (err) {
      throw new Error(`Git log failed: ${err.message}`);
    }
  },

  git_commit: async ({ message, add_all = true }) => {
    if (!message || !message.trim()) {
      throw new Error('Commit message is required');
    }

    try {
      if (add_all) {
        await execGit('add -A');
      }
      const escaped = message.replace(/"/g, '\\"');
      const output = await execGit(`commit -m "${escaped}"`);
      return {
        success: true,
        message: output
      };
    } catch (err) {
      throw new Error(`Git commit failed: ${err.message}`);
    }
  },

  git_branch: async ({ name = null, create = false } = {}) => {
    try {
      if (name) {
        if (create) {
          await execGit(`checkout -b "${name}"`);
          return { success: true, message: `Created and switched to branch "${name}"` };
        } else {
          await execGit(`checkout "${name}"`);
          return { success: true, message: `Switched to branch "${name}"` };
        }
      } else {
        const branches = await execGit('branch');
        return {
          branches: branches.split('\n').map(b => b.trim())
        };
      }
    } catch (err) {
      throw new Error(`Git branch operation failed: ${err.message}`);
    }
  }
};
