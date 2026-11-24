const EventEmitter = require('events');
const settingsManager = require('./settings');

class TunnelManager extends EventEmitter {
  constructor() {
    super();
    this.publicUrl = null;
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'error'
    this.ngrokListener = null;
    this.lastError = null;
  }

  async start({ port = 3721 } = {}) {
    const settings = settingsManager.get();
    if (this.ngrokListener) await this.stop();
    if (settings.tunnelType !== 'ngrok') return this.getInfo();

    if (!settings.ngrokAuthToken) {
      this.status = 'error';
      this.lastError = 'Ngrok Authtoken is required in settings.';
      this.emit('statusChanged', { status: 'error', error: this.lastError });
      return { status: 'error', error: this.lastError };
    }

    this.status = 'connecting';
    this.lastError = null;
    this.emit('statusChanged', { status: this.status, url: null });

    try {
      const ngrok = require('@ngrok/ngrok');

      const options = {
        addr: `127.0.0.1:${port}`,
        authtoken: settings.ngrokAuthToken.trim()
      };

      let cleanDomain = settings.ngrokStaticDomain ? settings.ngrokStaticDomain.trim() : '';
      if (cleanDomain) {
        cleanDomain = cleanDomain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();
        options.domain = cleanDomain;
      }

      this.ngrokListener = await ngrok.forward(options);
      this.publicUrl = this.ngrokListener.url();

      this.status = 'connected';
      this.emit('statusChanged', {
        status: this.status,
        url: this.publicUrl,
        type: 'ngrok'
      });

      return { url: this.publicUrl, status: 'connected' };
    } catch (err) {
      this.status = 'error';
      this.lastError = err.message;
      this.emit('statusChanged', { status: 'error', error: err.message });
      this.emit('tunnelError', { message: err.message });
      throw err;
    }
  }

  async stop() {
    if (this.ngrokListener) {
      try {
        await this.ngrokListener.close();
      } catch {}
      this.ngrokListener = null;
    }
    this.status = 'disconnected';
    this.publicUrl = null;
    this.lastError = null;
    this.emit('statusChanged', { status: this.status, url: null });
  }

  getInfo() {
    return {
      status: settingsManager.get().tunnelType === 'local' ? 'local' : this.status,
      url: this.publicUrl,
      type: settingsManager.get().tunnelType,
      error: this.lastError
    };
  }
}

module.exports = new TunnelManager();
