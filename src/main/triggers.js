/**
 * OmniDev Studio — Automation Triggers
 *
 * Runs a chosen tool automatically on an event:
 *   - type 'interval'     → every N minutes
 *   - type 'file-change'  → when workspace files change (debounced, with a
 *                           cooldown so a tool that edits files can't loop)
 *
 * Triggers are persisted to .omnidev/triggers.json and execute through the
 * normal permission flow (so Manual/Smart mode still gates risky tools).
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

const COOLDOWN_MS = 30 * 1000;

class TriggersManager extends EventEmitter {
  constructor() {
    super();
    this.exec = null;            // injected tool runner (name, params) => Promise
    this.intervalHandles = {};   // id -> timer
    this.lastRun = {};           // id -> ts
    this.fileDebounce = null;
    this.triggers = this._load();
  }

  _file() { return path.join(process.cwd(), '.omnidev', 'triggers.json'); }
  _load() {
    try { const a = JSON.parse(fs.readFileSync(this._file(), 'utf8')); return Array.isArray(a) ? a : []; }
    catch { return []; }
  }
  _save() {
    try {
      fs.mkdirSync(path.dirname(this._file()), { recursive: true });
      fs.writeFileSync(this._file(), JSON.stringify(this.triggers, null, 2), 'utf8');
    } catch (_) {}
  }

  init(execFn) { this.exec = execFn; }

  start() {
    this._clearIntervals();
    for (const t of this.triggers) {
      if (t.enabled && t.type === 'interval' && t.intervalMinutes > 0) this._arm(t);
    }
  }

  _arm(t) {
    const ms = Math.max(1, Number(t.intervalMinutes)) * 60 * 1000;
    this.intervalHandles[t.id] = setInterval(() => this._run(t, 'interval'), ms);
  }

  _clearIntervals() {
    for (const h of Object.values(this.intervalHandles)) clearInterval(h);
    this.intervalHandles = {};
  }

  async _run(t, reason) {
    if (!t.enabled || !this.exec) return;
    const now = Date.now();
    if (this.lastRun[t.id] && now - this.lastRun[t.id] < COOLDOWN_MS) return; // cooldown guard
    this.lastRun[t.id] = now;
    try {
      await this.exec(t.tool, t.params || {});
      this.emit('triggerFired', { id: t.id, name: t.name, tool: t.tool, reason, at: new Date().toISOString() });
    } catch (err) {
      this.emit('triggerError', { id: t.id, name: t.name, error: err.message });
    }
  }

  onFileChange() {
    const fileTriggers = this.triggers.filter(t => t.enabled && t.type === 'file-change');
    if (!fileTriggers.length) return;
    if (this.fileDebounce) clearTimeout(this.fileDebounce);
    this.fileDebounce = setTimeout(() => {
      for (const t of fileTriggers) this._run(t, 'file-change');
    }, 1500);
  }

  add({ name, type, tool, params = {}, intervalMinutes = 10, enabled = true }) {
    if (!tool) throw new Error('A trigger needs a "tool" to run.');
    if (!['interval', 'file-change'].includes(type)) throw new Error('type must be "interval" or "file-change".');
    const t = { id: `trg-${uuidv4().slice(0, 8)}`, name: name || tool, type, tool, params, intervalMinutes: Number(intervalMinutes) || 10, enabled: Boolean(enabled) };
    this.triggers.push(t);
    this._save();
    this.start();
    return t;
  }

  remove(id) {
    this.triggers = this.triggers.filter(t => t.id !== id);
    if (this.intervalHandles[id]) { clearInterval(this.intervalHandles[id]); delete this.intervalHandles[id]; }
    this._save();
    return { removed: true };
  }

  toggle(id, enabled) {
    const t = this.triggers.find(x => x.id === id);
    if (!t) throw new Error('Trigger not found.');
    t.enabled = enabled === undefined ? !t.enabled : Boolean(enabled);
    this._save();
    this.start();
    return t;
  }

  list() { return this.triggers.slice(); }

  stop() { this._clearIntervals(); if (this.fileDebounce) clearTimeout(this.fileDebounce); }
}

module.exports = new TriggersManager();
