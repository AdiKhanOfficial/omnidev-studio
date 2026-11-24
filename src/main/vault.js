/**
 * OmniDev Studio — Encrypted Secrets Vault
 *
 * Stores secrets (API keys, DB passwords, tokens) encrypted at rest with
 * AES-256-GCM instead of as plaintext in project notes. The encryption key is
 * a random 32-byte key kept in .omnidev/vault.key (created once). This protects
 * secrets from casual disk/repo exposure.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function dir() { return path.join(process.cwd(), '.omnidev'); }
function keyFile() { return path.join(dir(), 'vault.key'); }
function dataFile() { return path.join(dir(), 'vault.enc'); }

function getKey() {
  fs.mkdirSync(dir(), { recursive: true });
  try {
    const raw = fs.readFileSync(keyFile());
    if (raw.length === 32) return raw;
  } catch {}
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyFile(), key, { mode: 0o600 });
  return key;
}

function loadAll() {
  try {
    const blob = JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
    const key = getKey();
    const iv = Buffer.from(blob.iv, 'base64');
    const tag = Buffer.from(blob.tag, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(Buffer.from(blob.data, 'base64')), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
  } catch {
    return {};
  }
}

function saveAll(obj) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(dataFile(), JSON.stringify({
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64')
  }), { mode: 0o600 });
}

function set(key, value) {
  if (!key) throw new Error('A secret "key" is required.');
  const all = loadAll();
  all[key] = { value: String(value), updated: new Date().toISOString() };
  saveAll(all);
  return { key, stored: true };
}

function get(key) {
  const all = loadAll();
  if (!(key in all)) throw new Error(`No secret named "${key}" in the vault.`);
  return { key, value: all[key].value };
}

function listKeys() {
  const all = loadAll();
  return Object.keys(all).map(k => ({ key: k, updated: all[k].updated }));
}

function remove(key) {
  const all = loadAll();
  if (!(key in all)) return { key, removed: false };
  delete all[key];
  saveAll(all);
  return { key, removed: true };
}

module.exports = { set, get, listKeys, remove };
