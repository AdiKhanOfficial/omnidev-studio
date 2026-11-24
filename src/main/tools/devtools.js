/**
 * OmniDev Studio — Developer Workflow Tools
 *
 * Test runner, linter, formatter, package manager and codebase mapper.
 * Everything runs async (never blocks the UI), in the active workspace, with
 * a timeout and a bounded output buffer.
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const workspaceManager = require('../workspace');

function run(cmd, { timeout = 300000 } = {}) {
  const cwd = workspaceManager.getWorkspace();
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout, encoding: 'utf8', maxBuffer: 48 * 1024 * 1024, windowsHide: true, killSignal: 'SIGKILL' },
      (e, stdout, stderr) => {
        resolve({
          ok: !e,
          code: e ? (e.code ?? 1) : 0,
          timedOut: Boolean(e && (e.killed || e.signal)),
          stdout: (stdout || '').toString(),
          stderr: (stderr || (e && e.message) || '').toString()
        });
      });
  });
}

function wsFile(name) {
  return fs.existsSync(path.join(workspaceManager.getWorkspace(), name));
}
function readJson(name) {
  try { return JSON.parse(fs.readFileSync(path.join(workspaceManager.getWorkspace(), name), 'utf8')); } catch { return null; }
}

function detectStack() {
  const stack = [];
  if (wsFile('package.json')) stack.push('node');
  if (wsFile('composer.json')) stack.push('php');
  if (wsFile('requirements.txt') || wsFile('pyproject.toml') || wsFile('manage.py')) stack.push('python');
  if (wsFile('go.mod')) stack.push('go');
  if (wsFile('Cargo.toml')) stack.push('rust');
  if (wsFile('pom.xml') || wsFile('build.gradle')) stack.push('java');
  return stack;
}

module.exports = {
  run_tests: async ({ framework = 'auto', extra_args = '' } = {}) => {
    let cmd = null;
    const pkg = readJson('package.json');
    if (framework === 'auto') {
      if (pkg && pkg.scripts && pkg.scripts.test) cmd = 'npm test --silent';
      else if (wsFile('jest.config.js') || (pkg && pkg.devDependencies && pkg.devDependencies.jest)) cmd = 'npx jest';
      else if (wsFile('vitest.config.js') || wsFile('vitest.config.ts')) cmd = 'npx vitest run';
      else if (wsFile('pytest.ini') || wsFile('pyproject.toml') || wsFile('requirements.txt')) cmd = 'pytest -q';
      else if (wsFile('phpunit.xml') || wsFile('phpunit.xml.dist')) cmd = 'vendor/bin/phpunit';
      else if (wsFile('go.mod')) cmd = 'go test ./...';
      else throw new Error('Could not detect a test framework. Pass framework: jest|vitest|pytest|phpunit|go|npm.');
    } else {
      cmd = { jest: 'npx jest', vitest: 'npx vitest run', pytest: 'pytest -q', phpunit: 'vendor/bin/phpunit', go: 'go test ./...', npm: 'npm test --silent' }[framework];
      if (!cmd) throw new Error(`Unknown framework "${framework}".`);
    }
    if (extra_args) cmd += ' ' + extra_args;

    const r = await run(cmd, { timeout: 600000 });
    const out = (r.stdout + '\n' + r.stderr);
    const passed = /pass|ok|✓|PASS/i.test(out) && r.ok;
    return {
      command: cmd,
      passed: r.ok,
      exit_code: r.code,
      timed_out: r.timedOut,
      summary: r.ok ? 'Tests passed.' : 'Tests failed or errored — see output.',
      output: out.slice(-20000)
    };
  },

  lint_code: async ({ fix = false, target = '.' } = {}) => {
    let cmd = null;
    if (wsFile('package.json')) cmd = `npx eslint ${target}${fix ? ' --fix' : ''}`;
    else if (detectStack().includes('python')) cmd = `flake8 ${target}`;
    else if (wsFile('composer.json')) cmd = `vendor/bin/phpcs ${target}`;
    else throw new Error('No linter detected (eslint/flake8/phpcs). Install one or pass a custom command via run_command.');
    const r = await run(cmd);
    return { command: cmd, clean: r.ok, issues_found: !r.ok, output: (r.stdout + '\n' + r.stderr).slice(-20000) };
  },

  format_code: async ({ target = '.' } = {}) => {
    let cmd = null;
    if (wsFile('package.json')) cmd = `npx prettier --write "${target}"`;
    else if (detectStack().includes('python')) cmd = `black ${target}`;
    else if (wsFile('composer.json')) cmd = `vendor/bin/php-cs-fixer fix ${target}`;
    else throw new Error('No formatter detected (prettier/black/php-cs-fixer).');
    const r = await run(cmd);
    workspaceManager.notifyChanged();
    return { command: cmd, success: r.ok, output: (r.stdout + '\n' + r.stderr).slice(-15000) };
  },

  package_manager: async ({ manager = 'auto', action, packages = [], dev = false } = {}) => {
    if (!action) throw new Error('action is required: install | add | remove | list | update.');
    let mgr = manager;
    if (mgr === 'auto') {
      if (wsFile('pnpm-lock.yaml')) mgr = 'pnpm';
      else if (wsFile('yarn.lock')) mgr = 'yarn';
      else if (wsFile('package.json')) mgr = 'npm';
      else if (wsFile('composer.json')) mgr = 'composer';
      else if (detectStack().includes('python')) mgr = 'pip';
      else throw new Error('Could not detect a package manager. Pass manager: npm|yarn|pnpm|pip|composer.');
    }
    const pkgs = Array.isArray(packages) ? packages.join(' ') : String(packages || '');
    const table = {
      npm: { install: 'npm install', add: `npm install ${dev ? '--save-dev ' : ''}${pkgs}`, remove: `npm uninstall ${pkgs}`, list: 'npm ls --depth=0', update: 'npm update' },
      yarn: { install: 'yarn install', add: `yarn add ${dev ? '--dev ' : ''}${pkgs}`, remove: `yarn remove ${pkgs}`, list: 'yarn list --depth=0', update: 'yarn upgrade' },
      pnpm: { install: 'pnpm install', add: `pnpm add ${dev ? '--save-dev ' : ''}${pkgs}`, remove: `pnpm remove ${pkgs}`, list: 'pnpm ls --depth 0', update: 'pnpm update' },
      pip: { install: 'pip install -r requirements.txt', add: `pip install ${pkgs}`, remove: `pip uninstall -y ${pkgs}`, list: 'pip list', update: `pip install -U ${pkgs}` },
      composer: { install: 'composer install', add: `composer require ${dev ? '--dev ' : ''}${pkgs}`, remove: `composer remove ${pkgs}`, list: 'composer show', update: 'composer update' }
    };
    const cmd = table[mgr] && table[mgr][action];
    if (!cmd) throw new Error(`Action "${action}" not supported for ${mgr}.`);
    const r = await run(cmd, { timeout: 600000 });
    workspaceManager.notifyChanged();
    return { manager: mgr, command: cmd, success: r.ok, exit_code: r.code, output: (r.stdout + '\n' + r.stderr).slice(-20000) };
  },

  codebase_map: async () => {
    const root = workspaceManager.getWorkspace();
    const stack = detectStack();
    const pkg = readJson('package.json');
    const IGNORE = new Set(['node_modules', '.git', '.venv', 'venv', 'dist', 'build', 'vendor', '.next', 'coverage', '.omnidev', '__pycache__']);
    const byExt = {};
    const keyFiles = [];
    const KEY = ['package.json', 'composer.json', 'requirements.txt', 'pyproject.toml', 'go.mod', 'Cargo.toml',
      'Dockerfile', 'docker-compose.yml', '.env.example', 'README.md', 'tsconfig.json', 'vite.config.js',
      'webpack.config.js', 'next.config.js', 'manage.py', 'index.php', 'artisan'];
    for (const k of KEY) if (wsFile(k)) keyFiles.push(k);

    let fileCount = 0;
    const walk = (dir, depth) => {
      if (depth > 4 || fileCount > 15000) return;
      let items; try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const it of items) {
        if (IGNORE.has(it.name)) continue;
        if (it.isDirectory()) walk(path.join(dir, it.name), depth + 1);
        else { fileCount++; const e = (path.extname(it.name) || '(none)').toLowerCase(); byExt[e] = (byExt[e] || 0) + 1; }
      }
    };
    walk(root, 0);
    const topExt = Object.entries(byExt).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([ext, n]) => ({ ext, files: n }));

    // Top-level directories
    let dirs = [];
    try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && !IGNORE.has(d.name)).map(d => d.name); } catch {}

    return {
      workspace: root,
      stack: stack.length ? stack : ['unknown'],
      total_files: fileCount,
      top_level_dirs: dirs,
      key_files: keyFiles,
      file_types: topExt,
      npm_scripts: pkg && pkg.scripts ? Object.keys(pkg.scripts) : [],
      dependencies: pkg ? Object.keys(pkg.dependencies || {}).slice(0, 40) : [],
      hint: 'Use this map to understand the project before editing. Entry points are usually in the key_files above.'
    };
  }
};
