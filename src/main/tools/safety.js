/**
 * OmniDev Studio — Safety tools: workspace checkpoints + encrypted secrets vault.
 */

const checkpoints = require('../checkpoints');
const vault = require('../vault');

module.exports = {
  create_checkpoint: async ({ label = '' } = {}) => {
    const r = checkpoints.create(label);
    return { success: true, ...r, message: `Checkpoint "${r.label}" created (${r.files} files, ${r.size_mb} MB). Restore anytime with restore_checkpoint.` };
  },

  list_checkpoints: async () => {
    return { checkpoints: checkpoints.list() };
  },

  restore_checkpoint: async ({ checkpoint_id }) => {
    if (!checkpoint_id) throw new Error('checkpoint_id is required (from list_checkpoints).');
    const r = checkpoints.restore(checkpoint_id);
    return { success: true, ...r, message: `Workspace restored to checkpoint ${checkpoint_id}. A safety checkpoint of the previous state was taken first.` };
  },

  vault_set: async ({ key, value }) => {
    if (!key || value === undefined) throw new Error('Both "key" and "value" are required.');
    return { success: true, ...vault.set(key, value), message: `Secret "${key}" stored encrypted in the vault.` };
  },

  vault_get: async ({ key }) => {
    if (!key) throw new Error('"key" is required.');
    return vault.get(key);
  },

  vault_list: async () => {
    return { secrets: vault.listKeys(), note: 'Only key names are listed; values stay encrypted until vault_get.' };
  },

  vault_delete: async ({ key }) => {
    if (!key) throw new Error('"key" is required.');
    return { success: true, ...vault.remove(key) };
  }
};
