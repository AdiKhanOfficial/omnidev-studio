/**
 * OmniDev Studio — Docker tools (async, non-blocking).
 * Thin wrappers over the docker CLI for inspecting and controlling containers.
 */

const { exec } = require('child_process');
const workspaceManager = require('../workspace');

function run(cmd, { timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    exec(cmd, { cwd: workspaceManager.getWorkspace(), timeout, encoding: 'utf8', maxBuffer: 24 * 1024 * 1024, windowsHide: true },
      (e, stdout, stderr) => {
        if (e && /not recognized|command not found|ENOENT/i.test(stderr || e.message)) {
          return resolve({ ok: false, notInstalled: true, out: 'Docker CLI not found on PATH. Install Docker Desktop and retry.' });
        }
        resolve({ ok: !e, out: ((stdout || '') + (stderr || (e ? e.message : ''))).trim() });
      });
  });
}

module.exports = {
  docker_ps: async ({ all = false } = {}) => {
    const r = await run(`docker ps ${all ? '-a ' : ''}--format "{{.ID}}|{{.Image}}|{{.Names}}|{{.Status}}|{{.Ports}}"`);
    if (r.notInstalled) throw new Error(r.out);
    const containers = r.out ? r.out.split(/\r?\n/).filter(Boolean).map(l => {
      const [id, image, name, status, ports] = l.split('|');
      return { id, image, name, status, ports };
    }) : [];
    return { count: containers.length, containers };
  },

  docker_logs: async ({ container, tail = 200 }) => {
    if (!container) throw new Error('container (name or id) is required.');
    const r = await run(`docker logs --tail ${Number(tail) || 200} ${container}`);
    if (r.notInstalled) throw new Error(r.out);
    return { container, logs: r.out.slice(-20000) };
  },

  docker_compose: async ({ action = 'ps', service = '', detached = true } = {}) => {
    const allowed = ['up', 'down', 'ps', 'logs', 'restart', 'build', 'stop', 'start'];
    if (!allowed.includes(action)) throw new Error(`action must be one of: ${allowed.join(', ')}.`);
    let cmd = `docker compose ${action}`;
    if (action === 'up') cmd += detached ? ' -d' : '';
    if (service) cmd += ' ' + service;
    const r = await run(cmd, { timeout: 600000 });
    if (r.notInstalled) throw new Error(r.out);
    workspaceManager.notifyChanged();
    return { action, command: cmd, success: r.ok, output: r.out.slice(-20000) };
  }
};
