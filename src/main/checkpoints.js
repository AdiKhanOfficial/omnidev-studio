/**
 * OmniDev Studio — Workspace Checkpoints
 *
 * A checkpoint is a full snapshot of the workspace source (minus heavy/vendor
 * dirs) saved under .omnidev/checkpoints/<id>/. Lets the agent (or user) take a
 * safe restore point before a risky batch of changes and roll the whole
 * workspace back with one call. Universal — no git required.
 */

const fs = require('fs');
const path = require('path');
const workspaceManager = require('./workspace');

const IGNORE = new Set(['node_modules', '.git', '.venv', 'venv', 'dist', 'build', 'out', 'vendor', '.next', '.nuxt', 'coverage', '.cache', '.omnidev', '__pycache__']);
const MAX_TOTAL_BYTES = 200 * 1024 * 1024; // refuse to snapshot very large workspaces
const MAX_CHECKPOINTS = 20;

function root() { return workspaceManager.getWorkspace(); }
function cpDir() { return path.join(root(), '.omnidev', 'checkpoints'); }
function indexFile() { return path.join(cpDir(), 'index.json'); }

function loadIndex() {
  try { return JSON.parse(fs.readFileSync(indexFile(), 'utf8')); } catch { return []; }
}
function saveIndex(idx) {
  fs.mkdirSync(cpDir(), { recursive: true });
  fs.writeFileSync(indexFile(), JSON.stringify(idx, null, 2), 'utf8');
}

function measure(dir) {
  let total = 0, files = 0;
  const walk = (d) => {
    let items; try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (IGNORE.has(it.name)) continue;
      const full = path.join(d, it.name);
      if (it.isDirectory()) walk(full);
      else { try { total += fs.statSync(full).size; files++; } catch {} }
      if (total > MAX_TOTAL_BYTES) return;
    }
  };
  walk(dir);
  return { total, files };
}

function copyTree(src, dest) {
  // Copy each top-level entry individually so the checkpoint folder (which
  // lives under .omnidev inside the workspace) is never copied into itself.
  fs.mkdirSync(dest, { recursive: true });
  let items;
  try { items = fs.readdirSync(src, { withFileTypes: true }); } catch { return; }
  for (const it of items) {
    if (IGNORE.has(it.name)) continue;
    fs.cpSync(path.join(src, it.name), path.join(dest, it.name), { recursive: true });
  }
}

function create(label = '') {
  const base = root();
  const { total, files } = measure(base);
  if (total > MAX_TOTAL_BYTES) {
    throw new Error(`Workspace source is too large to checkpoint (> ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)} MB after excluding vendor dirs).`);
  }
  const id = `cp-${Date.now().toString(36)}`;
  const dest = path.join(cpDir(), id);
  copyTree(base, dest);

  const idx = loadIndex();
  idx.push({ id, label: label || 'Checkpoint', at: new Date().toISOString(), files, bytes: total });

  // Prune oldest
  while (idx.length > MAX_CHECKPOINTS) {
    const old = idx.shift();
    try { fs.rmSync(path.join(cpDir(), old.id), { recursive: true, force: true }); } catch {}
  }
  saveIndex(idx);
  return { id, label: label || 'Checkpoint', files, size_mb: Math.round(total / 1024 / 1024 * 10) / 10 };
}

function list() {
  return loadIndex().slice().reverse();
}

function restore(id) {
  const entry = loadIndex().find(e => e.id === id);
  if (!entry) throw new Error(`Checkpoint not found: ${id}`);
  const src = path.join(cpDir(), id);
  if (!fs.existsSync(src)) throw new Error('Checkpoint data is missing on disk.');

  // Auto-snapshot current state first so a restore is itself reversible
  let safety = null;
  try { safety = create('auto-before-restore').id; } catch {}

  // Overwrite workspace files from the checkpoint (does not delete newer files)
  const filter = (s) => !IGNORE.has(path.basename(s));
  fs.cpSync(src, root(), { recursive: true, force: true, filter });
  workspaceManager.notifyChanged();
  return { restored: id, label: entry.label, safety_checkpoint: safety };
}

function remove(id) {
  const idx = loadIndex();
  const entry = idx.find(e => e.id === id);
  if (!entry) throw new Error(`Checkpoint not found: ${id}`);
  try { fs.rmSync(path.join(cpDir(), id), { recursive: true, force: true }); } catch {}
  saveIndex(idx.filter(e => e.id !== id));
  return { deleted: id, label: entry.label };
}

module.exports = { create, list, restore, remove };
