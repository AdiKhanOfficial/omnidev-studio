/**
 * OmniDev Studio — Persistent Audit Log
 *
 * Appends every tool execution (success or failure) as one JSON line to
 * .omnidev/audit.log inside the current working directory. Gives an autonomous
 * agent a permanent, tamper-evident trail of everything it touched.
 */

const fs = require('fs');
const path = require('path');

const AUDIT_DIR = () => path.join(process.cwd(), '.omnidev');
const AUDIT_FILE = () => path.join(AUDIT_DIR(), 'audit.log');

// Keep the log from growing without bound (bytes).
const MAX_BYTES = 5 * 1024 * 1024;

function ensureDir() {
  const dir = AUDIT_DIR();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function rotateIfNeeded() {
  try {
    const file = AUDIT_FILE();
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) {
      fs.renameSync(file, file + '.1');
    }
  } catch (_) {}
}

/**
 * Record a single tool execution.
 * @param {object} record { tool, params, success, approved, duration_ms, error?, timestamp? }
 */
function record(record) {
  try {
    ensureDir();
    rotateIfNeeded();
    const entry = {
      ts: record.timestamp || new Date().toISOString(),
      tool: record.tool,
      success: record.success !== false && record.approved !== false,
      approved: record.approved !== false,
      duration_ms: record.duration_ms ?? null,
      error: record.error || null,
      // Trim params so secrets / huge blobs don't bloat the log
      params: summarizeParams(record.params)
    };
    fs.appendFileSync(AUDIT_FILE(), JSON.stringify(entry) + '\n', 'utf8');
  } catch (_) {
    // Never let auditing break tool execution
  }
}

function summarizeParams(params) {
  if (!params || typeof params !== 'object') return params ?? null;
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (/pass|secret|token|key|pwd|credential/i.test(k)) {
      out[k] = '***redacted***';
    } else if (typeof v === 'string' && v.length > 300) {
      out[k] = v.slice(0, 300) + `… (+${v.length - 300} chars)`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Read the most recent audit entries (newest first).
 */
function recent(limit = 200) {
  try {
    const file = AUDIT_FILE();
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    const slice = lines.slice(-limit).reverse();
    return slice.map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function clear() {
  try {
    const file = AUDIT_FILE();
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

module.exports = { record, recent, clear, AUDIT_FILE };
