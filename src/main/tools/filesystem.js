const fs = require('fs');
const path = require('path');
const workspaceManager = require('../workspace');
const backups = require('../backups');

// Directories that are skipped by search/listing to keep scans fast and
// prevent the main process from blocking on huge dependency trees.
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', 'dist', 'build', 'out',
  'vendor', '.next', '.nuxt', 'coverage', '.cache', '.omnidev', '__pycache__'
]);

module.exports = {
  read_file: async ({ path: filePath, start_line = 1, end_line = null }) => {
    const fullPath = workspaceManager.resolvePath(filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      throw new Error(`Path is a directory, not a file: ${filePath}`);
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split(/\r?\n/);
    const totalLines = lines.length;

    const start = Math.max(1, parseInt(start_line, 10));
    const end = end_line ? Math.min(totalLines, parseInt(end_line, 10)) : totalLines;

    const selectedLines = lines.slice(start - 1, end);
    const formatted = selectedLines
      .map((line, idx) => `${start + idx}: ${line}`)
      .join('\n');

    return {
      path: filePath,
      total_lines: totalLines,
      start_line: start,
      end_line: end,
      content: formatted
    };
  },

  write_file: async ({ path: filePath, content, overwrite = true }) => {
    const fullPath = workspaceManager.resolvePath(filePath);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(fullPath) && !overwrite) {
      throw new Error(`File already exists and overwrite is false: ${filePath}`);
    }

    // Safety net: snapshot the existing file before overwriting it
    const existed = fs.existsSync(fullPath);
    if (existed) backups.snapshot(fullPath, filePath, 'overwrite');

    fs.writeFileSync(fullPath, content, 'utf8');
    workspaceManager.notifyChanged();
    const lines = content.split(/\r?\n/).length;

    return {
      success: true,
      path: filePath,
      lines_written: lines,
      bytes: Buffer.byteLength(content, 'utf8'),
      backed_up: existed,
      message: `File written successfully.`
    };
  },

  edit_file_replace: async ({ path: filePath, target, replacement }) => {
    const fullPath = workspaceManager.resolvePath(filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    if (!content.includes(target)) {
      throw new Error(`Target string not found in file: ${filePath}`);
    }

    const occurrences = content.split(target).length - 1;
    const updated = content.replaceAll(target, replacement);

    backups.snapshot(fullPath, filePath, 'edit');
    fs.writeFileSync(fullPath, updated, 'utf8');
    workspaceManager.notifyChanged();

    return {
      success: true,
      path: filePath,
      replacements_made: occurrences,
      backed_up: true,
      message: `Replaced ${occurrences} occurrence(s) in ${filePath}.`
    };
  },

  edit_file_multi: async ({ path: filePath, edits = [] }) => {
    const fullPath = workspaceManager.resolvePath(filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    if (!Array.isArray(edits) || edits.length === 0) {
      throw new Error('Provide a non-empty "edits" array of { target, replacement, replace_all? } objects.');
    }

    let content = fs.readFileSync(fullPath, 'utf8');
    const report = [];
    edits.forEach((e, i) => {
      if (!e || typeof e.target !== 'string' || typeof e.replacement !== 'string') {
        throw new Error(`Edit #${i + 1} must have string "target" and "replacement".`);
      }
      if (!content.includes(e.target)) {
        throw new Error(`Edit #${i + 1}: target string not found. No changes were written.`);
      }
      const count = content.split(e.target).length - 1;
      if (count > 1 && !e.replace_all) {
        throw new Error(`Edit #${i + 1}: target appears ${count} times. Make it unique or set replace_all: true.`);
      }
      content = e.replace_all ? content.replaceAll(e.target, e.replacement) : content.replace(e.target, e.replacement);
      report.push({ edit: i + 1, replaced: e.replace_all ? count : 1 });
    });

    backups.snapshot(fullPath, filePath, 'edit');
    fs.writeFileSync(fullPath, content, 'utf8');
    workspaceManager.notifyChanged();

    return { success: true, path: filePath, edits_applied: report.length, detail: report, backed_up: true };
  },

  move_file: async ({ from, to, overwrite = false }) => {
    const src = workspaceManager.resolvePath(from);
    const dest = workspaceManager.resolvePath(to);
    if (!fs.existsSync(src)) throw new Error(`Source not found: ${from}`);
    if (fs.existsSync(dest) && !overwrite) {
      throw new Error(`Destination already exists (set overwrite: true to replace): ${to}`);
    }
    if (fs.existsSync(dest)) backups.snapshot(dest, to, 'overwrite');
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    fs.renameSync(src, dest);
    workspaceManager.notifyChanged();
    return { success: true, from, to, message: `Moved/renamed ${from} → ${to}.` };
  },

  copy_file: async ({ from, to, overwrite = false }) => {
    const src = workspaceManager.resolvePath(from);
    const dest = workspaceManager.resolvePath(to);
    if (!fs.existsSync(src)) throw new Error(`Source not found: ${from}`);
    if (fs.existsSync(dest) && !overwrite) {
      throw new Error(`Destination already exists (set overwrite: true to replace): ${to}`);
    }
    if (fs.existsSync(dest)) backups.snapshot(dest, to, 'overwrite');
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      fs.cpSync(src, dest, { recursive: true, force: Boolean(overwrite) });
    } else {
      fs.copyFileSync(src, dest);
    }
    workspaceManager.notifyChanged();
    return { success: true, from, to, type: stat.isDirectory() ? 'directory' : 'file', message: `Copied ${from} → ${to}.` };
  },

  list_backups: async ({ limit = 50 } = {}) => {
    return { backups: backups.list(Number(limit) || 50) };
  },

  restore_backup: async ({ backup_id }) => {
    if (!backup_id) throw new Error('backup_id is required (get it from list_backups).');
    const res = backups.restore(backup_id);
    workspaceManager.notifyChanged();
    return { success: true, ...res, message: `Restored ${res.restored} from backup.` };
  },

  list_directory: async ({ path: dirPath = '.', recursive = false, max_depth = 3 }) => {
    const fsp = fs.promises;
    const fullPath = workspaceManager.resolvePath(dirPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Directory not found: ${dirPath}`);
    }

    const results = [];
    const MAX_ITEMS = 10000; // cap payload so a giant tree can't hang the UI
    let truncated = false;

    const walk = async (currentPath, depth) => {
      if (depth > max_depth || results.length >= MAX_ITEMS) return;
      let items;
      try {
        items = await fsp.readdir(currentPath, { withFileTypes: true });
      } catch {
        return;
      }

      for (const item of items) {
        if (results.length >= MAX_ITEMS) { truncated = true; break; }
        const itemFullPath = path.join(currentPath, item.name);
        const relPath = path.relative(workspaceManager.getWorkspace(), itemFullPath).replace(/\\/g, '/');

        if (IGNORED_DIRS.has(item.name)) {
          results.push({ name: item.name, type: 'directory', path: relPath, skipped: true });
          continue;
        }

        if (item.isDirectory()) {
          results.push({ name: item.name, type: 'directory', path: relPath });
          if (recursive) await walk(itemFullPath, depth + 1);
        } else {
          let size = 0;
          try { size = (await fsp.stat(itemFullPath)).size; } catch {}
          results.push({ name: item.name, type: 'file', path: relPath, size_bytes: size });
        }
      }
    };

    await walk(fullPath, 1);
    return {
      directory: dirPath,
      total_items: results.length,
      truncated,
      items: results
    };
  },

  search_code: async ({ query, path: dirPath = '.', is_regex = false, max_results = 50 }) => {
    const fsp = fs.promises;
    const fullPath = workspaceManager.resolvePath(dirPath);
    const matches = [];

    let regex;
    try {
      regex = is_regex ? new RegExp(query, 'g') : null;
    } catch (e) {
      throw new Error(`Invalid regular expression: ${e.message}`);
    }

    const needle = query.toLowerCase();
    const MAX_FILE_BYTES = 1024 * 1024; // skip files > 1MB
    const MAX_FILES = 20000;            // hard cap so a huge tree can't hang
    let filesScanned = 0;

    const walk = async (currentDir) => {
      if (matches.length >= max_results || filesScanned >= MAX_FILES) return;
      let entries;
      try {
        entries = await fsp.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (matches.length >= max_results || filesScanned >= MAX_FILES) break;
        if (IGNORED_DIRS.has(entry.name) || entry.name.endsWith('.lock')) continue;

        const itemPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(itemPath);
        } else if (entry.isFile()) {
          let st;
          try { st = await fsp.stat(itemPath); } catch { continue; }
          if (st.size > MAX_FILE_BYTES) continue;
          filesScanned++;

          let content;
          try { content = await fsp.readFile(itemPath, 'utf8'); } catch { continue; }
          if (content.indexOf('\u0000') !== -1) continue; // likely binary

          const lines = content.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= max_results) break;
            const line = lines[i];
            let matched;
            if (regex) { matched = regex.test(line); regex.lastIndex = 0; }
            else { matched = line.toLowerCase().includes(needle); }
            if (matched) {
              matches.push({
                file: path.relative(workspaceManager.getWorkspace(), itemPath).replace(/\\/g, '/'),
                line_number: i + 1,
                line: line.trim().slice(0, 400)
              });
            }
          }

          // Yield to the event loop periodically so the UI stays responsive
          if (filesScanned % 200 === 0) await new Promise(r => setImmediate(r));
        }
      }
    };

    await walk(fullPath);
    return {
      query,
      total_matches: matches.length,
      files_scanned: filesScanned,
      truncated: filesScanned >= MAX_FILES,
      matches
    };
  },

  delete_file: async ({ path: filePath, recursive = false }) => {
    const fullPath = workspaceManager.resolvePath(filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Target does not exist: ${filePath}`);
    }

    // Safety check: Cannot delete workspace root
    if (fullPath === workspaceManager.getWorkspace()) {
      throw new Error(`Forbidden: Cannot delete the active workspace root directory!`);
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      fs.rmSync(fullPath, { recursive: Boolean(recursive), force: true });
    } else {
      backups.snapshot(fullPath, filePath, 'delete');
      fs.unlinkSync(fullPath);
    }
    workspaceManager.notifyChanged();

    return {
      success: true,
      deleted_path: filePath,
      type: stat.isDirectory() ? 'directory' : 'file',
      message: `Deleted successfully.`
    };
  },

  get_file_info: async ({ path: filePath }) => {
    const fullPath = workspaceManager.resolvePath(filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File or directory not found: ${filePath}`);
    }

    const stat = fs.statSync(fullPath);
    return {
      path: filePath,
      is_directory: stat.isDirectory(),
      is_file: stat.isFile(),
      size_bytes: stat.size,
      created_at: stat.birthtime,
      modified_at: stat.mtime
    };
  }
};
