/**
 * OmniDev Studio — RE Plugin Example: YARA Rules Manager
 *
 * This plugin lets the AI create and run inline YARA rules against
 * files in the workspace without needing external rule files.
 *
 * Drop this in plugins/ and it auto-loads.
 * The AI can call: yara_quick_scan({ path, ioc })
 */

module.exports = {
  name: 'yara_quick_scan',

  description: 'Quickly scan a file for a specific string, hex pattern, or IoC using an auto-generated YARA rule. No external .yar file needed — just provide the path and the indicator to search for.',

  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path in workspace to the file to scan'
      },
      ioc: {
        type: 'string',
        description: 'Indicator of compromise to search for: a string like "password" or "cmd.exe", or a hex pattern like "4d 5a 90 00"'
      },
      ioc_type: {
        type: 'string',
        enum: ['string', 'hex', 'wide', 'nocase'],
        description: 'How to interpret the IoC: string (default), hex, wide (UTF-16), or nocase (case-insensitive)'
      },
      rule_name: {
        type: 'string',
        description: 'Name for the generated YARA rule (default: quick_ioc_scan)'
      }
    },
    required: ['path', 'ioc']
  },

  isCritical: false,

  handler: async ({ path: filePath, ioc, ioc_type = 'string', rule_name = 'quick_ioc_scan' }) => {
    const fs = require('fs');
    const os = require('os');
    const { execSync } = require('child_process');
    const pathMod = require('path');
    const workspaceManager = require('../src/main/workspace');

    // Resolve workspace path
    const info = workspaceManager.getInfo();
    const root = info.path || process.cwd();
    const absPath = pathMod.isAbsolute(filePath) ? filePath : pathMod.join(root, filePath);

    if (!fs.existsSync(absPath)) {
      return { error: `File not found: ${filePath}`, path: filePath };
    }

    // Build YARA rule
    let iocStr;
    if (ioc_type === 'hex') {
      iocStr = `$ioc = { ${ioc} }`;
    } else if (ioc_type === 'wide') {
      iocStr = `$ioc = "${ioc}" wide`;
    } else if (ioc_type === 'nocase') {
      iocStr = `$ioc = "${ioc}" nocase`;
    } else {
      iocStr = `$ioc = "${ioc}"`;
    }

    const rule = `rule ${rule_name.replace(/[^a-zA-Z0-9_]/g, '_')} {
  meta:
    description = "Quick IoC scan by OmniDev Studio"
    target = "${pathMod.basename(filePath)}"
    ioc = "${ioc}"
  strings:
    ${iocStr}
  condition:
    $ioc
}`;

    // Write temp rule file
    const tmpRules = pathMod.join(os.tmpdir(), `omnidev_yara_quick_${Date.now()}.yar`);
    fs.writeFileSync(tmpRules, rule, 'utf8');

    try {
      const yaraCmd = process.platform === 'win32' ? 'yara64' : 'yara';
      let output, matched = false, error = null;

      try {
        output = execSync(`${yaraCmd} "${tmpRules}" "${absPath}"`, {
          encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe']
        });
        matched = output.trim().length > 0;
      } catch (e) {
        if (e.stdout && e.stdout.trim()) {
          output = e.stdout;
          matched = true;
        } else if (e.message.includes('not recognized') || e.message.includes('not found')) {
          error = 'YARA not installed. Install: winget install VirusTotal.YARA (Windows) or apt install yara (Linux)';
        } else {
          error = e.stderr || e.message;
        }
      }

      return {
        file: filePath,
        ioc,
        ioc_type,
        rule_generated: rule,
        matched,
        result: matched ? 'IOC FOUND in file' : 'IOC NOT found in file',
        yara_output: output ? output.trim() : null,
        error
      };
    } finally {
      try { fs.unlinkSync(tmpRules); } catch (_) {}
    }
  }
};
