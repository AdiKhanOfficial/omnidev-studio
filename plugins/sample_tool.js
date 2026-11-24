/**
 * OmniDev Studio — Sample Custom Plugin
 * 
 * Copy this file and rename it to create your own custom skill/tool.
 * Drop any .js plugin file into the plugins/ folder and it will be
 * auto-discovered and hot-reloaded — no restart required.
 * 
 * Required exports:
 *   name         - Unique snake_case identifier (used by ChatGPT/Claude to call the tool)
 *   description  - What the tool does (shown in the AI's tool list)
 *   handler      - Async function(params, ctx) => result   (ctx.config = user config)
 *
 * Optional manifest fields (shown in the Skills pane):
 *   inputSchema  - JSON Schema for the tool's parameters
 *   isCritical   - If true, requires user approval before running
 *   version, author, category - metadata
 *   configSchema - [{ key, label, type, default }] user-editable settings
 */

module.exports = {
  name: 'example_greet',

  description: 'Example custom OmniDev skill — returns a personalized greeting. Use this as a template for your own skills.',

  version: '2.0.0',
  author: 'AdiKhanOfficial',
  category: 'Demo',

  // User-editable settings — appear as inputs in the Skills pane.
  configSchema: [
    { key: 'default_language', label: 'Default language', type: 'string', default: 'english' }
  ],

  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'The name of the person to greet'
      },
      language: {
        type: 'string',
        enum: ['english', 'urdu', 'spanish', 'french'],
        description: 'Language for the greeting (defaults to the skill config)'
      }
    },
    required: ['name']
  },

  isCritical: false,

  handler: async ({ name, language }, ctx = {}) => {
    const config = ctx.config || {};
    const lang = language || config.default_language || 'english';
    const greetings = {
      english: `Hello, ${name}! This greeting was delivered by a custom OmniDev skill.`,
      urdu: `Salam, ${name}! Yeh greeting ek custom OmniDev skill ne di hai.`,
      spanish: `¡Hola, ${name}! Este saludo fue entregado por un skill personalizado de OmniDev.`,
      french: `Bonjour, ${name}! Ce message a été envoyé par un skill OmniDev personnalisé.`
    };

    return {
      greeting: greetings[lang] || greetings.english,
      plugin: 'example_greet',
      used_language: lang,
      timestamp: new Date().toISOString(),
      tip: 'Rename this file and change name/description/handler to create your own tool!'
    };
  }
};
