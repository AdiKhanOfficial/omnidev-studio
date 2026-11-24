/**
 * OmniDev Studio — Rebuild & Decompile Tools
 *
 * Full RE workflow: Disassemble → Decompile → Modify → Rebuild → Resign
 *
 * Supported formats:
 *   Android APK  — apktool decode/rebuild, jadx decompile, apksigner resign
 *   Java JAR     — jar extract/rebuild, jadx/cfr decompile, javac recompile
 *   .NET EXE/DLL — dotnet/ilspycmd decompile
 *   PE Binaries  — hex-level patching, section extraction
 *   JS/Web       — prettier unminify, webpack bundle analysis
 *   Archive ops  — zip/jar/apk pack & unpack
 *
 * Tools:
 *   apk_decode          - Disassemble APK → Smali + resources (apktool)
 *   apk_rebuild         - Rebuild APK from modified Smali (apktool)
 *   apk_sign            - Sign APK with debug or custom keystore
 *   apk_info            - Quick APK metadata (manifest, permissions, activities)
 *   jadx_decompile      - Decompile APK/JAR/DEX → Java source (jadx)
 *   jar_extract         - Extract JAR/ZIP contents to workspace dir
 *   jar_rebuild         - Repack directory into JAR/ZIP/APK
 *   java_compile        - Compile .java source files with javac
 *   dotnet_decompile    - Decompile .NET EXE/DLL with ilspycmd/dotnet
 *   patch_binary        - Apply raw byte patches to binary at given offsets
 *   extract_section     - Dump a PE/ELF section to a separate file
 *   unminify_js         - Pretty-print minified JS using prettier/js-beautify
 *   smali_patch         - Find and replace text in Smali files (batch)
 *   install_re_tool     - Install missing RE tools (jadx, jadx-gui, etc.)
 *   run_r2              - Run radare2 command on a file
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync, exec, execFile } = require('child_process');
const os = require('os');
const workspaceManager = require('../workspace');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolvePath(relPath) {
  if (!relPath) return process.cwd();
  const info = workspaceManager.getInfo();
  const root = info.path || process.cwd();
  return path.isAbsolute(relPath) ? relPath : path.join(root, relPath);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

// Async, non-blocking external-tool runner. Never blocks the Electron main
// process, always has a timeout, kills the whole process tree on timeout
// (so a hung apktool/jadx can't wedge the app), and caps buffered output so a
// chatty tool can't blow up memory.
function runTool(cmd, opts = {}) {
  const timeout = opts.timeout || 120000;
  const maxBuffer = opts.maxBuffer || 64 * 1024 * 1024; // 64 MB hard cap
  return new Promise((resolve) => {
    const child = exec(cmd, {
      timeout,
      encoding: 'utf8',
      maxBuffer,
      windowsHide: true,
      killSignal: 'SIGKILL',
      cwd: opts.cwd || process.cwd(),
      env: { ...process.env, ...(opts.env || {}) }
    }, (e, stdout, stderr) => {
      if (e) {
        // On timeout/kill, make sure no orphaned child tree lingers (Windows)
        if ((e.killed || e.signal) && process.platform === 'win32' && child.pid) {
          try { execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {}); } catch (_) {}
        }
        const overflow = /maxBuffer/i.test(e.message || '');
        resolve({
          ok: false,
          stdout: (stdout || '').toString().trim(),
          stderr: (stderr || e.message || '').toString().trim(),
          code: e.code,
          timedOut: Boolean(e.killed || e.signal),
          error: e.killed || e.signal
            ? `Tool timed out after ${Math.round(timeout / 1000)}s and was terminated.`
            : overflow ? 'Tool produced too much output and was stopped (memory limit).' : undefined
        });
      } else {
        resolve({ ok: true, stdout: (stdout || '').toString().trim(), stderr: (stderr || '').toString().trim() });
      }
    });
  });
}

function findTool(names) {
  for (const name of (Array.isArray(names) ? names : [names])) {
    const r = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().split('\n')[0].trim();
  }
  return null;
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// Read a whole file into memory, but refuse files big enough to risk an
// out-of-memory crash. Keeps the app stable on oversized binaries.
function readFileGuarded(absPath, maxBytes, encoding) {
  let st;
  try { st = fs.statSync(absPath); } catch { throw new Error(`File not found: ${absPath}`); }
  if (st.size > maxBytes) {
    throw new Error(`File is too large (${humanSize(st.size)}); the limit for this operation is ${humanSize(maxBytes)}.`);
  }
  return fs.readFileSync(absPath, encoding);
}

// ─── Python path helper ───────────────────────────────────────────────────────
function getPython() {
  const paths = [
    'python',
    'C:\\Users\\AdiKh\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
    'C:\\Python312\\python.exe',
    'python3'
  ];
  for (const p of paths) {
    const r = spawnSync(p, ['--version'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    if (r.status === 0) return p;
  }
  return null;
}

// ─── Java path helper ─────────────────────────────────────────────────────────
function getJava() { return findTool(['java']) || 'java'; }
function getJavac() { return findTool(['javac']) || 'javac'; }

// ─── 1. apk_decode ───────────────────────────────────────────────────────────

async function apk_decode({ path: apkPath, output_dir, force = false, no_src = false, no_res = false }) {
  if (!apkPath) throw new Error('"path" is required (path to APK file)');

  const absApk = resolvePath(apkPath);
  if (!fs.existsSync(absApk)) throw new Error(`APK not found: ${apkPath}`);

  const info = workspaceManager.getInfo();
  const workRoot = info.path || process.cwd();
  const apkBaseName = path.basename(absApk, '.apk');
  const outDir = resolvePath(output_dir || `decoded/${apkBaseName}`);

  ensureDir(path.dirname(outDir));

  const apktool = findTool(['apktool', 'apktool.bat']) || 'apktool';
  const flags = [
    force ? '-f' : '',
    no_src ? '-s' : '',
    no_res ? '-r' : ''
  ].filter(Boolean).join(' ');

  const java = getJava();
  const cmd = `"${java}" -jar "${apktool}" d ${flags} "${absApk}" -o "${outDir}"`;
  
  // apktool is a bat wrapper; try direct bat first
  const batResult = await runTool(`apktool d ${flags} "${absApk}" -o "${outDir}"`, { timeout: 180000, cwd: workRoot });
  
  if (!batResult.ok) {
    // Try java -jar approach
    const jarPath = findTool(['apktool.jar']) || 'apktool.jar';
    const javaResult = await runTool(`${java} -jar "${jarPath}" d ${flags} "${absApk}" -o "${outDir}"`, { timeout: 180000 });
    if (!javaResult.ok) {
      return { error: 'apktool failed', stderr: javaResult.stderr || batResult.stderr, cmd: `apktool d "${apkPath}" -o "${output_dir || `decoded/${apkBaseName}`}"`, install_hint: 'Install: https://apktool.org/' };
    }
    return { success: true, output_dir: path.relative(workRoot, outDir), apk: apkPath, stdout: javaResult.stdout };
  }

  // List what was decoded
  const contents = fs.existsSync(outDir) ? fs.readdirSync(outDir) : [];
  const smaliDirs = contents.filter(d => d.startsWith('smali'));
  const hasResources = contents.includes('res');
  const hasManifest = contents.includes('AndroidManifest.xml');

  return {
    success: true,
    output_dir: path.relative(workRoot, outDir),
    apk: apkPath,
    decoded_contents: contents,
    smali_directories: smaliDirs,
    has_resources: hasResources,
    has_manifest: hasManifest,
    stdout: batResult.stdout,
    next_steps: [
      hasManifest ? `Read manifest: ${path.join(path.relative(workRoot, outDir), 'AndroidManifest.xml')}` : null,
      smaliDirs.length > 0 ? `Smali code in: ${smaliDirs.map(d => path.join(path.relative(workRoot, outDir), d)).join(', ')}` : null,
      `Modify files, then rebuild with: apk_rebuild({ path: "${path.relative(workRoot, outDir)}" })`
    ].filter(Boolean)
  };
}

// ─── 2. apk_rebuild ──────────────────────────────────────────────────────────

async function apk_rebuild({ path: decodedDir, output_path, copy_original }) {
  if (!decodedDir) throw new Error('"path" is required (decoded APK directory from apk_decode)');

  const absDir = resolvePath(decodedDir);
  if (!fs.existsSync(absDir)) throw new Error(`Decoded directory not found: ${decodedDir}`);

  const info = workspaceManager.getInfo();
  const workRoot = info.path || process.cwd();
  const dirName = path.basename(absDir);
  const outApk = resolvePath(output_path || `rebuilt/${dirName}_rebuilt.apk`);
  ensureDir(path.dirname(outApk));

  const result = await runTool(`apktool b "${absDir}" -o "${outApk}"`, { timeout: 300000, cwd: workRoot });

  if (!result.ok) {
    return {
      error: 'apktool rebuild failed',
      stderr: result.stderr,
      tip: 'Common issues: syntax error in smali file, missing resources, or apktool version mismatch'
    };
  }

  const stat = fs.existsSync(outApk) ? fs.statSync(outApk) : null;
  return {
    success: true,
    output_apk: path.relative(workRoot, outApk),
    output_apk_abs: outApk,
    output_size: stat ? humanSize(stat.size) : 'unknown',
    stdout: result.stdout,
    next_step: `Sign the APK: apk_sign({ path: "${path.relative(workRoot, outApk)}" })`
  };
}

// ─── 3. apk_sign ─────────────────────────────────────────────────────────────

async function apk_sign({ path: apkPath, keystore_path, keystore_pass, key_alias, key_pass, output_path, use_debug_key = true }) {
  if (!apkPath) throw new Error('"path" is required (path to unsigned APK)');

  const absApk = resolvePath(apkPath);
  const info = workspaceManager.getInfo();
  const workRoot = info.path || process.cwd();
  const java = getJava();
  const javaHome = path.dirname(path.dirname(findTool(['java']) || ''));

  // Output path for signed APK
  const baseName = path.basename(absApk, '.apk');
  const absOut = resolvePath(output_path || path.join(path.dirname(apkPath), `${baseName}_signed.apk`));
  ensureDir(path.dirname(absOut));

  if (use_debug_key || !keystore_path) {
    // Generate/use a debug keystore (safe for testing/research)
    const debugKs = path.join(os.homedir(), '.android', 'debug.keystore');

    // Create debug keystore if missing
    if (!fs.existsSync(debugKs)) {
      ensureDir(path.join(os.homedir(), '.android'));
      const keytool = findTool(['keytool']) || path.join(javaHome, 'bin', 'keytool');
      await runTool(`"${keytool}" -genkey -v -keystore "${debugKs}" -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"`, { timeout: 30000 });
    }

    // apksigner (preferred) or jarsigner fallback
    const apksigner = findTool(['apksigner', 'apksigner.bat']);
    if (apksigner) {
      const r = await runTool(`"${apksigner}" sign --ks "${debugKs}" --ks-pass pass:android --key-pass pass:android --out "${absOut}" "${absApk}"`, { timeout: 60000 });
      if (!r.ok) return { error: 'apksigner failed', stderr: r.stderr };
    } else {
      const jarsigner = findTool(['jarsigner']) || path.join(javaHome, 'bin', 'jarsigner');
      const r = await runTool(`"${jarsigner}" -verbose -sigalg SHA256withRSA -digestalg SHA-256 -keystore "${debugKs}" -storepass android -keypass android "${absApk}" androiddebugkey`, { timeout: 60000 });
      if (!r.ok) return { error: 'jarsigner failed', stderr: r.stderr };
      // jarsigner signs in-place; copy to output
      fs.copyFileSync(absApk, absOut);
    }

    return {
      success: true,
      signed_apk: path.relative(workRoot, absOut),
      keystore: debugKs,
      key_alias: 'androiddebugkey',
      type: 'debug',
      note: 'Signed with debug key. For release, provide keystore_path, keystore_pass, key_alias, key_pass.'
    };
  }

  // Custom keystore signing
  const absKs = resolvePath(keystore_path);
  const alias = key_alias || 'key0';
  const ksPass = keystore_pass || 'android';
  const kPass = key_pass || ksPass;

  const apksigner = findTool(['apksigner', 'apksigner.bat']);
  if (apksigner) {
    const r = await runTool(`"${apksigner}" sign --ks "${absKs}" --ks-pass pass:${ksPass} --key-pass pass:${kPass} --ks-key-alias "${alias}" --out "${absOut}" "${absApk}"`, { timeout: 60000 });
    if (!r.ok) return { error: 'apksigner failed', stderr: r.stderr };
  } else {
    const jarsigner = findTool(['jarsigner']) || path.join(javaHome, 'bin', 'jarsigner');
    const r = await runTool(`"${jarsigner}" -verbose -sigalg SHA256withRSA -digestalg SHA-256 -keystore "${absKs}" -storepass "${ksPass}" -keypass "${kPass}" "${absApk}" "${alias}"`, { timeout: 60000 });
    if (!r.ok) return { error: 'jarsigner failed', stderr: r.stderr };
    fs.copyFileSync(absApk, absOut);
  }

  return {
    success: true,
    signed_apk: path.relative(workRoot, absOut),
    keystore: keystore_path,
    key_alias: alias
  };
}

// ─── 4. apk_info ─────────────────────────────────────────────────────────────

async function apk_info({ path: apkPath }) {
  if (!apkPath) throw new Error('"path" is required');
  const absApk = resolvePath(apkPath);
  if (!fs.existsSync(absApk)) throw new Error(`File not found: ${apkPath}`);

  const stat = fs.statSync(absApk);
  const info = workspaceManager.getInfo();
  const workRoot = info.path || process.cwd();

  // Try aapt2 or aapt for manifest dump
  const aapt = findTool(['aapt2', 'aapt']);
  if (aapt) {
    const dumpResult = await runTool(`"${aapt}" dump badging "${absApk}"`, { timeout: 30000 });
    if (dumpResult.ok) {
      const lines = dumpResult.stdout.split('\n');
      const pkg = (lines.find(l => l.startsWith('package:')) || '').match(/name='([^']+)'/)?.[1];
      const versionCode = (lines.find(l => l.startsWith('package:')) || '').match(/versionCode='([^']+)'/)?.[1];
      const versionName = (lines.find(l => l.startsWith('package:')) || '').match(/versionName='([^']+)'/)?.[1];
      const sdkVersion = (lines.find(l => l.startsWith('sdkVersion:')) || '').split("'")?.[1];
      const targetSdk = (lines.find(l => l.startsWith('targetSdkVersion:')) || '').split("'")?.[1];
      const perms = lines.filter(l => l.startsWith('uses-permission:')).map(l => l.match(/name='([^']+)'/)?.[1]).filter(Boolean);
      const activities = lines.filter(l => l.startsWith('launchable-activity:')).map(l => l.match(/name='([^']+)'/)?.[1]).filter(Boolean);

      return {
        file: apkPath,
        file_size: humanSize(stat.size),
        package_name: pkg,
        version_code: versionCode,
        version_name: versionName,
        min_sdk: sdkVersion,
        target_sdk: targetSdk,
        permissions: perms,
        launchable_activities: activities,
        source: 'aapt'
      };
    }
  }

  // Fallback: unzip and parse AndroidManifest.xml (binary XML — basic parse)
  const tmpDir = path.join(os.tmpdir(), 'omnidev_apkinfo_' + Date.now());
  ensureDir(tmpDir);

  const java = getJava();
  // Use apktool to get manifest only
  const apktoolResult = await runTool(`apktool d -s -r "${absApk}" -o "${tmpDir}"`, { timeout: 60000 });

  let manifestContent = null;
  const manifestPath = path.join(tmpDir, 'AndroidManifest.xml');
  if (fs.existsSync(manifestPath)) {
    manifestContent = fs.readFileSync(manifestPath, 'utf8');
  }

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

  if (!manifestContent) {
    return { file: apkPath, file_size: humanSize(stat.size), error: 'Could not parse APK. Install aapt or apktool.', source: 'none' };
  }

  // Parse key fields from XML string
  const pkg = manifestContent.match(/package="([^"]+)"/)?.[1];
  const versionCode = manifestContent.match(/android:versionCode="([^"]+)"/)?.[1];
  const versionName = manifestContent.match(/android:versionName="([^"]+)"/)?.[1];
  const minSdk = manifestContent.match(/android:minSdkVersion="([^"]+)"/)?.[1];
  const targetSdk = manifestContent.match(/android:targetSdkVersion="([^"]+)"/)?.[1];
  const perms = [...manifestContent.matchAll(/uses-permission[^>]+android:name="([^"]+)"/g)].map(m => m[1]);
  const activities = [...manifestContent.matchAll(/<activity[^>]+android:name="([^"]+)"/g)].map(m => m[1]);

  return {
    file: apkPath,
    file_size: humanSize(stat.size),
    package_name: pkg,
    version_code: versionCode,
    version_name: versionName,
    min_sdk: minSdk,
    target_sdk: targetSdk,
    permissions: perms,
    activities: activities,
    manifest_snippet: manifestContent.slice(0, 2000),
    source: 'apktool'
  };
}

// ─── 5. jadx_decompile ───────────────────────────────────────────────────────

async function jadx_decompile({ path: inputPath, output_dir, decompile_resources = true, show_bad_code = true }) {
  if (!inputPath) throw new Error('"path" is required (APK, JAR, DEX, or AAR file)');

  const absInput = resolvePath(inputPath);
  if (!fs.existsSync(absInput)) throw new Error(`File not found: ${inputPath}`);

  const info = workspaceManager.getInfo();
  const workRoot = info.path || process.cwd();
  const baseName = path.basename(absInput).replace(/\.[^.]+$/, '');
  const absOut = resolvePath(output_dir || `decompiled/${baseName}_java`);
  ensureDir(absOut);

  const jadx = findTool(['jadx', 'jadx.bat']);
  if (!jadx) {
    return {
      error: 'jadx not found on PATH',
      install_hint: 'Download from: https://github.com/skylot/jadx/releases\nExtract and add bin/ to PATH, or use: install_re_tool({ tool: "jadx" })',
      output_dir: null
    };
  }

  const flags = [
    decompile_resources ? '' : '--no-res',
    show_bad_code ? '--show-bad-code' : ''
  ].filter(Boolean).join(' ');

  const result = await runTool(`"${jadx}" ${flags} -d "${absOut}" "${absInput}"`, { timeout: 300000 });

  // Count decompiled Java files
  let javaFileCount = 0;
  if (fs.existsSync(absOut)) {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(dir, entry.name));
        else if (entry.name.endsWith('.java')) javaFileCount++;
      }
    };
    try { walk(absOut); } catch (_) {}
  }

  return {
    success: result.ok || javaFileCount > 0,
    input: inputPath,
    output_dir: path.relative(workRoot, absOut),
    java_files_decompiled: javaFileCount,
    stdout: result.stdout.slice(-2000),
    stderr: result.ok ? undefined : result.stderr.slice(-1000),
    next_step: javaFileCount > 0 ? `Browse decompiled code in: ${path.relative(workRoot, absOut)}` : 'Check stderr for jadx errors'
  };
}

// ─── 6. jar_extract ──────────────────────────────────────────────────────────

async function jar_extract({ path: jarPath, output_dir }) {
  if (!jarPath) throw new Error('"path" is required');
  const absJar = resolvePath(jarPath);
  if (!fs.existsSync(absJar)) throw new Error(`File not found: ${jarPath}`);

  const info = workspaceManager.getInfo();
  const workRoot = info.path || process.cwd();
  const baseName = path.basename(absJar).replace(/\.[^.]+$/, '');
  const absOut = resolvePath(output_dir || `extracted/${baseName}`);
  ensureDir(absOut);

  const java = getJava();
  // Try jar command
  const jarTool = findTool(['jar']) || path.join(path.dirname(java), 'jar');
  let result = await runTool(`"${jarTool}" xf "${absJar}"`, { timeout: 60000, cwd: absOut });

  if (!result.ok) {
    // Fallback: use PowerShell Expand-Archive (works for ZIP/JAR)
    result = await runTool(`powershell -Command "Expand-Archive -Path '${absJar}' -DestinationPath '${absOut}' -Force"`, { timeout: 60000 });
  }

  if (!result.ok) {
    return { error: 'Extraction failed', stderr: result.stderr };
  }

  // List extracted contents (top-level)
  const contents = fs.readdirSync(absOut);
  return {
    success: true,
    input: jarPath,
    output_dir: path.relative(workRoot, absOut),
    extracted_entries: contents.length,
    top_level: contents.slice(0, 50),
    next_step: `Browse/modify files in ${path.relative(workRoot, absOut)}, then rebuild with jar_rebuild`
  };
}

// ─── 7. jar_rebuild ──────────────────────────────────────────────────────────

async function jar_rebuild({ path: sourceDir, output_path, manifest_path }) {
  if (!sourceDir) throw new Error('"path" is required (directory to pack)');
  const absDir = resolvePath(sourceDir);
  if (!fs.existsSync(absDir)) throw new Error(`Directory not found: ${sourceDir}`);

  const info = workspaceManager.getInfo();
  const workRoot = info.path || process.cwd();
  const dirName = path.basename(absDir);
  const absOut = resolvePath(output_path || `rebuilt/${dirName}.jar`);
  ensureDir(path.dirname(absOut));

  const java = getJava();
  const jarTool = findTool(['jar']) || path.join(path.dirname(java), 'jar');

  const mfFlag = manifest_path ? `mf "${resolvePath(manifest_path)}"` : 'cf';
  const result = await runTool(`"${jarTool}" ${mfFlag} "${absOut}" -C "${absDir}" .`, { timeout: 120000 });

  if (!result.ok) {
    // PowerShell ZIP fallback
    const psResult = await runTool(
      `powershell -Command "Compress-Archive -Path '${absDir}\\*' -DestinationPath '${absOut}' -Force"`,
      { timeout: 60000 }
    );
    if (!psResult.ok) return { error: 'Rebuild failed', stderr: result.stderr };
    const stat2 = fs.statSync(absOut);
    return { success: true, output: path.relative(workRoot, absOut), size: humanSize(stat2.size), method: 'powershell-zip' };
  }

  const stat = fs.existsSync(absOut) ? fs.statSync(absOut) : null;
  return {
    success: true,
    output: path.relative(workRoot, absOut),
    size: stat ? humanSize(stat.size) : 'unknown',
    method: 'jar'
  };
}

// ─── 8. java_compile ─────────────────────────────────────────────────────────

async function java_compile({ source_path, output_dir, classpath, source_version, target_version }) {
  if (!source_path) throw new Error('"source_path" is required (.java file or directory)');

  const absSource = resolvePath(source_path);
  const info = workspaceManager.getInfo();
  const workRoot = info.path || process.cwd();
  const absOut = resolvePath(output_dir || 'compiled/classes');
  ensureDir(absOut);

  const javac = getJavac();
  const cpFlag = classpath ? `-cp "${classpath}"` : '';
  const srcFlag = source_version ? `-source ${source_version}` : '';
  const tgtFlag = target_version ? `-target ${target_version}` : '';

  // Collect .java files
  let sources = '';
  if (fs.statSync(absSource).isDirectory()) {
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.java')) files.push(`"${p}"`);
      }
    };
    walk(absSource);
    sources = files.join(' ');
  } else {
    sources = `"${absSource}"`;
  }

  if (!sources) return { error: 'No .java files found in source_path' };

  const cmd = `"${javac}" ${cpFlag} ${srcFlag} ${tgtFlag} -d "${absOut}" ${sources}`;
  const result = await runTool(cmd, { timeout: 120000, cwd: workRoot });

  // Count compiled .class files
  let classCount = 0;
  if (fs.existsSync(absOut)) {
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(dir, e.name));
        else if (e.name.endsWith('.class')) classCount++;
      }
    };
    try { walk(absOut); } catch (_) {}
  }

  return {
    success: result.ok,
    output_dir: path.relative(workRoot, absOut),
    classes_compiled: classCount,
    stdout: result.stdout,
    stderr: result.stderr || undefined,
    errors: !result.ok ? result.stderr : undefined,
    next_step: result.ok ? `Package into JAR: jar_rebuild({ path: "${path.relative(workRoot, absOut)}" })` : 'Fix compilation errors above'
  };
}

// ─── 9. dotnet_decompile ─────────────────────────────────────────────────────

async function dotnet_decompile({ path: inputPath, output_dir, tool }) {
  if (!inputPath) throw new Error('"path" is required (.exe or .dll file)');
  const absInput = resolvePath(inputPath);
  if (!fs.existsSync(absInput)) throw new Error(`File not found: ${inputPath}`);

  const info = workspaceManager.getInfo();
  const workRoot = info.path || process.cwd();
  const baseName = path.basename(absInput).replace(/\.[^.]+$/, '');
  const absOut = resolvePath(output_dir || `decompiled/${baseName}_dotnet`);
  ensureDir(absOut);

  // Try ilspycmd
  const ilspy = findTool(['ilspycmd', 'ilspycmd.exe']);
  if (ilspy || tool === 'ilspycmd') {
    if (!ilspy) {
      return {
        error: 'ilspycmd not found',
        install_hint: 'dotnet tool install -g ilspycmd',
        alternative: 'Use install_re_tool({ tool: "ilspycmd" }) to install it'
      };
    }
    const result = await runTool(`"${ilspy}" "${absInput}" -p -o "${absOut}"`, { timeout: 180000 });
    const csFiles = [];
    if (fs.existsSync(absOut)) {
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) walk(path.join(dir, e.name));
          else if (e.name.endsWith('.cs')) csFiles.push(path.relative(workRoot, path.join(dir, e.name)));
        }
      };
      try { walk(absOut); } catch (_) {}
    }
    return { success: result.ok || csFiles.length > 0, output_dir: path.relative(workRoot, absOut), cs_files: csFiles.length, files: csFiles.slice(0, 50), stdout: result.stdout, stderr: result.ok ? undefined : result.stderr };
  }

  // Try dotnet-csc / roslyn approach via dotnet
  const dotnet = findTool(['dotnet']);
  if (dotnet) {
    const checkResult = await runTool(`"${dotnet}" tool list -g`, { timeout: 10000 });
    const hasIlspy = checkResult.stdout.includes('ilspycmd');
    if (!hasIlspy) {
      return {
        error: 'ilspycmd not installed as dotnet global tool',
        install_hint: `Run: dotnet tool install -g ilspycmd\nOr use: install_re_tool({ tool: "ilspycmd" })`,
        dotnet_tools: checkResult.stdout
      };
    }
    const ilspyResult = await runTool(`ilspycmd "${absInput}" -p -o "${absOut}"`, { timeout: 180000 });
    return { success: ilspyResult.ok, output_dir: path.relative(workRoot, absOut), stdout: ilspyResult.stdout, stderr: ilspyResult.stderr };
  }

  return {
    error: 'No .NET decompiler found (ilspycmd or dotnet required)',
    install_hint: '1. Install .NET SDK: https://dotnet.microsoft.com/download\n2. Run: dotnet tool install -g ilspycmd',
    input: inputPath
  };
}

// ─── 10. patch_binary ────────────────────────────────────────────────────────

async function patch_binary({ path: filePath, patches, output_path, backup = true }) {
  if (!filePath) throw new Error('"path" is required');
  if (!patches || !Array.isArray(patches) || patches.length === 0) {
    throw new Error('"patches" is required: array of { offset, bytes } objects');
  }

  const absIn = resolvePath(filePath);
  if (!fs.existsSync(absIn)) throw new Error(`File not found: ${filePath}`);

  const info = workspaceManager.getInfo();
  const workRoot = info.path || process.cwd();

  // Backup original
  if (backup) {
    const backupPath = absIn + '.bak.' + Date.now();
    fs.copyFileSync(absIn, backupPath);
  }

  // Output file
  const absOut = output_path ? resolvePath(output_path) : absIn;
  if (absOut !== absIn) {
    fs.copyFileSync(absIn, absOut);
  }

  // Read the file
  let buf = readFileGuarded(absOut, 512 * 1024 * 1024);
  const applied = [];
  const errors = [];

  for (const patch of patches) {
    const { offset, bytes, comment } = patch;
    const off = typeof offset === 'string' ? parseInt(offset.replace('0x', ''), 16) : Number(offset);
    const patchBytes = Buffer.from(bytes.replace(/\s+/g, ''), 'hex');

    if (off < 0 || off + patchBytes.length > buf.length) {
      errors.push({ offset: `0x${off.toString(16)}`, error: 'Offset out of range', bytes });
      continue;
    }

    // Record original bytes before patching
    const originalBytes = buf.slice(off, off + patchBytes.length).toString('hex');
    patchBytes.copy(buf, off);

    applied.push({
      offset: `0x${off.toString(16)}`,
      original_bytes: originalBytes.replace(/(.{2})/g, '$1 ').trim(),
      patched_bytes: bytes,
      comment: comment || undefined
    });
  }

  // Write patched file
  fs.writeFileSync(absOut, buf);

  return {
    success: errors.length === 0,
    input: filePath,
    output: output_path ? path.relative(workRoot, absOut) : filePath,
    patches_applied: applied.length,
    patches_failed: errors.length,
    applied,
    errors: errors.length > 0 ? errors : undefined,
    backup: backup ? `${filePath}.bak.<timestamp>` : undefined,
    note: 'Patches applied directly to binary bytes. Verify with hex_dump to confirm.'
  };
}

// ─── 11. extract_section ─────────────────────────────────────────────────────

async function extract_section({ path: filePath, section_name, output_path }) {
  if (!filePath) throw new Error('"path" is required');
  if (!section_name) throw new Error('"section_name" is required (e.g. ".text", ".data", "res")');

  const absIn = resolvePath(filePath);
  if (!fs.existsSync(absIn)) throw new Error(`File not found: ${filePath}`);

  const info = workspaceManager.getInfo();
  const workRoot = info.path || process.cwd();
  const buf = readFileGuarded(absIn, 512 * 1024 * 1024);

  // Try PE section extraction
  if (buf[0] === 0x4d && buf[1] === 0x5a) {
    const peOffset = buf.readUInt32LE(0x3c);
    if (peOffset + 24 > buf.length) return { error: 'Invalid PE' };
    const optHeaderSize = buf.readUInt16LE(peOffset + 20);
    const numSections = buf.readUInt16LE(peOffset + 6);
    const sectionsOffset = peOffset + 24 + optHeaderSize;

    for (let i = 0; i < Math.min(numSections, 32); i++) {
      const sOff = sectionsOffset + i * 40;
      if (sOff + 40 > buf.length) break;
      const name = buf.toString('ascii', sOff, sOff + 8).replace(/\0/g, '');
      if (name === section_name || name.replace(/^\./, '') === section_name.replace(/^\./, '')) {
        const rawOffset = buf.readUInt32LE(sOff + 20);
        const rawSize = buf.readUInt32LE(sOff + 16);
        const sectionData = buf.slice(rawOffset, rawOffset + rawSize);

        const baseName = path.basename(absIn) + '_' + section_name.replace('.', '') + '.bin';
        const absOut = resolvePath(output_path || `extracted/${baseName}`);
        ensureDir(path.dirname(absOut));
        fs.writeFileSync(absOut, sectionData);

        return {
          success: true,
          section: name,
          raw_offset: `0x${rawOffset.toString(16)}`,
          raw_size: rawSize,
          output: path.relative(workRoot, absOut),
          entropy: (() => {
            const freq = new Array(256).fill(0);
            for (const b of sectionData) freq[b]++;
            let e = 0;
            for (const f of freq) { if (f) { const p = f / sectionData.length; e -= p * Math.log2(p); } }
            return parseFloat(e.toFixed(4));
          })()
        };
      }
    }
    return { error: `Section "${section_name}" not found in PE`, available_sections: (() => {
      const secs = [];
      for (let i = 0; i < Math.min(numSections, 32); i++) {
        const sOff = sectionsOffset + i * 40;
        secs.push(buf.toString('ascii', sOff, sOff + 8).replace(/\0/g, ''));
      }
      return secs;
    })() };
  }

  return { error: 'Currently only PE section extraction is supported. ELF support coming soon.', file: filePath };
}

// ─── 12. unminify_js ─────────────────────────────────────────────────────────

async function unminify_js({ path: filePath, output_path }) {
  if (!filePath) throw new Error('"path" is required');
  const absIn = resolvePath(filePath);
  if (!fs.existsSync(absIn)) throw new Error(`File not found: ${filePath}`);

  const info = workspaceManager.getInfo();
  const workRoot = info.path || process.cwd();
  const baseName = path.basename(absIn, '.js');
  const absOut = resolvePath(output_path || path.join(path.dirname(filePath), `${baseName}.unmin.js`));
  ensureDir(path.dirname(absOut));

  // Try prettier
  const prettier = findTool(['prettier', 'prettier.cmd']);
  if (prettier) {
    const r = await runTool(`"${prettier}" --write --parser babel "${absIn}"`, { timeout: 30000 });
    if (r.ok) {
      fs.copyFileSync(absIn, absOut);
      return { success: true, output: path.relative(workRoot, absOut), tool: 'prettier', size_in: humanSize(fs.statSync(absIn).size), size_out: humanSize(fs.statSync(absOut).size) };
    }
  }

  // Try js-beautify via npx
  const npx = findTool(['npx', 'npx.cmd']);
  if (npx) {
    const r = await runTool(`"${npx}" --yes js-beautify -o "${absOut}" "${absIn}"`, { timeout: 60000 });
    if (r.ok) {
      return { success: true, output: path.relative(workRoot, absOut), tool: 'js-beautify (npx)' };
    }
  }

  // Manual basic unminify: add newlines after ;, {, }
  let code = readFileGuarded(absIn, 64 * 1024 * 1024, 'utf8');
  let indent = 0;
  let result = '';
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '{') { result += ' {\n' + '  '.repeat(++indent); continue; }
    if (c === '}') { result += '\n' + '  '.repeat(--indent < 0 ? (indent = 0) : indent) + '}'; if (code[i + 1] !== ';') result += '\n' + '  '.repeat(indent); continue; }
    if (c === ';') { result += ';\n' + '  '.repeat(indent); continue; }
    result += c;
  }
  fs.writeFileSync(absOut, result, 'utf8');

  return {
    success: true,
    output: path.relative(workRoot, absOut),
    tool: 'builtin-basic',
    note: 'Basic unminify only. For better results install prettier: npm install -g prettier'
  };
}

// ─── 13. smali_patch ─────────────────────────────────────────────────────────

async function smali_patch({ decoded_dir, find, replace, file_pattern, dry_run = false }) {
  if (!decoded_dir) throw new Error('"decoded_dir" is required (apk_decode output directory)');
  if (!find) throw new Error('"find" is required (string to search for in smali files)');
  if (replace === undefined) throw new Error('"replace" is required (replacement string)');

  const absDir = resolvePath(decoded_dir);
  if (!fs.existsSync(absDir)) throw new Error(`Directory not found: ${decoded_dir}`);

  const info = workspaceManager.getInfo();
  const workRoot = info.path || process.cwd();
  const pattern = new RegExp(file_pattern || '\\.smali$');

  const changed = [];
  const unchanged = [];
  let totalMatches = 0;

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (pattern.test(entry.name)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        const matches = (content.match(new RegExp(escapeRe(find), 'g')) || []).length;
        if (matches > 0) {
          totalMatches += matches;
          if (!dry_run) {
            const patched = content.split(find).join(replace);
            fs.writeFileSync(fullPath, patched, 'utf8');
          }
          changed.push({ file: path.relative(workRoot, fullPath), matches });
        }
      }
    }
  };

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  walk(absDir);

  return {
    dry_run,
    find,
    replace: dry_run ? '(not applied)' : replace,
    files_changed: changed.length,
    total_matches: totalMatches,
    changed_files: changed.slice(0, 100),
    next_step: dry_run ? 'Remove dry_run:true to apply patches, then rebuild with apk_rebuild' : `Rebuild APK: apk_rebuild({ path: "${decoded_dir}" })`
  };
}

// ─── 14. install_re_tool ─────────────────────────────────────────────────────

async function install_re_tool({ tool }) {
  if (!tool) throw new Error('"tool" is required');

  const installMap = {
    jadx: {
      desc: 'JADX — Dex to Java decompiler (Android/APK/JAR)',
      manual: 'Download from https://github.com/skylot/jadx/releases\nExtract and add bin/ folder to PATH',
      winget: 'winget install skylot.jadx',
      scoop: 'scoop install jadx',
      check: 'jadx --version'
    },
    apktool: {
      desc: 'APKTool — APK disassembler/rebuilder',
      manual: 'Download from https://apktool.org/\n1. Download apktool.bat and apktool.jar\n2. Place both in C:\\Windows\\ or any PATH folder',
      winget: 'winget install REAndroid.APKTool',
      check: 'apktool --version'
    },
    ilspycmd: {
      desc: 'ILSpy command-line — .NET decompiler',
      dotnet: 'dotnet tool install -g ilspycmd',
      check: 'ilspycmd --version'
    },
    yara: {
      desc: 'YARA — Pattern matching for malware research',
      winget: 'winget install VirusTotal.YARA',
      manual: 'Download from https://virustotal.github.io/yara/',
      check: 'yara --version'
    },
    radare2: {
      desc: 'radare2 — Reverse engineering framework',
      winget: 'winget install radareorg.radare2',
      scoop: 'scoop install radare2',
      manual: 'https://rada.re/n/radare2.html',
      check: 'r2 --version'
    },
    ghidra: {
      desc: 'Ghidra — NSA reverse engineering suite',
      manual: 'Download from https://ghidra-sre.org/\nExtract and run ghidraRun.bat',
      check: 'ghidraRun --version'
    },
    frida: {
      desc: 'Frida — Dynamic instrumentation toolkit',
      pip: 'pip install frida-tools',
      npm: 'npm install -g frida',
      check: 'frida --version'
    },
    objdump: {
      desc: 'objdump — GNU binutils disassembler',
      winget: 'winget install GnuWin32.Binutils',
      scoop: 'scoop install binutils',
      check: 'objdump --version'
    },
    adb: {
      desc: 'Android Debug Bridge',
      winget: 'winget install Google.AndroidStudio',
      manual: 'Install Android SDK Platform-Tools from https://developer.android.com/tools/releases/platform-tools',
      check: 'adb version'
    },
    prettier: {
      desc: 'Prettier — JS/CSS/HTML formatter (useful for unminifying)',
      npm: 'npm install -g prettier',
      check: 'prettier --version'
    }
  };

  const toolName = tool.toLowerCase();
  const info = installMap[toolName];
  if (!info) {
    return {
      error: `Unknown tool: ${tool}`,
      known_tools: Object.keys(installMap),
      tip: 'Use run_command to manually install any tool not in this list'
    };
  }

  // Check if already installed
  if (info.check) {
    // Prefer checking binary existence first to avoid interactive pauses in batch files
    const binaryName = info.check.split(' ')[0];
    const exists = findTool([binaryName, `${binaryName}.bat`, `${binaryName}.exe`, `${binaryName}.jar`]);
    if (exists) {
      return {
        already_installed: true,
        tool,
        description: info.desc,
        location: exists
      };
    }

    const checkResult = await runTool(info.check, { timeout: 4000 });
    if (checkResult.ok) {
      return {
        already_installed: true,
        tool,
        description: info.desc,
        version: checkResult.stdout.split('\n')[0]
      };
    }
  }

  // Auto-install if dotnet tool
  if (info.dotnet && findTool(['dotnet'])) {
    const r = await runTool(info.dotnet, { timeout: 60000 });
    if (r.ok) {
      return { success: true, tool, description: info.desc, method: 'dotnet tool', output: r.stdout };
    }
  }

  // Auto-install npm tools
  if (info.npm) {
    const npm = findTool(['npm', 'npm.cmd']);
    if (npm) {
      const r = await runTool(`"${npm}" install -g ${info.npm.replace('npm install -g ', '')}`, { timeout: 60000 });
      if (r.ok) {
        return { success: true, tool, description: info.desc, method: 'npm', output: r.stdout };
      }
    }
  }

  // Manual install instructions
  return {
    success: false,
    tool,
    description: info.desc,
    not_auto_installed: true,
    install_options: {
      winget: info.winget,
      scoop: info.scoop,
      manual: info.manual,
      dotnet: info.dotnet,
      pip: info.pip,
      npm: info.npm
    },
    tip: `Use run_command to execute the install command above. Example: run_command({ command: "${info.winget || info.scoop || info.dotnet || 'install manually'}" })`
  };
}

// ─── 15. run_r2 ──────────────────────────────────────────────────────────────

async function run_r2({ path: filePath, commands, write_mode = false }) {
  if (!filePath) throw new Error('"path" is required');
  if (!commands) throw new Error('"commands" is required (r2 command string, e.g. "aaa; pdf @ main")');

  const r2 = findTool(['radare2', 'r2', 'r2.exe']);
  if (!r2) {
    return {
      error: 'radare2 not found on PATH',
      install_hint: 'winget install radareorg.radare2  |  or: install_re_tool({ tool: "radare2" })'
    };
  }

  const absPath = resolvePath(filePath);
  if (!fs.existsSync(absPath)) throw new Error(`File not found: ${filePath}`);

  const wFlag = write_mode ? '-w' : '';
  // Build r2 command: pipe commands via -c
  const cmds = Array.isArray(commands) ? commands.join('; ') : commands;
  const result = await runTool(`"${r2}" ${wFlag} -q -c "${cmds.replace(/"/g, '\\"')}" "${absPath}"`, { timeout: 60000 });

  return {
    file: filePath,
    commands: cmds,
    write_mode,
    output: result.stdout,
    stderr: result.stderr || undefined,
    success: result.ok
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  apk_decode,
  apk_rebuild,
  apk_sign,
  apk_info,
  jadx_decompile,
  jar_extract,
  jar_rebuild,
  java_compile,
  dotnet_decompile,
  patch_binary,
  extract_section,
  unminify_js,
  smali_patch,
  install_re_tool,
  run_r2
};
