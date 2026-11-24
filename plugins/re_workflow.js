/**
 * OmniDev Studio — Full RE Workflow Plugin
 *
 * Combines multiple RE steps into one orchestrated workflow:
 * recon → decode → analyze → modify → rebuild → sign
 *
 * Tool name: re_workflow
 * Usage: AI calls re_workflow({ target, action, ... })
 */

module.exports = {
  name: 're_workflow',

  description: 'Orchestrated reverse engineering workflow. Given a target file, runs a named action: "recon" (full static analysis), "android_full" (APK decode+sign pipeline), "patch_nop" (NOP out bytes at offset), or "decompile" (best-effort Java/Smali decompile). Returns combined results with next_steps guidance.',

  inputSchema: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'Relative path to target file in workspace (APK, EXE, DLL, JAR, etc.)'
      },
      action: {
        type: 'string',
        enum: ['recon', 'android_full', 'patch_nop', 'decompile', 'extract_iocs'],
        description: [
          'recon       — Full static recon: file_identify + hash + entropy + strings + pe/elf_info + checksec + extract_urls',
          'android_full — APK: apk_info → apk_decode → jadx_decompile (full pipeline)',
          'patch_nop   — NOP out bytes at given offset (requires nop_offset + nop_length)',
          'decompile   — Best-effort decompile: jadx (APK/JAR), ilspycmd (.NET), or smali listing',
          'extract_iocs — Extract all IOCs: strings + URLs + IPs + hashes'
        ].join('\n')
      },
      nop_offset: {
        type: 'string',
        description: 'For action=patch_nop: hex or decimal offset to start NOP-ing (e.g. "0x401234")'
      },
      nop_length: {
        type: 'integer',
        description: 'For action=patch_nop: number of bytes to NOP (replace with 0x90)'
      },
      output_dir: {
        type: 'string',
        description: 'Base output directory (default: re_output/<target_name>)'
      }
    },
    required: ['target', 'action']
  },

  isCritical: false,

  handler: async ({ target, action, nop_offset, nop_length, output_dir }) => {
    // Require the reversing and rebuild modules
    const reversing = require('../src/main/tools/reversing');
    const rebuild = require('../src/main/tools/rebuild');
    const path = require('path');
    const workspaceManager = require('../src/main/workspace');

    const info = workspaceManager.getInfo();
    const workRoot = info.path || process.cwd();
    const baseName = path.basename(target).replace(/\.[^.]+$/, '');
    const baseOut = output_dir || `re_output/${baseName}`;

    // ── recon ──────────────────────────────────────────────────────────────
    if (action === 'recon') {
      const [fileInfo, hashResult, entropyResult] = await Promise.all([
        reversing.file_identify({ path: target }),
        reversing.hash_file({ path: target, algorithms: ['md5', 'sha256'] }),
        reversing.entropy_analysis({ path: target, chunk_size: 512 })
      ]);

      let secInfo = null;
      try { secInfo = await reversing.checksec_binary({ path: target }); } catch (_) {}

      let headerInfo = null;
      if (fileInfo.identified_as?.includes('PE')) {
        try { headerInfo = await reversing.pe_info({ path: target }); } catch (_) {}
      } else if (fileInfo.identified_as?.includes('ELF')) {
        try { headerInfo = await reversing.elf_info({ path: target }); } catch (_) {}
      }

      const strResult = await reversing.strings_extract({ path: target, min_length: 6, limit: 100 });
      const urlResult = await reversing.extract_urls({ path: target });

      return {
        action: 'recon',
        target,
        file_identification: fileInfo,
        hashes: hashResult.hashes,
        virustotal: hashResult.virustotal_link,
        entropy: { average: entropyResult.average_entropy, packed_likely: entropyResult.packed_or_encrypted, summary: entropyResult.summary },
        security_checks: secInfo,
        header_info: headerInfo,
        notable_strings: (strResult.strings || []).slice(0, 50).map(s => typeof s === 'string' ? s : s.value),
        network_iocs: { urls: urlResult.urls?.ascii?.slice(0, 30), ips: urlResult.ip_addresses?.ascii?.slice(0, 30) },
        next_steps: [
          fileInfo.identified_as?.includes('PE') ? 'pe_info for full section details' : null,
          fileInfo.identified_as?.includes('ELF') ? 'elf_info for segment details' : null,
          entropyResult.packed_or_encrypted ? 'High entropy detected — binary may be packed. Try entropy_analysis with smaller chunk_size.' : null,
          fileInfo.identified_as?.includes('APK') || fileInfo.identified_as?.includes('ZIP') ? 're_workflow({ target, action: "android_full" }) to decode APK' : null,
          'Use find_pattern to search for specific byte sequences',
          'Use hex_dump to inspect specific offsets'
        ].filter(Boolean)
      };
    }

    // ── extract_iocs ───────────────────────────────────────────────────────
    if (action === 'extract_iocs') {
      const [strResult, urlResult, hashResult] = await Promise.all([
        reversing.strings_extract({ path: target, min_length: 5, limit: 500 }),
        reversing.extract_urls({ path: target }),
        reversing.hash_file({ path: target, algorithms: ['md5', 'sha1', 'sha256'] })
      ]);

      return {
        action: 'extract_iocs',
        target,
        file_hashes: hashResult.hashes,
        virustotal: hashResult.virustotal_link,
        urls: urlResult.urls,
        ip_addresses: urlResult.ip_addresses,
        domains: urlResult.domains?.slice(0, 100),
        emails: urlResult.emails?.slice(0, 50),
        registry_keys: urlResult.registry_keys?.slice(0, 50),
        string_count: strResult.total_found
      };
    }

    // ── android_full ───────────────────────────────────────────────────────
    if (action === 'android_full') {
      const apkInfoResult = await rebuild.apk_info({ path: target });
      const decodeResult = await rebuild.apk_decode({
        path: target,
        output_dir: `${baseOut}/decoded`,
        force: true
      });

      let decompileResult = null;
      try {
        decompileResult = await rebuild.jadx_decompile({
          path: target,
          output_dir: `${baseOut}/java_sources`
        });
      } catch (_) {}

      return {
        action: 'android_full',
        target,
        apk_metadata: apkInfoResult,
        decode: decodeResult,
        java_decompile: decompileResult,
        next_steps: [
          decodeResult.output_dir ? `Browse Smali: ${decodeResult.output_dir}` : null,
          decodeResult.output_dir ? `Edit Smali then rebuild: apk_rebuild({ path: "${decodeResult.output_dir}" })` : null,
          decompileResult?.output_dir ? `Java sources in: ${decompileResult.output_dir}` : 'Install jadx: install_re_tool({ tool: "jadx" })',
          'Modify AndroidManifest.xml for permissions/activities',
          'Use smali_patch to bulk-modify Smali code'
        ].filter(Boolean)
      };
    }

    // ── decompile ──────────────────────────────────────────────────────────
    if (action === 'decompile') {
      const fileInfo = await reversing.file_identify({ path: target });
      const isAPK = fileInfo.identified_as?.includes('APK') || fileInfo.identified_as?.includes('ZIP');
      const isDEX = fileInfo.identified_as?.includes('DEX');
      const isJAR = target.endsWith('.jar') || target.endsWith('.aar');
      const isDotNet = target.endsWith('.exe') || target.endsWith('.dll');

      if (isAPK || isDEX || isJAR) {
        // Try jadx first
        const jadxResult = await rebuild.jadx_decompile({ path: target, output_dir: `${baseOut}/decompiled` });
        if (jadxResult.java_files_decompiled > 0) return { action: 'decompile', target, method: 'jadx', ...jadxResult };

        // Fallback: apktool smali only
        const decodeResult = await rebuild.apk_decode({ path: target, output_dir: `${baseOut}/smali`, no_res: true, force: true });
        return { action: 'decompile', target, method: 'apktool-smali', ...decodeResult, note: 'jadx not found — decoded to Smali only. Install jadx for Java source.' };
      }

      if (isDotNet) {
        const r = await rebuild.dotnet_decompile({ path: target, output_dir: `${baseOut}/decompiled` });
        return { action: 'decompile', target, method: 'ilspycmd', ...r };
      }

      // Generic: strings + hex dump
      const strResult = await reversing.strings_extract({ path: target, min_length: 5, limit: 200 });
      return {
        action: 'decompile',
        target,
        method: 'strings-only',
        note: `No decompiler available for: ${fileInfo.identified_as}. Extracted strings instead.`,
        file_info: fileInfo,
        strings: strResult.strings
      };
    }

    // ── patch_nop ──────────────────────────────────────────────────────────
    if (action === 'patch_nop') {
      if (!nop_offset) throw new Error('"nop_offset" required for action=patch_nop (e.g. "0x401234")');
      if (!nop_length) throw new Error('"nop_length" required for action=patch_nop (number of bytes)');

      const nopBytes = Array(nop_length).fill('90').join(' ');
      const result = await rebuild.patch_binary({
        path: target,
        patches: [{ offset: nop_offset, bytes: nopBytes, comment: `NOP slide ${nop_length} bytes @ ${nop_offset}` }],
        output_path: output_dir ? `${output_dir}/${path.basename(target)}.patched` : undefined,
        backup: true
      });
      return { action: 'patch_nop', ...result };
    }

    return { error: `Unknown action: ${action}. Valid: recon, android_full, decompile, patch_nop, extract_iocs` };
  }
};
