/**
 * OmniDev Studio — Project discovery
 *
 * Finds the things that belong to the ACTIVE workspace so the UI doesn't make
 * the user type them in:
 *   - detectPreview():      running dev servers / static entry points for Live Preview
 *   - discoverDatabases():  SQLite files + MySQL/MariaDB databases for the DB Browser
 */
'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const { pathToFileURL } = require('url');
const workspaceManager = require('./workspace');
const projectsManager = require('./projects');
const settingsManager = require('./settings');
const mysqlTools = require('./tools/mysql');

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'vendor', 'venv', '__pycache__',
  'coverage', 'target', 'bin', 'obj', 'cache'
]);
const SQLITE_EXT = /\.(db|sqlite|sqlite3|db3|s3db)$/i;
const MYSQL_SYSTEM = new Set(['information_schema', 'mysql', 'performance_schema', 'sys', 'phpmyadmin', 'test']);

// ---------------------------------------------------------------- helpers

function readText(file, max = 200 * 1024) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > max) return '';
    return fs.readFileSync(file, 'utf8');
  } catch { return ''; }
}

/** Walk the workspace (skipping vendor/hidden dirs). Hidden *files* like .env are still visited. */
function walk(root, maxDepth, onFile) {
  let seen = 0;
  const rec = (dir, depth) => {
    if (depth > maxDepth || seen > 6000) return;
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const full = path.join(dir, it.name);
      if (it.isDirectory()) {
        if (!SKIP_DIRS.has(it.name) && !it.name.startsWith('.')) rec(full, depth + 1);
      } else if (it.isFile()) {
        seen++;
        onFile(full, it.name);
      }
    }
  };
  rec(root, 0);
}

function isSqliteFile(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return buf.toString('latin1').startsWith('SQLite format 3');
  } catch { return false; }
}

function probePort(port, timeout = 350) {
  const tryHost = (host) => new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeout);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
  // Dev servers bind to IPv4 *or* IPv6 loopback depending on the tool/version
  return Promise.all([tryHost('127.0.0.1'), tryHost('::1')]).then(r => r.some(Boolean));
}

function activeContext() {
  const root = workspaceManager.getWorkspace();
  const proj = projectsManager.getActive();
  return { root, proj, notes: (proj && proj.notes) || '' };
}

// ------------------------------------------------------------ live preview

const FRAMEWORK_PORTS = [
  ['vite', 5173], ['@sveltejs/kit', 5173], ['astro', 4321], ['@angular/cli', 4200],
  ['react-scripts', 3000], ['next', 3000], ['nuxt', 3000], ['express', 3000],
  ['parcel', 1234], ['webpack-dev-server', 8080], ['@vue/cli-service', 8080],
  ['live-server', 8080], ['http-server', 8080], ['browser-sync', 3000]
];
const COMMON_PORTS = [3000, 3001, 4200, 4321, 5000, 5173, 5174, 8000, 8080, 8081, 8888, 4173, 80];

async function detectPreview() {
  const { root, notes } = activeContext();
  const ownPort = Number(settingsManager.get().serverPort) || 0;
  const cands = new Map(); // `${port}|${pathname}` -> candidate

  const add = (url, label, source) => {
    let u;
    try { u = new URL(/^https?:\/\//i.test(url) ? url : 'http://' + url); } catch { return; }
    if (!/^https?:$/.test(u.protocol)) return;
    const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
    if (port === ownPort) return; // never offer OmniDev's own MCP server
    const key = `${port}|${u.pathname}`;
    if (!cands.has(key)) cands.set(key, { url: u.href, label, source, port, alive: false });
  };

  // 1) URLs written in project notes / env files
  const sources = [notes, readText(path.join(root, '.env')), readText(path.join(root, '.env.local'))];
  for (const text of sources) {
    const re = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?[^\s"'<>)\]]*/gi;
    for (const m of text.matchAll(re)) add(m[0].replace(/[.,;]+$/, '').replace('0.0.0.0', 'localhost'), 'Project notes', 'notes');
  }

  // 2) package.json — explicit --port flags, then framework defaults
  const pkgText = readText(path.join(root, 'package.json'));
  if (pkgText) {
    let pkg = {};
    try { pkg = JSON.parse(pkgText); } catch {}
    const scripts = Object.values(pkg.scripts || {}).join(' \n ');
    for (const m of scripts.matchAll(/(?:--port[= ]|-p |PORT=)\s*(\d{2,5})/g)) add(`http://localhost:${m[1]}`, 'package.json script', 'package');
    const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
    for (const [dep, port] of FRAMEWORK_PORTS) {
      if (deps.includes(dep)) add(`http://localhost:${port}`, `${dep} default`, 'package');
    }
  }
  for (const f of ['vite.config.js', 'vite.config.ts', 'vite.config.mjs']) {
    const t = readText(path.join(root, f));
    const m = t.match(/port\s*:\s*(\d{2,5})/);
    if (m) add(`http://localhost:${m[1]}`, 'vite.config', 'package');
  }

  // 3) XAMPP / WAMP style: C:\xampp\htdocs\<project> is served at http://localhost/<project>/
  const web = root.match(/[\\/](?:htdocs|www)[\\/](.+)$/i);
  if (web) add(`http://localhost/${web[1].split(/[\\/]/).map(encodeURIComponent).join('/')}/`, 'Apache (XAMPP/WAMP)', 'apache');

  // 4) Probe everything in parallel, plus common dev ports
  const ports = new Set([...cands.values()].map(c => c.port));
  COMMON_PORTS.forEach(p => { if (p !== ownPort) ports.add(p); });
  const aliveMap = {};
  await Promise.all([...ports].map(async p => { aliveMap[p] = await probePort(p); }));
  cands.forEach(c => { c.alive = Boolean(aliveMap[c.port]); });

  // Alive common ports that nothing above explained
  for (const p of COMMON_PORTS) {
    if (aliveMap[p] && ![...cands.values()].some(c => c.port === p)) {
      add(`http://localhost:${p}/`, `localhost:${p}`, 'port-scan');
      const c = [...cands.values()].find(x => x.port === p); if (c) c.alive = true;
    }
  }

  // 5) Static entry points (opened with file://, no server needed)
  const statics = [];
  for (const rel of ['index.html', 'public/index.html', 'dist/index.html', 'build/index.html']) {
    const full = path.join(root, rel);
    if (fs.existsSync(full)) statics.push({ url: pathToFileURL(full).href, label: `Static file: ${rel}`, source: 'static', port: 0, alive: true });
  }

  const rank = { notes: 0, package: 1, apache: 2, 'port-scan': 3 };
  const servers = [...cands.values()].sort((a, b) =>
    (Number(b.alive) - Number(a.alive)) || ((rank[a.source] ?? 9) - (rank[b.source] ?? 9)));
  const all = [...servers, ...statics];
  const recommended = all.find(c => c.alive && c.source !== 'static' && c.source !== 'port-scan') || statics[0] || null;
  return { workspace: root, candidates: all, recommended };
}

// ---------------------------------------------------------------- databases

function pick(text, keys) {
  const re = new RegExp('(?:^|[^A-Za-z0-9_])(?:' + keys.join('|') + ')[\'"]?\\s*(?:=>|=|:|,)\\s*[\'"]?([^\'"\\s;,)#]*)', 'im');
  const m = text.match(re);
  if (!m) return undefined;
  if (/[$(\[]/.test(m[1])) return undefined; // unresolved variable / function call
  return m[1];
}

const KEYS = {
  host: ['DB_HOST', 'DATABASE_HOST', 'MYSQL_HOST', 'DB_SERVER', 'DB_HOSTNAME', 'servername', '\\$db_host', '\\$dbhost'],
  port: ['DB_PORT', 'MYSQL_PORT', 'DATABASE_PORT'],
  database: ['DB_NAME', 'DB_DATABASE', 'DATABASE_NAME', 'MYSQL_DATABASE', 'MYSQL_DB', 'dbname', '\\$db_name', '\\$dbname'],
  user: ['DB_USER', 'DB_USERNAME', 'DATABASE_USER', 'MYSQL_USER', 'dbuser', '\\$db_user', '\\$dbuser'],
  password: ['DB_PASS', 'DB_PASSWORD', 'DATABASE_PASSWORD', 'MYSQL_PASSWORD', 'MYSQL_PWD', 'DB_PWD', 'dbpass', 'dbpassword', '\\$db_pass', '\\$dbpass']
};
// Only trusted in files/notes that are clearly about a database (too generic for .env)
const LOOSE_KEYS = {
  host: ['\\$host', 'hostname', 'host'],
  database: ['\\$database', 'database name', 'database', 'db name', 'db'],
  user: ['\\$username', '\\$user', 'username', 'user', 'mysql user', 'db user'],
  password: ['\\$password', '\\$pass', 'password', 'pass', 'pwd', 'mysql password', 'db password']
};

function extractMysql(text, loose) {
  const out = {};
  const fill = (k, v) => { if (out[k] === undefined && v !== undefined && v !== null) out[k] = v; };
  let m;
  if ((m = text.match(/mysql2?:\/\/([^:@\/\s]+)(?::([^@\/\s]*))?@([^:\/\s]+)(?::(\d+))?\/([\w$-]+)/i))) {
    fill('user', m[1]); fill('password', m[2] || ''); fill('host', m[3]); if (m[4]) fill('port', m[4]); fill('database', m[5]);
  }
  if ((m = text.match(/(?:new\s+mysqli|mysqli_connect)\s*\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]+)['"]/i))) {
    fill('host', m[1]); fill('user', m[2]); fill('password', m[3]); fill('database', m[4]);
  }
  if ((m = text.match(/mysql:host=([^;'"]+)(?:;port=(\d+))?;dbname=([\w$-]+)/i))) {
    fill('host', m[1]); if (m[2]) fill('port', m[2]); fill('database', m[3]);
  }
  for (const k of Object.keys(KEYS)) fill(k, pick(text, KEYS[k]));
  if (loose) for (const k of Object.keys(LOOSE_KEYS)) fill(k, pick(text, LOOSE_KEYS[k]));
  if (out.database === '') delete out.database;
  if (out.database && !/^[\w$.-]+$/.test(out.database)) delete out.database;
  return out;
}

function findMysqlConfig(root, notes) {
  const files = [];
  walk(root, 3, (full, name) => {
    if (/^\.env(\..+)?$/i.test(name) && !/\.(example|sample|template|test)$/i.test(name)) files.push({ full, name, rank: name === '.env' ? 0 : name === '.env.local' ? -1 : 1, loose: false });
    else if (/^(wp-config|config|database|db|dbconfig|db_connect|connect|conn|connection|settings|knexfile|ormconfig)\.(php|js|ts|json|py|ya?ml)$/i.test(name))
      files.push({ full, name, rank: 2, loose: !/\.(js|ts|py)$/i.test(name) });
  });
  files.sort((a, b) => a.rank - b.rank);

  const merged = {};
  let source = null;
  const merge = (found, from) => {
    for (const [k, v] of Object.entries(found)) {
      if (merged[k] === undefined) { merged[k] = v; if (k === 'database' && !source) source = from; }
    }
  };
  for (const f of files.slice(0, 15)) merge(extractMysql(readText(f.full), f.loose), path.relative(root, f.full));
  if (notes) merge(extractMysql(notes, true), 'Project notes');
  return { found: merged, source };
}

async function discoverDatabases() {
  const { root, proj, notes } = activeContext();

  // ---- SQLite files that live inside the project
  const sqlite = [];
  walk(root, 4, (full, name) => {
    if (!SQLITE_EXT.test(name) || !isSqliteFile(full)) return;
    let st; try { st = fs.statSync(full); } catch { return; }
    sqlite.push({
      path: path.relative(root, full).split(path.sep).join('/'),
      name, size: st.size, modified: st.mtime.toISOString()
    });
  });
  sqlite.sort((a, b) => a.path.localeCompare(b.path));

  // ---- MySQL / MariaDB: credentials from project config, then ask the server what exists
  const { found, source } = findMysqlConfig(root, notes);
  const creds = {
    host: found.host || '127.0.0.1',
    port: String(found.port || '3306'),
    user: found.user || 'root',
    password: found.password || '',
    database: found.database || ''
  };
  if (creds.host === 'localhost') creds.host = '127.0.0.1';
  const configured = Boolean(found.database || found.user || found.host);

  const mysql = { configured, source, creds, databases: [], projectDatabase: creds.database || null, error: null };
  try {
    const res = await mysqlTools.mysql_databases(creds);
    mysql.databases = (res.databases || []).map(name => ({ name, system: MYSQL_SYSTEM.has(name.toLowerCase()) }));
    mysql.reachable = true;
  } catch (e) {
    mysql.reachable = false;
    mysql.error = e.message;
    mysql.cliMissing = /not found on PATH/i.test(e.message);
  }

  return { workspace: root, project: proj ? proj.name : path.basename(root), sqlite, mysql };
}

module.exports = { detectPreview, discoverDatabases };
