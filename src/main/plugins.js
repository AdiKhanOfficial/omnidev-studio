/**
 * OmniDev Studio — Plugin & Custom Skills Manager (v2)
 *
 * Watches the plugins/ directory for .js files. Each file exports:
 *   {
 *     name, description, handler,          // required
 *     inputSchema?,                        // JSON Schema for arguments
 *     isCritical?,                         // require approval in Smart mode
 *     version?, author?, category?,        // manifest metadata (shown in UI)
 *     configSchema?                        // [{ key, label, type, default }] user-editable config
 *   }
 *
 * The handler is called as handler(params, { config }) where config is the
 * user-provided per-plugin configuration (plugins written for v1 that only
 * accept (params) keep working).
 *
 * Features:
 * - Auto-discovery + hot-reload (fs.watch)
 * - Per-plugin enable/disable (persisted)
 * - Per-plugin config (persisted)
 * - "New skill" scaffolding
 * - Per-plugin error isolation
 */

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

const PLUGINS_DIR = () => path.join(process.cwd(), 'plugins');
const STATE_FILE = () => path.join(process.cwd(), '.omnidev', 'plugins.json');

class PluginsManager extends EventEmitter {
  constructor() {
    super();
    this.loadedPlugins = new Map(); // name -> record (enabled + disabled both tracked)
    this.fileWatcher = null;
    this.debounceTimers = new Map();
    this.state = this._loadState(); // { disabled: [], config: {} }
  }

  _loadState() {
    try {
      const raw = fs.readFileSync(STATE_FILE(), 'utf8');
      const parsed = JSON.parse(raw);
      return {
        disabled: Array.isArray(parsed.disabled) ? parsed.disabled : [],
        config: parsed.config && typeof parsed.config === 'object' ? parsed.config : {}
      };
    } catch {
      return { disabled: [], config: {} };
    }
  }

  _saveState() {
    try {
      const dir = path.dirname(STATE_FILE());
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(STATE_FILE(), JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      console.error('[Plugins] Could not persist state:', err.message);
    }
  }

  isEnabled(name) {
    return !this.state.disabled.includes(name);
  }

  getConfig(name) {
    return this.state.config[name] || {};
  }

  async loadPlugins() {
    const dir = PLUGINS_DIR();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log('[Plugins] Created plugins/ directory');
    }

    let files = [];
    try {
      files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
    } catch (err) {
      console.error('[Plugins] Failed to read plugins directory:', err.message);
      return;
    }

    console.log(`[Plugins] Found ${files.length} plugin file(s)`);
    for (const file of files) {
      await this._loadPlugin(path.join(dir, file));
    }
    this._startWatcher();
  }

  async _loadPlugin(filePath) {
    const fileName = path.basename(filePath);

    const existing = this._findPluginByFile(filePath);
    if (existing) this._removeFromMap(existing.name, false);

    const resolvedPath = require.resolve(filePath);
    if (require.cache[resolvedPath]) delete require.cache[resolvedPath];

    let plugin;
    try {
      plugin = require(filePath);
    } catch (err) {
      console.error(`[Plugins] Failed to load ${fileName}:`, err.message);
      this.emit('pluginError', { file: fileName, error: err.message, stack: err.stack });
      return;
    }

    const validationError = this._validatePlugin(plugin, fileName);
    if (validationError) {
      console.error(`[Plugins] Invalid plugin ${fileName}: ${validationError}`);
      this.emit('pluginError', { file: fileName, error: validationError });
      return;
    }

    const record = {
      name: plugin.name,
      description: plugin.description,
      inputSchema: plugin.inputSchema || { type: 'object', properties: {} },
      rawHandler: plugin.handler,
      isCritical: plugin.isCritical === true,
      version: typeof plugin.version === 'string' ? plugin.version : '1.0.0',
      author: typeof plugin.author === 'string' ? plugin.author : '',
      category: typeof plugin.category === 'string' ? plugin.category : 'General',
      configSchema: Array.isArray(plugin.configSchema) ? plugin.configSchema : [],
      file: fileName,
      filePath,
      loadedAt: new Date().toISOString(),
      status: 'ok',
      enabled: this.isEnabled(plugin.name)
    };

    // Wrap the handler so the current per-plugin config is injected each call.
    const self = this;
    record.handler = (params) => record.rawHandler(params, { config: self.getConfig(record.name) });

    this.loadedPlugins.set(plugin.name, record);
    console.log(`[Plugins] Loaded ${plugin.name} (${fileName}) — ${record.enabled ? 'enabled' : 'disabled'}`);

    if (record.enabled) {
      this.emit('pluginLoaded', record);
    } else {
      this.emit('pluginDiscovered', record);
    }
  }

  _removeFromMap(name, emitUnload = true) {
    const plugin = this.loadedPlugins.get(name);
    if (!plugin) return;
    try {
      const resolvedPath = require.resolve(plugin.filePath);
      if (require.cache[resolvedPath]) delete require.cache[resolvedPath];
    } catch (_) {}
    this.loadedPlugins.delete(name);
    if (emitUnload && plugin.enabled) this.emit('pluginUnloaded', { name, file: plugin.file });
  }

  _findPluginByFile(filePath) {
    for (const [, record] of this.loadedPlugins) {
      if (record.filePath === filePath) return record;
    }
    return null;
  }

  _validatePlugin(plugin, fileName) {
    if (!plugin || typeof plugin !== 'object') return 'Module must export a plain object.';
    if (!plugin.name || typeof plugin.name !== 'string') return 'Missing or invalid "name".';
    if (!/^[a-z_][a-z0-9_]*$/.test(plugin.name)) {
      return `Invalid "name" "${plugin.name}". Use lowercase letters, digits, underscores only.`;
    }
    if (!plugin.description || typeof plugin.description !== 'string') return 'Missing or invalid "description".';
    if (typeof plugin.handler !== 'function') return 'Missing or invalid "handler" (must be a function).';
    return null;
  }

  /** Enable or disable a plugin by name; registers/unregisters its tool. */
  setEnabled(name, enabled) {
    const record = this.loadedPlugins.get(name);
    if (!record) throw new Error(`Plugin not found: ${name}`);

    const want = Boolean(enabled);
    if (record.enabled === want) return this.getLoadedPlugins();

    record.enabled = want;
    const idx = this.state.disabled.indexOf(name);
    if (want && idx >= 0) this.state.disabled.splice(idx, 1);
    if (!want && idx < 0) this.state.disabled.push(name);
    this._saveState();

    if (want) this.emit('pluginLoaded', record);
    else this.emit('pluginUnloaded', { name, file: record.file });

    return this.getLoadedPlugins();
  }

  /** Save per-plugin config. */
  setConfig(name, config = {}) {
    if (!this.loadedPlugins.has(name)) throw new Error(`Plugin not found: ${name}`);
    this.state.config[name] = config && typeof config === 'object' ? config : {};
    this._saveState();
    return this.getConfig(name);
  }

  /** Create a new skill file from a template. Returns the created file path. */
  scaffold({ name, description = '', category = 'Custom', critical = false } = {}) {
    if (!name || !/^[a-z_][a-z0-9_]*$/.test(name)) {
      throw new Error('Provide a valid skill name: lowercase letters, digits and underscores only.');
    }
    const dir = PLUGINS_DIR();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.js`);
    if (fs.existsSync(file)) throw new Error(`A plugin file named ${name}.js already exists.`);

    const safeDesc = (description || `Custom skill: ${name}`).replace(/`/g, "'");
    const template = `/**
 * OmniDev Studio Skill: ${name}
 * ${safeDesc}
 *
 * Edit the handler below. The file hot-reloads automatically on save.
 */

module.exports = {
  name: '${name}',
  description: ${JSON.stringify(safeDesc)},
  category: ${JSON.stringify(category)},
  version: '1.0.0',
  author: '',
  isCritical: ${critical ? 'true' : 'false'},

  // JSON Schema describing the arguments the AI must pass.
  inputSchema: {
    type: 'object',
    properties: {
      example: { type: 'string', description: 'An example argument — rename or replace me.' }
    },
    required: []
  },

  // Optional: user-editable settings shown in the Skills pane.
  // configSchema: [{ key: 'api_base', label: 'API base URL', type: 'string', default: '' }],

  // params = arguments from the AI. ctx.config = the user config above.
  handler: async (params, ctx = {}) => {
    const config = ctx.config || {};
    return {
      ok: true,
      received: params,
      hint: 'Implement your logic here and return any JSON-serializable result.'
    };
  }
};
`;
    fs.writeFileSync(file, template, 'utf8');
    return file;
  }

  _startWatcher() {
    if (this.fileWatcher) return;
    try {
      this.fileWatcher = fs.watch(PLUGINS_DIR(), { persistent: false }, (eventType, filename) => {
        if (!filename || !filename.endsWith('.js')) return;
        const filePath = path.join(PLUGINS_DIR(), filename);
        if (this.debounceTimers.has(filename)) clearTimeout(this.debounceTimers.get(filename));
        const timer = setTimeout(async () => {
          this.debounceTimers.delete(filename);
          if (fs.existsSync(filePath)) {
            console.log(`[Plugins] Change detected: ${filename} — reloading...`);
            await this._loadPlugin(filePath);
          } else {
            const existing = this._findPluginByFile(filePath);
            if (existing) this._removeFromMap(existing.name, true);
          }
        }, 400);
        this.debounceTimers.set(filename, timer);
      });
      console.log('[Plugins] Watching plugins/ for hot-reload');
    } catch (err) {
      console.warn('[Plugins] Could not watch plugins directory:', err.message);
    }
  }

  async reloadAll() {
    for (const name of [...this.loadedPlugins.keys()]) {
      this._removeFromMap(name, true);
    }
    await this.loadPlugins();
    return this.getLoadedPlugins();
  }

  getLoadedPlugins() {
    return [...this.loadedPlugins.values()].map(p => ({
      name: p.name,
      description: p.description,
      file: p.file,
      isCritical: p.isCritical,
      version: p.version,
      author: p.author,
      category: p.category,
      configSchema: p.configSchema,
      config: this.getConfig(p.name),
      enabled: p.enabled,
      loadedAt: p.loadedAt,
      status: p.status
    }));
  }

  stop() {
    if (this.fileWatcher) {
      try { this.fileWatcher.close(); } catch (_) {}
      this.fileWatcher = null;
    }
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
  }
}

module.exports = new PluginsManager();
