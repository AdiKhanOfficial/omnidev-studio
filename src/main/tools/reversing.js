/**
 * OmniDev Studio — Reverse Engineering & Security Research Tools
 *
 * All tools are implemented in pure Node.js (no extra native deps needed).
 * They also try to call system tools (strings, objdump, dumpbin, readelf)
 * when available, and gracefully fall back to built-in JS implementations.
 *
 * Tools:
 *  strings_extract      - Extract printable strings from any binary
 *  hex_dump             - Hex + ASCII dump of a file section
 *  file_identify        - Identify file format, arch, endianness from magic bytes
 *  entropy_analysis     - Shannon entropy by chunk (detect packed/encrypted regions)
 *  hash_file            - MD5 / SHA1 / SHA256 / SHA512 of a file
 *  pe_info              - Parse PE (Windows EXE/DLL) headers and sections
 *  elf_info             - Parse ELF (Linux) headers
 *  find_pattern         - Search binary for hex / ASCII / regex patterns
 *  xor_bruteforce       - XOR decrypt with all 1-byte keys (classic CTF trick)
 *  decode_payload       - Base64 / Hex / URL / ROT13 decode of any string
 *  checksec_binary      - Check binary security features (NX, PIE, stack canary, RELRO)
 *  disassemble_bytes    - Disassemble a hex-encoded byte sequence (x86/x64 via table)
 *  extract_urls         - Extract URLs, IPs, domains from binary/text
 *  compare_files        - Byte-level diff between two binary files
 *  yara_scan            - Run YARA rules against a file (requires yara CLI)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec, spawnSync } = require('child_process');
const workspaceManager = require('../workspace');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolvePath(relPath) {
  const info = workspaceManager.getInfo();
  const root = info.path || process.cwd();
  const abs = path.isAbsolute(relPath) ? relPath : path.join(root, relPath);
  return abs;
}

function readBinary(relPath, maxBytes = 50 * 1024 * 1024) {
  const abs = resolvePath(relPath);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${relPath}`);
  const stat = fs.statSync(abs);
  const readLen = Math.min(stat.size, maxBytes);
  const fd = fs.openSync(abs, 'r');
  const buf = Buffer.alloc(readLen);
  fs.readSync(fd, buf, 0, readLen, 0);
  fs.closeSync(fd);
  return { buf, size: stat.size, path: abs };
}

// Async, non-blocking: never freezes the main process, always times out,
// and caps output buffer so a chatty tool can't exhaust memory.
function tryExec(cmd, timeoutMs = 10000) {
  return new Promise((resolve) => {
    exec(cmd, {
      timeout: timeoutMs,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      killSignal: 'SIGKILL'
    }, (e, stdout, stderr) => {
      if (e) resolve({ ok: false, out: stdout || '', err: stderr || e.message });
      else resolve({ ok: true, out: stdout || '' });
    });
  });
}

function isPrintable(byte) {
  return byte >= 0x20 && byte <= 0x7e;
}

// ─── 1. strings_extract ──────────────────────────────────────────────────────

async function strings_extract({ path: filePath, min_length = 4, encoding = 'ascii', offset = 0, limit = 2000 }) {
  if (!filePath) throw new Error('"path" is required');
  const { buf, size } = readBinary(filePath, 32 * 1024 * 1024);

  // Try system strings first
  const sysCmd = process.platform === 'win32'
    ? null
    : await tryExec(`strings -n ${min_length} "${resolvePath(filePath)}"`);

  if (sysCmd && sysCmd.ok) {
    const lines = sysCmd.out.split('\n').filter(Boolean);
    return {
      source: 'system:strings',
      file: filePath,
      file_size: size,
      total_found: lines.length,
      strings: lines.slice(0, limit),
      truncated: lines.length > limit
    };
  }

  // Pure JS fallback
  const results = [];
  let run = [];
  const startOffset = Number(offset) || 0;

  for (let i = startOffset; i < buf.length; i++) {
    const b = buf[i];
    if (isPrintable(b)) {
      run.push(String.fromCharCode(b));
    } else {
      if (run.length >= min_length) {
        results.push({ offset: i - run.length, value: run.join('') });
        if (results.length >= limit) break;
      }
      run = [];
    }
  }
  if (run.length >= min_length) {
    results.push({ offset: buf.length - run.length, value: run.join('') });
  }

  return {
    source: 'builtin',
    file: filePath,
    file_size: size,
    total_found: results.length,
    strings: results.slice(0, limit),
    truncated: results.length >= limit,
    note: results.length >= limit ? `Showing first ${limit} strings. Use offset param to continue.` : undefined
  };
}

// ─── 2. hex_dump ─────────────────────────────────────────────────────────────

async function hex_dump({ path: filePath, offset = 0, length = 512, width = 16 }) {
  if (!filePath) throw new Error('"path" is required');
  const start = Number(offset) || 0;
  const len = Math.min(Number(length) || 512, 65536);
  const w = Number(width) || 16;

  const { buf, size } = readBinary(filePath, start + len);
  const slice = buf.slice(start, start + len);

  const lines = [];
  for (let i = 0; i < slice.length; i += w) {
    const row = slice.slice(i, i + w);
    const addrStr = (start + i).toString(16).padStart(8, '0');
    const hexPart = Array.from(row).map(b => b.toString(16).padStart(2, '0')).join(' ').padEnd(w * 3 - 1, ' ');
    const asciiPart = Array.from(row).map(b => isPrintable(b) ? String.fromCharCode(b) : '.').join('');
    lines.push(`${addrStr}  ${hexPart}  |${asciiPart}|`);
  }

  return {
    file: filePath,
    file_size: size,
    offset: start,
    bytes_shown: slice.length,
    hex_dump: lines.join('\n')
  };
}

// ─── 3. file_identify ────────────────────────────────────────────────────────

const MAGIC_SIGNATURES = [
  { magic: [0x4d, 0x5a],                             name: 'PE Executable (Windows EXE/DLL)', ext: '.exe/.dll', arch: 'x86/x64' },
  { magic: [0x7f, 0x45, 0x4c, 0x46],                 name: 'ELF Binary (Linux/Unix)', ext: 'ELF', arch: 'varies' },
  { magic: [0xfe, 0xed, 0xfa, 0xce],                 name: 'Mach-O 32-bit (macOS)', ext: 'Mach-O', arch: 'x86' },
  { magic: [0xfe, 0xed, 0xfa, 0xcf],                 name: 'Mach-O 64-bit (macOS)', ext: 'Mach-O', arch: 'x64' },
  { magic: [0xce, 0xfa, 0xed, 0xfe],                 name: 'Mach-O 32-bit LE (macOS)', ext: 'Mach-O', arch: 'x86' },
  { magic: [0xcf, 0xfa, 0xed, 0xfe],                 name: 'Mach-O 64-bit LE (macOS)', ext: 'Mach-O', arch: 'x64' },
  { magic: [0x50, 0x4b, 0x03, 0x04],                 name: 'ZIP Archive / JAR / APK / DOCX', ext: '.zip/.jar/.apk' },
  { magic: [0x50, 0x4b, 0x05, 0x06],                 name: 'ZIP Archive (empty)', ext: '.zip' },
  { magic: [0x25, 0x50, 0x44, 0x46],                 name: 'PDF Document', ext: '.pdf' },
  { magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a],    name: 'PNG Image', ext: '.png' },
  { magic: [0xff, 0xd8, 0xff],                        name: 'JPEG Image', ext: '.jpg' },
  { magic: [0x47, 0x49, 0x46, 0x38],                 name: 'GIF Image', ext: '.gif' },
  { magic: [0x4d, 0x5a, 0x90, 0x00],                 name: 'PE32 (MZ header)', ext: '.exe' },
  { magic: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07],    name: 'RAR Archive', ext: '.rar' },
  { magic: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],    name: '7-Zip Archive', ext: '.7z' },
  { magic: [0x1f, 0x8b],                              name: 'GZip Compressed Data', ext: '.gz' },
  { magic: [0x42, 0x5a, 0x68],                        name: 'BZip2 Compressed Data', ext: '.bz2' },
  { magic: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1],    name: 'Microsoft OLE2 (DOC/XLS/PPT)', ext: '.doc/.xls/.ppt' },
  { magic: [0x4c, 0x5a, 0x49, 0x50],                 name: 'LZ4 Compressed Data', ext: '.lz4' },
  { magic: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00],    name: 'XZ Compressed Data', ext: '.xz' },
  { magic: [0xca, 0xfe, 0xba, 0xbe],                 name: 'Java Class File / Mach-O FAT', ext: '.class' },
  { magic: [0x64, 0x65, 0x78, 0x0a],                 name: 'Android DEX Bytecode', ext: '.dex' },
  { magic: [0x50, 0x4b, 0x03, 0x04, 0x14],           name: 'APK / JAR Archive (ZIP)', ext: '.apk/.jar' },
  { magic: [0x23, 0x21],                              name: 'Script (Shebang)', ext: 'script' },
  { magic: [0x4d, 0x53, 0x43, 0x46],                 name: 'Microsoft Cabinet File', ext: '.cab' },
  { magic: [0x52, 0x49, 0x46, 0x46],                 name: 'RIFF Container (WAV/AVI)', ext: '.wav/.avi' },
  { magic: [0x00, 0x00, 0x01, 0x00],                 name: 'Windows ICO (Icon)', ext: '.ico' },
  { magic: [0x4f, 0x62, 0x6a, 0x01],                 name: 'Apache Avro Binary', ext: '.avro' },
  { magic: [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65],    name: 'SQLite 3 Database', ext: '.sqlite/.db' },
];

async function file_identify({ path: filePath }) {
  if (!filePath) throw new Error('"path" is required');
  const { buf, size } = readBinary(filePath, 1024);

  // Magic byte matching
  let detected = { name: 'Unknown / Data', ext: '', arch: 'unknown' };
  for (const sig of MAGIC_SIGNATURES) {
    if (sig.magic.every((b, i) => buf[i] === b)) {
      detected = sig;
      break;
    }
  }

  // Extra PE details
  let peDetails = null;
  if (buf[0] === 0x4d && buf[1] === 0x5a) {
    const peOffset = buf.readUInt32LE(0x3c);
    if (peOffset + 6 < buf.length) {
      const machine = buf.readUInt16LE(peOffset + 4);
      const machineMap = {
        0x014c: 'x86 (32-bit)', 0x8664: 'x86-64 (64-bit)',
        0x01c0: 'ARM', 0xaa64: 'ARM64', 0x0200: 'IA-64'
      };
      detected.arch = machineMap[machine] || `machine=0x${machine.toString(16)}`;
      peDetails = { pe_offset: `0x${peOffset.toString(16)}`, machine_code: `0x${machine.toString(16)}`, arch: detected.arch };
    }
  }

  // ELF details
  let elfDetails = null;
  if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
    const bits = buf[4] === 1 ? '32-bit' : '64-bit';
    const endian = buf[5] === 1 ? 'Little Endian' : 'Big Endian';
    const elfTypeMap = { 0: 'None', 1: 'REL (Relocatable)', 2: 'EXEC (Executable)', 3: 'DYN (Shared Object)', 4: 'CORE' };
    const elfMachineMap = { 0x03: 'x86', 0x28: 'ARM', 0x3e: 'x86-64', 0xb7: 'AArch64', 0x08: 'MIPS', 0x14: 'PowerPC' };
    const elfType = buf.readUInt16LE(16);
    const elfMachine = buf.readUInt16LE(18);
    detected.arch = `${bits} ${elfMachineMap[elfMachine] || `machine=0x${elfMachine.toString(16)}`}`;
    elfDetails = { bits, endian, type: elfTypeMap[elfType] || `type=0x${elfType.toString(16)}`, machine: `0x${elfMachine.toString(16)}`, arch: detected.arch };
  }

  // Entropy of first 1KB
  const entropy = calculateEntropy(buf.slice(0, Math.min(buf.length, 1024)));

  // Check if likely text
  const printableCount = Array.from(buf.slice(0, 512)).filter(b => isPrintable(b) || b === 0x09 || b === 0x0a || b === 0x0d).length;
  const isLikelyText = printableCount / Math.min(buf.length, 512) > 0.85;

  return {
    file: filePath,
    file_size: size,
    file_size_human: humanSize(size),
    identified_as: detected.name,
    extension_hint: detected.ext || 'unknown',
    architecture: detected.arch || 'unknown',
    entropy_first_1kb: entropy.toFixed(4),
    entropy_note: entropy > 7.0 ? 'High entropy — likely packed, encrypted, or compressed' : entropy > 5.5 ? 'Medium entropy' : 'Low entropy — likely plaintext or structured data',
    likely_text: isLikelyText,
    magic_bytes: Array.from(buf.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' '),
    pe_details: peDetails,
    elf_details: elfDetails
  };
}

// ─── 4. entropy_analysis ─────────────────────────────────────────────────────

function calculateEntropy(buf) {
  if (buf.length === 0) return 0;
  const freq = new Array(256).fill(0);
  for (const b of buf) freq[b]++;
  let entropy = 0;
  for (const f of freq) {
    if (f === 0) continue;
    const p = f / buf.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function entropy_analysis({ path: filePath, chunk_size = 256 }) {
  if (!filePath) throw new Error('"path" is required');
  const chunkBytes = Math.max(64, Math.min(Number(chunk_size) || 256, 65536));
  const { buf, size } = readBinary(filePath, 10 * 1024 * 1024);

  const chunks = [];
  for (let i = 0; i < buf.length; i += chunkBytes) {
    const chunk = buf.slice(i, i + chunkBytes);
    const e = calculateEntropy(chunk);
    chunks.push({
      offset: `0x${i.toString(16)}`,
      offset_dec: i,
      entropy: parseFloat(e.toFixed(4)),
      flag: e > 7.2 ? 'ENCRYPTED/PACKED' : e > 6.0 ? 'COMPRESSED' : e > 4.0 ? 'CODE/DATA' : 'PLAINTEXT/STRUCTURED'
    });
  }

  const values = chunks.map(c => c.entropy);
  const avgEntropy = values.reduce((a, b) => a + b, 0) / values.length;
  const maxEntropy = Math.max(...values);
  const minEntropy = Math.min(...values);

  const highEntropyRegions = chunks.filter(c => c.entropy > 7.0);

  return {
    file: filePath,
    file_size: size,
    file_size_human: humanSize(size),
    chunk_size: chunkBytes,
    total_chunks: chunks.length,
    average_entropy: parseFloat(avgEntropy.toFixed(4)),
    max_entropy: parseFloat(maxEntropy.toFixed(4)),
    min_entropy: parseFloat(minEntropy.toFixed(4)),
    packed_or_encrypted: avgEntropy > 6.8,
    high_entropy_regions: highEntropyRegions.slice(0, 20),
    all_chunks: chunks.slice(0, 200),
    summary: avgEntropy > 6.8
      ? 'Binary appears packed, encrypted, or compressed (high average entropy)'
      : avgEntropy > 4.5
      ? 'Mixed entropy — likely standard compiled binary with code/data sections'
      : 'Low entropy — likely plaintext, structured data, or mostly zeros'
  };
}

// ─── 5. hash_file ────────────────────────────────────────────────────────────

async function hash_file({ path: filePath, algorithms = ['md5', 'sha1', 'sha256'] }) {
  if (!filePath) throw new Error('"path" is required');
  const abs = resolvePath(filePath);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${filePath}`);

  const stat = fs.statSync(abs);
  const algos = Array.isArray(algorithms) ? algorithms : [algorithms];
  const results = {};

  for (const algo of algos) {
    const hash = crypto.createHash(algo.toLowerCase());
    const stream = fs.createReadStream(abs);
    await new Promise((resolve, reject) => {
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    results[algo.toLowerCase()] = hash.digest('hex');
  }

  return {
    file: filePath,
    file_size: stat.size,
    file_size_human: humanSize(stat.size),
    hashes: results,
    // VirusTotal quick-link (SHA256)
    virustotal_link: results.sha256
      ? `https://www.virustotal.com/gui/file/${results.sha256}`
      : undefined
  };
}

// ─── 6. pe_info ──────────────────────────────────────────────────────────────

async function pe_info({ path: filePath }) {
  if (!filePath) throw new Error('"path" is required');
  const { buf, size } = readBinary(filePath, 2 * 1024 * 1024);

  if (buf[0] !== 0x4d || buf[1] !== 0x5a) {
    return { error: 'Not a PE file (missing MZ magic bytes)', file: filePath };
  }

  const peOffset = buf.readUInt32LE(0x3c);
  if (peOffset + 24 > buf.length) {
    return { error: 'PE header offset out of range', file: filePath };
  }

  const peSig = buf.toString('ascii', peOffset, peOffset + 4);
  if (peSig !== 'PE\0\0') {
    return { error: `Invalid PE signature at 0x${peOffset.toString(16)}: ${peSig}`, file: filePath };
  }

  // COFF header
  const machine = buf.readUInt16LE(peOffset + 4);
  const numSections = buf.readUInt16LE(peOffset + 6);
  const timeDateStamp = buf.readUInt32LE(peOffset + 8);
  const characteristics = buf.readUInt16LE(peOffset + 22);

  const machineNames = {
    0x014c: 'x86 (I386)', 0x8664: 'x86-64 (AMD64)',
    0x01c0: 'ARM', 0xaa64: 'ARM64 (AArch64)',
    0x0200: 'IA-64 (Itanium)'
  };

  // Optional header
  const optHeaderOffset = peOffset + 24;
  const magic = buf.readUInt16LE(optHeaderOffset);
  const is64 = magic === 0x20b;
  const is32 = magic === 0x10b;

  let subsystem, imageBase, entryPoint, sizeOfImage;
  if (is32 || is64) {
    entryPoint = buf.readUInt32LE(optHeaderOffset + 16);
    imageBase = is64 ? Number(buf.readBigUInt64LE(optHeaderOffset + 24)) : buf.readUInt32LE(optHeaderOffset + 28);
    sizeOfImage = buf.readUInt32LE(optHeaderOffset + (is64 ? 56 : 52));
    subsystem = buf.readUInt16LE(optHeaderOffset + (is64 ? 68 : 68));
  }

  const subsystemNames = {
    1: 'Native', 2: 'Windows GUI', 3: 'Windows Console (CUI)',
    7: 'POSIX', 9: 'Windows CE GUI', 10: 'EFI Application',
    14: 'Xbox', 16: 'Boot Application'
  };

  // DLL characteristics (security flags)
  const dllChars = is32 || is64 ? buf.readUInt16LE(optHeaderOffset + (is64 ? 70 : 70)) : 0;
  const securityFeatures = {
    dynamic_base_aslr: !!(dllChars & 0x0040),
    force_integrity: !!(dllChars & 0x0080),
    nx_compatible: !!(dllChars & 0x0100),
    no_isolation: !!(dllChars & 0x0200),
    no_seh: !!(dllChars & 0x0400),
    no_bind: !!(dllChars & 0x0800),
    app_container: !!(dllChars & 0x1000),
    high_entropy_va: !!(dllChars & 0x0020),
    cfg_guard: !!(dllChars & 0x4000)
  };

  // Parse section headers
  const optHeaderSize = buf.readUInt16LE(peOffset + 20);
  const sectionsOffset = optHeaderOffset + optHeaderSize;
  const sections = [];
  for (let i = 0; i < Math.min(numSections, 32); i++) {
    const sOff = sectionsOffset + i * 40;
    if (sOff + 40 > buf.length) break;
    const name = buf.toString('ascii', sOff, sOff + 8).replace(/\0/g, '');
    const virtSize = buf.readUInt32LE(sOff + 8);
    const virtAddr = buf.readUInt32LE(sOff + 12);
    const rawSize = buf.readUInt32LE(sOff + 16);
    const rawOffset = buf.readUInt32LE(sOff + 20);
    const flags = buf.readUInt32LE(sOff + 36);

    // Entropy of section
    let sectionEntropy = null;
    if (rawOffset + rawSize <= buf.length) {
      sectionEntropy = parseFloat(calculateEntropy(buf.slice(rawOffset, rawOffset + rawSize)).toFixed(3));
    }

    sections.push({
      name, virtual_address: `0x${virtAddr.toString(16)}`, virtual_size: virtSize,
      raw_offset: `0x${rawOffset.toString(16)}`, raw_size: rawSize,
      entropy: sectionEntropy,
      executable: !!(flags & 0x20000000),
      readable: !!(flags & 0x40000000),
      writable: !!(flags & 0x80000000),
      flag_note: sectionEntropy > 7.2 ? 'HIGH ENTROPY — packed/encrypted?' : ''
    });
  }

  // Compile timestamp
  const compileTime = new Date(timeDateStamp * 1000).toISOString();

  return {
    file: filePath,
    file_size: size,
    is_pe: true,
    pe_type: is64 ? 'PE32+ (64-bit)' : is32 ? 'PE32 (32-bit)' : 'PE (unknown bitness)',
    machine: machineNames[machine] || `0x${machine.toString(16)}`,
    compile_timestamp: compileTime,
    is_dll: !!(characteristics & 0x2000),
    is_exe: !!(characteristics & 0x0002),
    entry_point: entryPoint !== undefined ? `0x${entryPoint.toString(16)}` : null,
    image_base: imageBase !== undefined ? `0x${imageBase.toString(16)}` : null,
    image_size: sizeOfImage !== undefined ? humanSize(sizeOfImage) : null,
    subsystem: subsystemNames[subsystem] || `0x${(subsystem || 0).toString(16)}`,
    sections,
    security_features: securityFeatures,
    security_summary: Object.entries(securityFeatures)
      .filter(([, v]) => v).map(([k]) => k.toUpperCase().replace(/_/g, ' ')).join(', ') || 'None detected'
  };
}

// ─── 7. elf_info ─────────────────────────────────────────────────────────────

async function elf_info({ path: filePath }) {
  if (!filePath) throw new Error('"path" is required');
  const { buf, size } = readBinary(filePath, 2 * 1024 * 1024);

  if (buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) {
    return { error: 'Not an ELF file (missing 0x7f ELF magic)', file: filePath };
  }

  const bits = buf[4] === 1 ? 32 : 64;
  const endian = buf[5] === 1 ? 'LE' : 'BE';
  const readU16 = (off) => endian === 'LE' ? buf.readUInt16LE(off) : buf.readUInt16BE(off);
  const readU32 = (off) => endian === 'LE' ? buf.readUInt32LE(off) : buf.readUInt32BE(off);

  const elfTypeMap = { 0: 'ET_NONE', 1: 'ET_REL (relocatable)', 2: 'ET_EXEC (executable)', 3: 'ET_DYN (shared object)', 4: 'ET_CORE' };
  const elfMachineMap = {
    0x03: 'x86', 0x28: 'ARM (32-bit)', 0x3e: 'x86-64', 0xb7: 'AArch64',
    0x08: 'MIPS', 0x14: 'PowerPC', 0x16: 'PowerPC64', 0x02: 'SPARC',
    0x32: 'IA-64', 0xf3: 'RISC-V'
  };

  const elfType = readU16(16);
  const elfMachine = readU16(18);
  const elfVersion = readU32(20);

  let entryPoint, phOffset, shOffset, numPH, numSH, shStrIdx;
  if (bits === 32) {
    entryPoint = readU32(24);
    phOffset = readU32(28);
    shOffset = readU32(32);
    numPH = readU16(44);
    numSH = readU16(46);
    shStrIdx = readU16(48);
  } else {
    // 64-bit — BigInt reads
    entryPoint = Number(endian === 'LE' ? buf.readBigUInt64LE(24) : buf.readBigUInt64BE(24));
    phOffset = Number(endian === 'LE' ? buf.readBigUInt64LE(32) : buf.readBigUInt64BE(32));
    shOffset = Number(endian === 'LE' ? buf.readBigUInt64LE(40) : buf.readBigUInt64BE(40));
    numPH = readU16(56);
    numSH = readU16(58);
    shStrIdx = readU16(60);
  }

  // Parse program headers (segments)
  const phEntSize = bits === 32 ? 32 : 56;
  const segments = [];
  const ptTypeMap = { 0: 'PT_NULL', 1: 'PT_LOAD', 2: 'PT_DYNAMIC', 3: 'PT_INTERP', 4: 'PT_NOTE', 6: 'PT_PHDR', 7: 'PT_TLS', 0x6474e550: 'PT_GNU_EH_FRAME', 0x6474e551: 'PT_GNU_STACK', 0x6474e552: 'PT_GNU_RELRO' };
  for (let i = 0; i < Math.min(numPH, 20); i++) {
    const phOff = phOffset + i * phEntSize;
    if (phOff + phEntSize > buf.length) break;
    const pType = readU32(phOff);
    const flags = bits === 32 ? readU32(phOff + 24) : readU32(phOff + 4);
    segments.push({
      type: ptTypeMap[pType] || `0x${pType.toString(16)}`,
      flags: `${flags & 4 ? 'R' : '-'}${flags & 2 ? 'W' : '-'}${flags & 1 ? 'X' : '-'}`,
      executable: !!(flags & 1),
      writable: !!(flags & 2),
      note: pType === 0x6474e551 ? (flags & 1 ? 'NX DISABLED (executable stack!)' : 'NX enabled') : undefined
    });
  }

  // Security checks
  const hasGnuStack = segments.find(s => s.type === 'PT_GNU_STACK');
  const nxEnabled = hasGnuStack ? !hasGnuStack.executable : null;
  const hasPie = elfType === 3; // ET_DYN = PIE
  const hasRelro = segments.some(s => s.type === 'PT_GNU_RELRO');

  return {
    file: filePath,
    file_size: size,
    is_elf: true,
    bits,
    endianness: endian === 'LE' ? 'Little Endian' : 'Big Endian',
    type: elfTypeMap[elfType] || `0x${elfType.toString(16)}`,
    machine: elfMachineMap[elfMachine] || `0x${elfMachine.toString(16)}`,
    entry_point: `0x${entryPoint.toString(16)}`,
    program_headers: numPH,
    section_headers: numSH,
    segments: segments,
    security_features: {
      nx_stack: nxEnabled,
      pie: hasPie,
      relro: hasRelro
    },
    security_summary: [
      nxEnabled === true ? 'NX (no-exec stack)' : nxEnabled === false ? 'NO NX (exec stack!)' : 'NX unknown',
      hasPie ? 'PIE (position independent)' : 'No PIE (fixed address)',
      hasRelro ? 'RELRO' : 'No RELRO'
    ].join(' | ')
  };
}

// ─── 8. find_pattern ─────────────────────────────────────────────────────────

async function find_pattern({ path: filePath, pattern, pattern_type = 'hex', max_results = 100 }) {
  if (!filePath) throw new Error('"path" is required');
  if (!pattern) throw new Error('"pattern" is required');

  const { buf, size } = readBinary(filePath, 32 * 1024 * 1024);
  const results = [];
  const maxRes = Math.min(Number(max_results) || 100, 10000);

  if (pattern_type === 'hex') {
    // Parse hex string like "4d5a9000" or "4d 5a 90 00" or "4d?5a??"
    const cleanHex = pattern.replace(/\s+/g, '').replace(/0x/gi, '');
    const hasWildcard = cleanHex.includes('?');

    if (hasWildcard) {
      // Wildcard matching: ?? = any byte, ?x or x? = nibble wildcard
      const nibbles = cleanHex.split('').map(c => c === '?' ? null : parseInt(c, 16));
      const byteCount = Math.floor(nibbles.length / 2);

      for (let i = 0; i <= buf.length - byteCount; i++) {
        let match = true;
        for (let j = 0; j < byteCount; j++) {
          const hi = nibbles[j * 2];
          const lo = nibbles[j * 2 + 1];
          const b = buf[i + j];
          if (hi !== null && lo !== null && ((hi << 4) | lo) !== b) { match = false; break; }
          if (hi !== null && lo === null && (hi !== (b >> 4))) { match = false; break; }
          if (hi === null && lo !== null && (lo !== (b & 0x0f))) { match = false; break; }
        }
        if (match) {
          results.push({ offset: i, offset_hex: `0x${i.toString(16)}`, matched_bytes: Array.from(buf.slice(i, i + byteCount)).map(b => b.toString(16).padStart(2, '0')).join(' ') });
          if (results.length >= maxRes) break;
        }
      }
    } else {
      const needle = Buffer.from(cleanHex, 'hex');
      for (let i = 0; i <= buf.length - needle.length; i++) {
        if (buf.slice(i, i + needle.length).equals(needle)) {
          results.push({ offset: i, offset_hex: `0x${i.toString(16)}`, context: buf.slice(Math.max(0, i - 4), i + needle.length + 4).toString('hex') });
          if (results.length >= maxRes) break;
        }
      }
    }
  } else if (pattern_type === 'ascii' || pattern_type === 'string') {
    const needle = Buffer.from(pattern, 'ascii');
    for (let i = 0; i <= buf.length - needle.length; i++) {
      if (buf.slice(i, i + needle.length).equals(needle)) {
        const ctx = buf.slice(Math.max(0, i - 8), i + needle.length + 8);
        results.push({ offset: i, offset_hex: `0x${i.toString(16)}`, context_ascii: ctx.toString('ascii').replace(/[^\x20-\x7e]/g, '.') });
        if (results.length >= maxRes) break;
      }
    }
  } else if (pattern_type === 'utf16le') {
    const needle = Buffer.from(pattern, 'utf16le');
    for (let i = 0; i <= buf.length - needle.length; i++) {
      if (buf.slice(i, i + needle.length).equals(needle)) {
        results.push({ offset: i, offset_hex: `0x${i.toString(16)}` });
        if (results.length >= maxRes) break;
      }
    }
  } else if (pattern_type === 'regex') {
    const text = buf.toString('binary');
    const re = new RegExp(pattern, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      results.push({ offset: m.index, offset_hex: `0x${m.index.toString(16)}`, match: m[0].replace(/[^\x20-\x7e]/g, '.') });
      if (results.length >= maxRes) break;
    }
  }

  return {
    file: filePath,
    file_size: size,
    pattern,
    pattern_type,
    total_found: results.length,
    truncated: results.length >= maxRes,
    matches: results
  };
}

// ─── 9. xor_bruteforce ───────────────────────────────────────────────────────

async function xor_bruteforce({ path: filePath, offset = 0, length = 256, known_plaintext, key }) {
  if (!filePath) throw new Error('"path" is required');
  const start = Number(offset) || 0;
  const len = Math.min(Number(length) || 256, 4096);
  const { buf } = readBinary(filePath, start + len);
  const slice = buf.slice(start, start + len);

  // If specific key given, just decrypt
  if (key !== undefined) {
    const keyVal = typeof key === 'string' ? parseInt(key, 16) : Number(key);
    const decrypted = Buffer.from(slice).map(b => b ^ keyVal);
    return {
      key: `0x${keyVal.toString(16).padStart(2, '0')}`,
      hex: decrypted.toString('hex'),
      ascii: decrypted.toString('ascii').replace(/[^\x20-\x7e\n\r\t]/g, '.'),
      printable_ratio: Array.from(decrypted).filter(b => isPrintable(b)).length / decrypted.length
    };
  }

  // Bruteforce all 256 keys — score by printable character ratio
  const results = [];
  for (let k = 0; k < 256; k++) {
    const decrypted = Buffer.from(slice).map(b => b ^ k);
    const printable = Array.from(decrypted).filter(b => isPrintable(b)).length;
    const ratio = printable / decrypted.length;

    // If known plaintext provided, check if it appears
    let matchesKnown = false;
    if (known_plaintext) {
      matchesKnown = decrypted.toString('ascii').includes(known_plaintext);
    }

    results.push({
      key: `0x${k.toString(16).padStart(2, '0')}`,
      printable_ratio: parseFloat(ratio.toFixed(3)),
      matches_known_plaintext: matchesKnown || undefined,
      preview: decrypted.toString('ascii').replace(/[^\x20-\x7e]/g, '.').slice(0, 60)
    });
  }

  // Sort by printable ratio descending
  results.sort((a, b) => b.printable_ratio - a.printable_ratio);

  const top = known_plaintext
    ? results.filter(r => r.matches_known_plaintext).concat(results.filter(r => !r.matches_known_plaintext)).slice(0, 20)
    : results.slice(0, 20);

  return {
    file: filePath,
    offset: start,
    bytes_analyzed: slice.length,
    top_candidates: top,
    best_key: results[0].key,
    best_key_decimal: parseInt(results[0].key, 16),
    note: 'Higher printable_ratio = more likely correct key. Use key param to decrypt full file.'
  };
}

// ─── 10. decode_payload ──────────────────────────────────────────────────────

async function decode_payload({ data, encoding, chain }) {
  if (!data) throw new Error('"data" is required');

  const encodings = chain ? chain : [encoding || 'auto'];
  let current = data;
  const steps = [];

  for (const enc of encodings) {
    let decoded;
    const encLower = enc.toLowerCase();

    try {
      if (encLower === 'base64' || encLower === 'b64') {
        decoded = Buffer.from(current, 'base64').toString('utf8');
      } else if (encLower === 'hex') {
        decoded = Buffer.from(current.replace(/\s+/g, ''), 'hex').toString('utf8');
      } else if (encLower === 'url' || encLower === 'urldecode') {
        decoded = decodeURIComponent(current);
      } else if (encLower === 'html') {
        decoded = current.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
      } else if (encLower === 'rot13') {
        decoded = current.replace(/[a-zA-Z]/g, c => {
          const base = c <= 'Z' ? 65 : 97;
          return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
        });
      } else if (encLower === 'rot47') {
        decoded = current.replace(/[!-~]/g, c => String.fromCharCode(((c.charCodeAt(0) - 33 + 47) % 94) + 33));
      } else if (encLower === 'unicode_escape') {
        decoded = current.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      } else if (encLower === 'base32') {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        const clean = current.toUpperCase().replace(/=/g, '');
        let bits = '';
        for (const c of clean) {
          const idx = chars.indexOf(c);
          if (idx < 0) continue;
          bits += idx.toString(2).padStart(5, '0');
        }
        decoded = '';
        for (let i = 0; i + 8 <= bits.length; i += 8) {
          decoded += String.fromCharCode(parseInt(bits.slice(i, i + 8), 2));
        }
      } else if (encLower === 'auto') {
        // Heuristic: try b64 → hex → url
        if (/^[A-Za-z0-9+/]+=*$/.test(current.trim()) && current.length % 4 === 0) {
          decoded = Buffer.from(current, 'base64').toString('utf8');
          steps.push({ encoding: 'base64 (auto-detected)', result: decoded });
        } else if (/^[0-9a-fA-F\s]+$/.test(current.trim()) && current.replace(/\s/g, '').length % 2 === 0) {
          decoded = Buffer.from(current.replace(/\s+/g, ''), 'hex').toString('utf8');
          steps.push({ encoding: 'hex (auto-detected)', result: decoded });
        } else {
          decoded = decodeURIComponent(current);
          steps.push({ encoding: 'url (auto-detected)', result: decoded });
        }
        current = decoded;
        continue;
      } else {
        decoded = `[unknown encoding: ${enc}]`;
      }

      steps.push({ encoding: enc, input_length: current.length, result: decoded, result_length: decoded.length });
      current = decoded;
    } catch (err) {
      steps.push({ encoding: enc, error: err.message, input_preserved: current });
    }
  }

  // Check if final result looks like more encoded data
  const finalLooksEncoded = /^[A-Za-z0-9+/]+=*$/.test(current.trim()) && current.length > 20;
  const finalLooksHex = /^[0-9a-fA-F\s]+$/.test(current.trim()) && current.replace(/\s/g, '').length % 2 === 0;

  return {
    original: data.slice(0, 200),
    final_result: current,
    decode_steps: steps,
    looks_further_encoded: finalLooksEncoded || finalLooksHex,
    suggestion: finalLooksEncoded ? 'Result looks like it may be base64-encoded again. Try adding "base64" to chain.' : finalLooksHex ? 'Result looks like hex. Try adding "hex" to chain.' : null
  };
}

// ─── 11. checksec_binary ─────────────────────────────────────────────────────

async function checksec_binary({ path: filePath }) {
  if (!filePath) throw new Error('"path" is required');
  const { buf, size } = readBinary(filePath, 2 * 1024 * 1024);

  const isPE = buf[0] === 0x4d && buf[1] === 0x5a;
  const isELF = buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;

  if (!isPE && !isELF) {
    return { error: 'Not a PE or ELF binary', file: filePath };
  }

  if (isPE) {
    const info = await pe_info({ path: filePath });
    if (info.error) return info;
    const sf = info.security_features;
    return {
      file: filePath,
      format: 'PE',
      architecture: info.pe_type,
      checks: {
        ASLR: { enabled: sf.dynamic_base_aslr, label: sf.dynamic_base_aslr ? 'ENABLED' : 'DISABLED', description: 'Address Space Layout Randomization' },
        NX: { enabled: sf.nx_compatible, label: sf.nx_compatible ? 'ENABLED' : 'DISABLED', description: 'No-Execute bit (Data Execution Prevention)' },
        'High Entropy ASLR': { enabled: sf.high_entropy_va, label: sf.high_entropy_va ? 'ENABLED' : 'DISABLED', description: 'High entropy virtual addresses' },
        'Force Integrity': { enabled: sf.force_integrity, label: sf.force_integrity ? 'ENABLED' : 'DISABLED', description: 'Code integrity checks required' },
        'CFG (Control Flow Guard)': { enabled: sf.cfg_guard, label: sf.cfg_guard ? 'ENABLED' : 'DISABLED', description: 'Control Flow Guard mitigation' },
        'No SEH': { enabled: sf.no_seh, label: sf.no_seh ? 'ENABLED (SafeSEH or no SEH)' : 'DISABLED (uses SEH)', description: 'Structured Exception Handler handling' }
      },
      overall: [sf.dynamic_base_aslr, sf.nx_compatible].every(Boolean) ? 'Basic mitigations present' : 'Missing key mitigations',
      raw_security_features: sf
    };
  }

  if (isELF) {
    const info = await elf_info({ path: filePath });
    if (info.error) return info;

    // Check for stack canary: look for __stack_chk_fail or ___stack_chk_guard in strings
    const strData = buf.toString('ascii');
    const hasCanary = strData.includes('__stack_chk_fail') || strData.includes('__stack_chk_guard');
    const hasFortify = strData.includes('__printf_chk') || strData.includes('__memcpy_chk') || strData.includes('_chk');

    const sf = info.security_features;
    return {
      file: filePath,
      format: 'ELF',
      architecture: `${info.bits}-bit ${info.machine}`,
      checks: {
        NX: { enabled: sf.nx_stack, label: sf.nx_stack ? 'ENABLED' : sf.nx_stack === false ? 'DISABLED' : 'UNKNOWN', description: 'Non-executable stack' },
        PIE: { enabled: sf.pie, label: sf.pie ? 'ENABLED' : 'DISABLED', description: 'Position Independent Executable (enables ASLR)' },
        RELRO: { enabled: sf.relro, label: sf.relro ? 'ENABLED' : 'DISABLED', description: 'Read-Only Relocations (prevents GOT overwrite)' },
        'Stack Canary': { enabled: hasCanary, label: hasCanary ? 'DETECTED' : 'NOT DETECTED', description: 'Stack corruption canary (__stack_chk_fail)' },
        FORTIFY: { enabled: hasFortify, label: hasFortify ? 'DETECTED' : 'NOT DETECTED', description: 'Fortified libc function wrappers (_chk variants)' }
      },
      overall: [sf.nx_stack, sf.pie, sf.relro, hasCanary].filter(Boolean).length >= 3 ? 'Well-hardened binary' : [sf.nx_stack, sf.pie].every(Boolean) ? 'Basic mitigations present' : 'Weak security posture',
      raw_security_features: { ...sf, stack_canary: hasCanary, fortify: hasFortify }
    };
  }
}

// ─── 12. disassemble_bytes ───────────────────────────────────────────────────

// Lightweight x86/x64 mnemonic lookup for common 1-byte opcodes (educational)
// For real disassembly the AI should use run_command with objdump/ndisasm
const X86_1BYTE = {
  0x00: 'ADD r/m8, r8', 0x01: 'ADD r/m16/32/64, r', 0x03: 'ADD r, r/m', 0x04: 'ADD AL, imm8',
  0x0f: 'ESC (2-byte)', 0x50: 'PUSH EAX', 0x51: 'PUSH ECX', 0x52: 'PUSH EDX', 0x53: 'PUSH EBX',
  0x54: 'PUSH ESP', 0x55: 'PUSH EBP', 0x56: 'PUSH ESI', 0x57: 'PUSH EDI',
  0x58: 'POP EAX', 0x59: 'POP ECX', 0x5a: 'POP EDX', 0x5b: 'POP EBX',
  0x5c: 'POP ESP', 0x5d: 'POP EBP', 0x5e: 'POP ESI', 0x5f: 'POP EDI',
  0x60: 'PUSHA', 0x61: 'POPA', 0x68: 'PUSH imm32', 0x6a: 'PUSH imm8',
  0x70: 'JO rel8', 0x71: 'JNO rel8', 0x72: 'JB rel8', 0x73: 'JAE rel8',
  0x74: 'JZ rel8', 0x75: 'JNZ rel8', 0x76: 'JBE rel8', 0x77: 'JA rel8',
  0x78: 'JS rel8', 0x79: 'JNS rel8', 0x7a: 'JP rel8', 0x7b: 'JNP rel8',
  0x7c: 'JL rel8', 0x7d: 'JGE rel8', 0x7e: 'JLE rel8', 0x7f: 'JG rel8',
  0x80: 'GRP1 r/m8, imm8', 0x81: 'GRP1 r/m, imm32', 0x83: 'GRP1 r/m, imm8',
  0x84: 'TEST r/m8, r8', 0x85: 'TEST r/m, r', 0x87: 'XCHG r/m, r',
  0x88: 'MOV r/m8, r8', 0x89: 'MOV r/m, r', 0x8a: 'MOV r8, r/m8', 0x8b: 'MOV r, r/m',
  0x8d: 'LEA r, m', 0x8f: 'POP r/m',
  0x90: 'NOP', 0x91: 'XCHG ECX, EAX', 0x92: 'XCHG EDX, EAX',
  0xa0: 'MOV AL, moffs8', 0xa1: 'MOV EAX, moffs', 0xa4: 'MOVSB', 0xa5: 'MOVSD',
  0xb0: 'MOV AL, imm8', 0xb1: 'MOV CL, imm8', 0xb2: 'MOV DL, imm8', 0xb3: 'MOV BL, imm8',
  0xb4: 'MOV AH, imm8', 0xb5: 'MOV CH, imm8', 0xb6: 'MOV DH, imm8', 0xb7: 'MOV BH, imm8',
  0xb8: 'MOV EAX, imm32', 0xb9: 'MOV ECX, imm32', 0xba: 'MOV EDX, imm32', 0xbb: 'MOV EBX, imm32',
  0xbc: 'MOV ESP, imm32', 0xbd: 'MOV EBP, imm32', 0xbe: 'MOV ESI, imm32', 0xbf: 'MOV EDI, imm32',
  0xc0: 'SHL/SHR r/m8, imm8', 0xc1: 'SHL/SHR r/m, imm8', 0xc2: 'RET imm16', 0xc3: 'RET',
  0xc6: 'MOV r/m8, imm8', 0xc7: 'MOV r/m, imm', 0xc8: 'ENTER', 0xc9: 'LEAVE',
  0xcc: 'INT3 (Breakpoint)', 0xcd: 'INT imm8', 0xd0: 'SHL/SHR r/m8, 1',
  0xe8: 'CALL rel32', 0xe9: 'JMP rel32', 0xeb: 'JMP rel8',
  0xf3: 'REP prefix', 0xf4: 'HLT', 0xf7: 'TEST/NOT/NEG/MUL/DIV r/m',
  0xff: 'INC/DEC/CALL/JMP/PUSH r/m'
};

async function disassemble_bytes({ bytes, arch = 'x86', base_address = '0x0' }) {
  if (!bytes) throw new Error('"bytes" is required (hex string, e.g. "5589e583ec10")');
  const cleanHex = bytes.replace(/\s+/g, '').replace(/0x/gi, '');
  const buf = Buffer.from(cleanHex, 'hex');
  const baseAddr = parseInt(base_address.toString().replace('0x', ''), 16) || 0;

  // Try system objdump / ndisasm if available
  const tmpFile = require('os').tmpdir() + '/omnidev_disasm_' + Date.now() + '.bin';
  fs.writeFileSync(tmpFile, buf);

  // Try ndisasm
  const ndisasm = await tryExec(`ndisasm -b ${arch === 'x86_64' || arch === 'x64' ? 64 : 32} -o 0x${baseAddr.toString(16)} "${tmpFile}"`);
  if (ndisasm.ok) {
    fs.unlinkSync(tmpFile);
    return { arch, base_address, source: 'ndisasm', disassembly: ndisasm.out.trim() };
  }

  // Try objdump
  const objdump = await tryExec(`objdump -D -b binary -m i386${arch === 'x86_64' || arch === 'x64' ? ':x86-64' : ''} "${tmpFile}"`);
  if (objdump.ok) {
    fs.unlinkSync(tmpFile);
    return { arch, base_address, source: 'objdump', disassembly: objdump.out.trim() };
  }

  try { fs.unlinkSync(tmpFile); } catch (_) {}

  // JS fallback: simple 1-byte opcode lookup (best-effort, not a full decoder)
  const lines = [];
  let offset = 0;
  while (offset < buf.length) {
    const b = buf[offset];
    const mnemonic = X86_1BYTE[b] || `DB 0x${b.toString(16).padStart(2, '0')} (unknown opcode)`;
    lines.push(`0x${(baseAddr + offset).toString(16).padStart(8, '0')}  ${b.toString(16).padStart(2, '0')}  ${mnemonic}`);
    offset++;
  }

  return {
    arch,
    base_address: `0x${baseAddr.toString(16)}`,
    source: 'builtin-partial',
    warning: 'Full disassembly requires ndisasm or objdump on PATH. This is a 1-byte opcode hint table only.',
    disassembly: lines.join('\n'),
    recommendation: 'Install ndisasm (nasm package) or use run_command with: objdump -D -b binary -m i386 <file>'
  };
}

// ─── 13. extract_urls ────────────────────────────────────────────────────────

async function extract_urls({ path: filePath, include_ips = true, include_emails = true }) {
  if (!filePath) throw new Error('"path" is required');
  const { buf, size } = readBinary(filePath, 32 * 1024 * 1024);
  const text = buf.toString('ascii').replace(/[^\x20-\x7e\n\t]/g, ' ');

  const urlRe = /https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;
  const ipRe = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
  const domainRe = /\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+(?:com|net|org|io|gov|edu|co|info|biz|xyz|app|dev|me|cn|ru|uk|de|fr|jp|br|au)\b/g;
  const emailRe = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;
  const registryRe = /(?:HKEY_[A-Z_]+|HKLM|HKCU|HKCR|HKU)\\[^"'\s\x00-\x1f]+/g;

  const unique = (arr) => [...new Set(arr)];

  const urls = unique(text.match(urlRe) || []);
  const ips = include_ips ? unique(text.match(ipRe) || []).filter(ip => !ip.startsWith('127.') && ip !== '0.0.0.0' && ip !== '255.255.255.255') : [];
  const domains = unique(text.match(domainRe) || []).filter(d => !urls.some(u => u.includes(d)));
  const emails = include_emails ? unique(text.match(emailRe) || []) : [];
  const regKeys = unique(text.match(registryRe) || []);

  // UTF-16 LE scan for wide strings
  const wideText = buf.toString('utf16le').replace(/[^\x20-\x7e\n\t]/g, ' ');
  const wideUrls = unique(wideText.match(urlRe) || []).filter(u => !urls.includes(u));
  const wideIps = include_ips ? unique(wideText.match(ipRe) || []).filter(ip => !ips.includes(ip) && !ip.startsWith('127.')) : [];

  return {
    file: filePath,
    file_size: size,
    urls: { ascii: urls.slice(0, 200), wide: wideUrls.slice(0, 100) },
    ip_addresses: { ascii: ips.slice(0, 200), wide: wideIps.slice(0, 100) },
    domains: domains.slice(0, 200),
    emails: emails.slice(0, 100),
    registry_keys: regKeys.slice(0, 100),
    summary: {
      total_urls: urls.length + wideUrls.length,
      total_ips: ips.length + wideIps.length,
      total_domains: domains.length,
      total_emails: emails.length,
      total_registry_keys: regKeys.length
    }
  };
}

// ─── 14. compare_files ───────────────────────────────────────────────────────

async function compare_files({ path_a, path_b, max_diffs = 100 }) {
  if (!path_a || !path_b) throw new Error('"path_a" and "path_b" are both required');
  const a = readBinary(path_a, 32 * 1024 * 1024);
  const b = readBinary(path_b, 32 * 1024 * 1024);

  const minLen = Math.min(a.buf.length, b.buf.length);
  const maxDiff = Math.min(Number(max_diffs) || 100, 10000);

  const diffs = [];
  let sameBytesInRow = 0;

  for (let i = 0; i < minLen; i++) {
    if (a.buf[i] !== b.buf[i]) {
      diffs.push({
        offset: i,
        offset_hex: `0x${i.toString(16)}`,
        file_a: `0x${a.buf[i].toString(16).padStart(2, '0')}`,
        file_b: `0x${b.buf[i].toString(16).padStart(2, '0')}`
      });
      if (diffs.length >= maxDiff) break;
    }
  }

  const identicalBytes = minLen - diffs.length;
  const similarityPct = minLen > 0 ? parseFloat((identicalBytes / minLen * 100).toFixed(2)) : 100;

  return {
    file_a: { path: path_a, size: a.size, size_human: humanSize(a.size) },
    file_b: { path: path_b, size: b.size, size_human: humanSize(b.size) },
    size_difference: Math.abs(a.size - b.size),
    compared_bytes: minLen,
    identical_bytes: identicalBytes,
    different_bytes: diffs.length,
    similarity_percent: similarityPct,
    files_identical: diffs.length === 0 && a.size === b.size,
    truncated: diffs.length >= maxDiff,
    differences: diffs,
    suffix_a: a.size > b.size ? { extra_bytes: a.size - b.size, starts_at: `0x${b.size.toString(16)}` } : undefined,
    suffix_b: b.size > a.size ? { extra_bytes: b.size - a.size, starts_at: `0x${a.size.toString(16)}` } : undefined
  };
}

// ─── 15. yara_scan ───────────────────────────────────────────────────────────

async function yara_scan({ path: filePath, rules_path, rules_string }) {
  if (!filePath) throw new Error('"path" is required');
  if (!rules_path && !rules_string) throw new Error('Either "rules_path" or "rules_string" is required');

  const absTarget = resolvePath(filePath);
  let rulesFile = rules_path ? resolvePath(rules_path) : null;

  // If inline rules provided, write to temp file
  const tmpRules = rulesFile ? null : require('os').tmpdir() + '/omnidev_yara_' + Date.now() + '.yar';
  if (rules_string && tmpRules) {
    fs.writeFileSync(tmpRules, rules_string, 'utf8');
    rulesFile = tmpRules;
  }

  const yaraCmd = process.platform === 'win32' ? 'yara64' : 'yara';
  const result = await tryExec(`${yaraCmd} -s "${rulesFile}" "${absTarget}"`, 30000);

  if (tmpRules) {
    try { fs.unlinkSync(tmpRules); } catch (_) {}
  }

  if (!result.ok && result.err && result.err.toLowerCase().includes('not recognized')) {
    return {
      error: 'YARA not found on PATH. Install from https://virustotal.github.io/yara/ and add to PATH.',
      install_hint: 'Windows: winget install VirusTotal.YARA  |  Linux: apt install yara  |  macOS: brew install yara',
      file: filePath
    };
  }

  const lines = result.out.split('\n').filter(Boolean);
  const matches = [];
  for (const line of lines) {
    const parts = line.split(' ');
    if (parts.length >= 2) {
      matches.push({ rule: parts[0], file: parts[1], details: parts.slice(2).join(' ') });
    }
  }

  return {
    file: filePath,
    rules: rules_path || '(inline)',
    matched_rules: matches.length,
    matches,
    raw_output: result.out.trim(),
    stderr: result.err ? result.err.trim() : undefined
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  strings_extract,
  hex_dump,
  file_identify,
  entropy_analysis,
  hash_file,
  pe_info,
  elf_info,
  find_pattern,
  xor_bruteforce,
  decode_payload,
  checksec_binary,
  disassemble_bytes,
  extract_urls,
  compare_files,
  yara_scan
};
