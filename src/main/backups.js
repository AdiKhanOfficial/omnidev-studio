/**
 * OmniDev Studio — File Safety Net / Checkpoints
 *
 * Before a destructive file operation (overwrite, surgical edit, delete) the
 * current file contents are copied into .omnidev/backups/ so the user can
 * recover or roll back. Keeps a bounded history per file.
 */

const fs = require('fs');
const path = require('path');

const BACKUP_DIR = () => path.join(process.cwd(), '.omnidev', 'backups');
const INDEX_FILE = () => path.join(BACKUP_DIR(), 'index.json');
const MAX_PER_FILE = 10;
const MAX_FILE_BYTES = 8 * 1024 * 1024; // don't back up huge binaries

function ensureDir() {
  const dir = BACKUP_DIR();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadIndex() {
  try {
    return JSON.parse(fs.readFileSync(INDEX_FILE(), 'utf8'));
  } catch {
    return [];
  }
}

function saveIndex(idx) {
  try {
    fs.writeFileSync(INDEX_FILE(), JSON.stringify(idx, null, 2), 'utf8');
  } catch (_) {}
}

/**
 * Snapshot a file before it is mutated. No-op if the file doesn't exist,
 * is a directory, or is too large.
 * @param {string} absPath absolute path to the file being changed
 * @param {string} relPath workspace-relative label (for display)
 * @param {string} action 'overwrite' | 'edit' | 'delete'
 */
function snapshot(absPath, relPath, action = 'edit') {
  try {
    if (!fs.existsSync(absPath)) return null;
    const stat = fs.statSync(absPath);
    if (stat.isDirectory() || stat.size > MAX_FILE_BYTES) return null;

    ensureDir();
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const storedName = id + '__' + path.basename(absPath);
    const storedPath = path.join(BACKUP_DIR(), storedName);
    fs.copyFileSync(absPath, storedPath);

    const idx = loadIndex();
    idx.push({
      id,
      file: relPath || absPath,
      absPath,
      stored: storedName,
      action,
      size: stat.size,
      at: new Date().toISOString()
    });

    // Prune old backups for the same file
    const sameFile = idx.filter(e => e.absPath === absPath);
    if (sameFile.length > MAX_PER_FILE) {
      const toRemove = sameFile.slice(0, sameFile.length - MAX_PER_FILE);
      for (const e of toRemove) {
        try { fs.unlinkSync(path.join(BACKUP_DIR(), e.stored)); } catch (_) {}
        const i = idx.indexOf(e);
        if (i >= 0) idx.splice(i, 1);
      }
    }

    saveIndex(idx);
    return id;
  } catch {
    return null;
  }
}

function list(limit = 100) {
  const idx = loadIndex();
  return idx.slice(-limit).reverse();
}

/**
 * Restore a backup by id back to its original path.
 */
function restore(id) {
  const idx = loadIndex();
  const entry = idx.find(e => e.id === id);
  if (!entry) throw new Error(`Backup not found: ${id}`);
  const storedPath = path.join(BACKUP_DIR(), entry.stored);
  if (!fs.existsSync(storedPath)) throw new Error('Backup file is missing on disk.');

  // Snapshot the current state first so restore itself is reversible
  snapshot(entry.absPath, entry.file, 'pre-restore');
  const dir = path.dirname(entry.absPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(storedPath, entry.absPath);
  return { restored: entry.file, id };
}

module.exports = { snapshot, list, restore };
