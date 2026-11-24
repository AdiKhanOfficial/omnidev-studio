const os = require('os');
const net = require('net');
const fs = require('fs');
const { execFile } = require('child_process');
const workspaceManager = require('../workspace');
const projectsManager = require('../projects');

function execFileAsync(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 16, ...opts }, (err, stdout, stderr) => {
      resolve({ err, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

module.exports = {
  get_project_context: async () => {
    const activeProject = projectsManager.getActive();
    const workspaceInfo = workspaceManager.getInfo();
    const hasNotes = Boolean(activeProject?.notes && activeProject.notes.trim() && !activeProject.notes.toLowerCase().includes('no custom notes provided'));

    return {
      project_name: activeProject?.name || 'Default Project',
      project_path: workspaceManager.getWorkspace(),
      description: activeProject?.description || '',
      developer_notes: hasNotes ? activeProject.notes : 'No custom notes provided for this project yet.',
      project_type: activeProject?.type || 'General',
      context_status: hasNotes ? 'configured' : 'not_set',
      tip: hasNotes
        ? 'Project context is configured. You can update or expand it anytime using "update_project_context" if you discover new details.'
        : 'Project context is NOT set yet. Please inspect the codebase, config files (e.g. package.json, composer.json, .env, README, database settings) and call "update_project_context" to document the tech stack, server URLs, database info, and key architectural points for future sessions.',
      workspace_meta: workspaceInfo
    };
  },

  update_project_context: async ({ notes, project_type, append = false }) => {
    const activeProject = projectsManager.getActive();
    if (!activeProject) {
      throw new Error('No active project found in workspace.');
    }

    if (!notes || typeof notes !== 'string' || !notes.trim()) {
      throw new Error('Developer notes string is required to update project context.');
    }

    let finalNotes = notes.trim();
    if (append && activeProject.notes && activeProject.notes.trim()) {
      finalNotes = activeProject.notes.trim() + '\n\n' + finalNotes;
    }

    const updates = { notes: finalNotes };
    if (project_type && typeof project_type === 'string' && project_type.trim()) {
      updates.type = project_type.trim();
    }

    const updated = projectsManager.update(activeProject.id, updates);

    return {
      success: true,
      project_id: updated.id,
      project_name: updated.name,
      project_type: updated.type,
      developer_notes: updated.notes,
      message: 'Project context and developer notes have been successfully updated and saved for future sessions.'
    };
  },

  get_system_info: async () => {
    const workspaceInfo = workspaceManager.getInfo();
    const activeProject = projectsManager.getActive();

    return {
      active_project: {
        name: activeProject?.name || 'Default Project',
        notes: activeProject?.notes || ''
      },
      os: {
        platform: os.platform(),
        release: os.release(),
        type: os.type(),
        arch: os.arch(),
        hostname: os.hostname()
      },
      hardware: {
        cpus: os.cpus().length,
        cpu_model: os.cpus()[0]?.model || 'Unknown',
        total_memory_mb: Math.round(os.totalmem() / 1024 / 1024),
        free_memory_mb: Math.round(os.freemem() / 1024 / 1024)
      },
      node_version: process.version,
      workspace: workspaceInfo
    };
  },

  check_port: async ({ port, host = '127.0.0.1' }) => {
    const p = Number(port);
    if (!p || p < 1 || p > 65535) {
      throw new Error(`Invalid port number: ${port}`);
    }

    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          resolve({ port: p, host, in_use: true, status: 'Port is currently in use (server is listening).' });
        } else {
          resolve({ port: p, host, in_use: false, error: err.message });
        }
      });
      server.once('listening', () => {
        server.close(() => {
          resolve({ port: p, host, in_use: false, status: 'Port is free and available.' });
        });
      });
      server.listen(p, host);
    });
  },

  fetch_http: async ({ url, method = 'GET', headers = {}, body = null, timeout_ms = 10000 }) => {
    if (!url) throw new Error('URL is required');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout_ms);

    try {
      const opts = {
        method: method.toUpperCase(),
        headers,
        signal: controller.signal
      };

      if (body && ['POST', 'PUT', 'PATCH'].includes(opts.method)) {
        opts.body = typeof body === 'object' ? JSON.stringify(body) : String(body);
        if (!opts.headers['Content-Type']) {
          opts.headers['Content-Type'] = typeof body === 'object' ? 'application/json' : 'text/plain';
        }
      }

      const res = await fetch(url, opts);
      clearTimeout(timer);

      const contentType = res.headers.get('content-type') || '';
      let responseBody;
      if (contentType.includes('application/json')) {
        responseBody = await res.json().catch(() => res.text());
      } else {
        responseBody = await res.text();
      }

      const resHeaders = {};
      res.headers.forEach((v, k) => { resHeaders[k] = v; });

      return {
        status: res.status,
        status_text: res.statusText,
        ok: res.ok,
        headers: resHeaders,
        data: responseBody
      };
    } catch (err) {
      clearTimeout(timer);
      throw new Error(`HTTP Request failed: ${err.message}`);
    }
  },

  list_processes: async ({ filter = '', limit = 50 } = {}) => {
    const isWin = process.platform === 'win32';
    let rows = [];
    if (isWin) {
      const { stdout } = await execFileAsync('tasklist', ['/FO', 'CSV', '/NH']);
      rows = stdout.split(/\r?\n/).filter(Boolean).map(line => {
        const cols = line.split('","').map(c => c.replace(/^"|"$/g, ''));
        return { name: cols[0], pid: Number(cols[1]), memory: cols[4] };
      });
    } else {
      const { stdout } = await execFileAsync('ps', ['-eo', 'pid,comm,%cpu,%mem', '--sort=-%cpu']);
      rows = stdout.split(/\r?\n/).slice(1).filter(Boolean).map(line => {
        const m = line.trim().split(/\s+/);
        return { pid: Number(m[0]), name: m[1], cpu: m[2], memory: m[3] };
      });
    }
    if (filter) {
      const f = filter.toLowerCase();
      rows = rows.filter(r => (r.name || '').toLowerCase().includes(f) || String(r.pid) === filter);
    }
    return { total: rows.length, processes: rows.slice(0, Number(limit) || 50) };
  },

  kill_process: async ({ pid, name, force = true }) => {
    const isWin = process.platform === 'win32';
    if (!pid && !name) throw new Error('Provide a "pid" or process "name" to kill.');
    let res;
    if (isWin) {
      const args = ['/F'].filter(() => force);
      if (pid) res = await execFileAsync('taskkill', [...(force ? ['/F'] : []), '/PID', String(pid)]);
      else res = await execFileAsync('taskkill', [...(force ? ['/F'] : []), '/IM', name, '/T']);
    } else {
      if (pid) res = await execFileAsync('kill', [force ? '-9' : '-15', String(pid)]);
      else res = await execFileAsync('pkill', [force ? '-9' : '-15', name]);
    }
    if (res.err && !res.stdout) throw new Error(res.stderr || res.err.message);
    return { success: true, target: pid || name, output: (res.stdout || res.stderr || '').trim() };
  },

  read_env: async ({ file = '.env', reveal = false } = {}) => {
    const full = workspaceManager.resolvePath(file);
    if (!fs.existsSync(full)) throw new Error(`Env file not found: ${file}`);
    const content = fs.readFileSync(full, 'utf8');
    const vars = {};
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      const secret = /pass|secret|token|key|pwd|credential|private/i.test(key);
      vars[key] = (secret && !reveal) ? `***hidden (${val.length} chars)***` : val;
    }
    return {
      file,
      count: Object.keys(vars).length,
      revealed: Boolean(reveal),
      variables: vars,
      note: reveal ? 'Secret values revealed as requested.' : 'Secret-looking values are hidden. Pass reveal:true to show them.'
    };
  },

  notify_user: async ({ title = 'OmniDev Agent', message }) => {
    if (!message) throw new Error('A "message" is required.');
    try {
      const { Notification } = require('electron');
      if (Notification && Notification.isSupported()) {
        new Notification({ title, body: message }).show();
      }
    } catch (_) { /* running headless / standalone */ }
    return { success: true, delivered: true, title, message };
  }
};
