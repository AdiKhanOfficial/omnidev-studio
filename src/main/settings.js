const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SettingsManager {
  constructor() {
    this.storageFile = path.join(process.cwd(), '.omnidev_settings.json');
    this.settings = {
      ngrokAuthToken: '',
      tunnelType: 'local',
      ngrokStaticDomain: '',
      mcpSecretToken: this.generateRandomToken(),
      permissionMode: 'smart', // 'auto' | 'smart' | 'manual'
      soundEnabled: true,
      allowEscape: false,
      serverPort: 3721,
      theme: 'dark',
      // Per-tool permission overrides: { toolName: 'auto' | 'ask' | 'deny' }
      toolPolicies: {}
    };
    this.load();
  }

  generateRandomToken() {
    return 'sec_' + crypto.randomBytes(24).toString('hex');
  }

  load() {
    try {
      if (fs.existsSync(this.storageFile)) {
        const raw = fs.readFileSync(this.storageFile, 'utf8');
        const parsed = JSON.parse(raw);
        this.settings = { ...this.settings, ...parsed };
        this.settings.tunnelType = ['local', 'ngrok'].includes(parsed.tunnelType)
          ? parsed.tunnelType : (parsed.ngrokAuthToken ? 'ngrok' : 'local');
        if (!this.settings.mcpSecretToken) {
          this.settings.mcpSecretToken = this.generateRandomToken();
          this.save();
        }
      } else {
        this.save();
      }
    } catch (e) {
      console.warn('Could not read settings file, using defaults:', e.message);
    }
  }

  save() {
    try {
      fs.writeFileSync(this.storageFile, JSON.stringify(this.settings, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed to save settings:', e.message);
    }
  }

  get() {
    return { ...this.settings };
  }

  update(updates = {}) {
    this.settings = { ...this.settings, ...updates };
    this.save();
    return this.settings;
  }

  regenerateMcpToken() {
    this.settings.mcpSecretToken = this.generateRandomToken();
    this.save();
    return this.settings.mcpSecretToken;
  }
}

module.exports = new SettingsManager();
