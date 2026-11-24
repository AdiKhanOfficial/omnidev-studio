const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const runFile = promisify(execFile);
const commandNames = {
  codex: ['codex'],
  claude: ['claude'],
  antigravity: ['antigravity', 'agy']
};
const clientLabels = { codex: 'Codex', claude: 'Claude Code', antigravity: 'Antigravity' };

async function requireInstalledClient(client, { home = os.homedir(), env = process.env, platform = process.platform } = {}) {
  if (!Object.hasOwn(commandNames, client)) throw new Error('Unknown MCP client.');
  const windows = platform === 'win32';
  const search = (env.PATH || env.Path || '').split(windows ? ';' : ':').map(dir => dir.trim().replace(/^"|"$/g, ''));
  search.push(path.join(home, '.local', 'bin'), path.join(home, 'bin'));
  const candidates = [];
  if (windows) {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    search.push(path.join(local, 'Microsoft', 'WindowsApps'), path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm'));
    if (client === 'antigravity') search.push(path.join(local, 'agy', 'bin'));
    const programs = [path.join(local, 'Programs'), env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean);
    if (client === 'antigravity') {
      for (const directory of programs) {
        for (const name of ['Antigravity', 'Antigravity IDE']) candidates.push(path.join(directory, name, name + '.exe'));
      }
    }
    if (client === 'codex') {
      for (const directory of programs) candidates.push(path.join(directory, 'Codex', 'Codex.exe'));
    }
  } else if (platform === 'darwin' && client !== 'claude') {
    for (const directory of ['/Applications', path.join(home, 'Applications')]) {
      for (const name of client === 'codex' ? ['Codex'] : ['Antigravity', 'Antigravity IDE']) {
        candidates.push(path.join(directory, name + '.app', 'Contents', 'MacOS', name));
      }
    }
  }
  for (const directory of search.filter(dir => path.isAbsolute(dir))) {
    for (const command of commandNames[client]) {
      for (const suffix of windows ? ['.exe', '.cmd', '.bat'] : ['']) {
        candidates.push(path.join(directory, command + suffix));
      }
    }
  }
  for (const file of candidates) {
    try {
      if (!fs.statSync(file).isFile()) continue;
      if (!windows) fs.accessSync(file, fs.constants.X_OK);
      return;
    } catch {}
  }
  if (windows && client === 'codex' && env.SystemRoot) {
    try {
      const powershell = path.join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const { stdout } = await runFile(powershell, ['-NoProfile', '-NonInteractive', '-Command',
        '(Get-AppxPackage -Name OpenAI.Codex -ErrorAction Stop).Name'], { timeout: 6000, windowsHide: true });
      if (stdout.trim().split(/\r?\n/).includes('OpenAI.Codex')) return;
    } catch {}
  }
  throw new Error(`${clientLabels[client]} installation was not detected. If you installed it in a custom location, add its CLI to PATH and restart OmniDev Studio.`);
}

const serverName = 'omnidev_studio';
const begin = '# BEGIN OmniDev Studio MCP';
const end = '# END OmniDev Studio MCP';
const managedBlock = /^# BEGIN OmniDev Studio MCP\r?\n\[mcp_servers\.omnidev_studio\]\r?\n(?:enabled = (?:true|false)\r?\n)?url = "[^"\r\n]*"\r?\n# END OmniDev Studio MCP(?=\r?\n|$)/m;

function configureClient(client, url, home = os.homedir(), env = process.env) {
  const gemini = path.join(home, '.gemini');
  const currentAntigravity = path.join(gemini, 'config', 'mcp_config.json');
  const legacyAntigravity = path.join(gemini, 'antigravity', 'mcp_config.json');
  const targets = {
    codex: path.join(env.CODEX_HOME || path.join(home, '.codex'), 'config.toml'),
    claude: path.join(env.CLAUDE_CONFIG_DIR || home, '.claude.json'),
    antigravity: !fs.existsSync(currentAntigravity) && fs.existsSync(legacyAntigravity)
      ? legacyAntigravity : currentAntigravity
  };
  if (!Object.hasOwn(targets, client)) throw new Error('Unknown MCP client.');
  const target = targets[client];
  let contents = '';
  let exists = false;
  try {
    contents = fs.readFileSync(target, 'utf8');
    exists = true;
    if (!contents.trim() && client !== 'codex') throw new Error('Client configuration is empty. Check it before retrying.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  let next;
  if (client === 'codex') {
    const block = `${begin}\n[mcp_servers.${serverName}]\nenabled = true\nurl = ${JSON.stringify(url)}\n${end}`.replace(/\n/g, contents.includes('\r\n') ? '\r\n' : '\n');
    const existing = managedBlock.exec(contents);
    if (existing) {
      next = contents.replace(managedBlock, () => block);
    } else {
      if (contents.includes(serverName) || contents.includes(begin) || contents.includes(end)
        || /^\s*["']?mcp_servers["']?\s*=/m.test(contents)) {
        throw new Error('An existing OmniDev entry needs to be updated manually in config.toml.');
      }
      const newline = contents.includes('\r\n') ? '\r\n' : '\n';
      next = contents ? `${contents}${contents.endsWith('\n') ? newline : newline.repeat(2)}${block}${newline}` : `${block}${newline}`;
    }
  } else {
    const config = contents ? JSON.parse(contents.replace(/^\uFEFF/, '')) : {};
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Expected a JSON configuration object.');
    const servers = config.mcpServers ?? {};
    if (typeof servers !== 'object' || Array.isArray(servers)) throw new Error('Expected mcpServers to be a JSON object.');
    const previous = servers[serverName];
    const field = client === 'claude' ? 'url' : 'serverUrl';
    if (Object.hasOwn(servers, serverName)
      && (typeof previous?.[field] !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+\/mcp\//.test(previous[field]))) {
      throw new Error('An existing OmniDev entry needs to be updated manually in the client configuration.');
    }
    const entry = { ...previous, [field]: url };
    if (client === 'claude') entry.type = 'http';
    if (previous?.[field] === url && (client !== 'claude' || previous.type === 'http')) return { path: target, changed: false };
    next = JSON.stringify({ ...config, mcpServers: { ...servers, [serverName]: entry } }, null, 2) + '\n';
  }

  if (next === contents) return { path: target, changed: false };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.omnidev-${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, next, { flag: 'wx', mode: 0o600 });
    if (fs.existsSync(target) !== exists || (exists && fs.readFileSync(target, 'utf8') !== contents)) {
      throw new Error('The client configuration changed while OmniDev was updating it. Try again.');
    }
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return { path: target, changed: true };
}

function getSkillsDirectory(client, home = os.homedir(), env = process.env) {
  const directories = {
    codex: path.join(home, '.agents', 'skills'),
    claude: path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'skills'),
    antigravity: path.join(home, '.gemini', 'config', 'skills')
  };
  if (!Object.hasOwn(directories, client)) throw new Error('Unknown skills client.');
  return directories[client];
}

module.exports = { configureClient, getSkillsDirectory, requireInstalledClient };
