const filesystem = require('./filesystem');
const terminal = require('./terminal');
const database = require('./database');
const git = require('./git');
const system = require('./system');
const browser = require('./browser');
const reversing = require('./reversing');
const rebuild = require('./rebuild');
const mysql = require('./mysql');
const scaffold = require('./scaffold');
const devtools = require('./devtools');
const docker = require('./docker');
const safety = require('./safety');
const permissionsManager = require('../permissions');
const audit = require('../audit');
const EventEmitter = require('events');

// Tool → category, for grouping in the Tools pane.
const TOOL_CATEGORY = {
  read_file: 'Filesystem', write_file: 'Filesystem', edit_file_replace: 'Filesystem', edit_file_multi: 'Filesystem',
  list_directory: 'Filesystem', search_code: 'Filesystem', delete_file: 'Filesystem', get_file_info: 'Filesystem',
  move_file: 'Filesystem', copy_file: 'Filesystem', list_backups: 'Filesystem', restore_backup: 'Filesystem',
  run_command: 'Terminal', get_job_status: 'Terminal', get_job_output: 'Terminal', list_jobs: 'Terminal', cancel_job: 'Terminal',
  sqlite_query: 'Database', sqlite_schema: 'Database', sqlite_execute_script: 'Database',
  mysql_query: 'Database', mysql_databases: 'Database', mysql_schema: 'Database',
  git_status: 'Git', git_diff: 'Git', git_log: 'Git', git_commit: 'Git', git_branch: 'Git',
  get_project_context: 'System', update_project_context: 'System', get_system_info: 'System', check_port: 'System',
  fetch_http: 'System', list_processes: 'System', kill_process: 'System', read_env: 'System', notify_user: 'System',
  take_screenshot: 'Browser', get_page_text: 'Browser', get_page_console_errors: 'Browser', click_element: 'Browser',
  run_tests: 'Dev Tools', lint_code: 'Dev Tools', format_code: 'Dev Tools', package_manager: 'Dev Tools', codebase_map: 'Dev Tools',
  docker_ps: 'Docker', docker_logs: 'Docker', docker_compose: 'Docker',
  list_ui_templates: 'Web Scaffolding', scaffold_dashboard: 'Web Scaffolding',
  create_checkpoint: 'Safety & Secrets', list_checkpoints: 'Safety & Secrets', restore_checkpoint: 'Safety & Secrets',
  vault_set: 'Safety & Secrets', vault_get: 'Safety & Secrets', vault_list: 'Safety & Secrets', vault_delete: 'Safety & Secrets',
  strings_extract: 'Reverse Engineering', hex_dump: 'Reverse Engineering', file_identify: 'Reverse Engineering',
  entropy_analysis: 'Reverse Engineering', hash_file: 'Reverse Engineering', pe_info: 'Reverse Engineering',
  elf_info: 'Reverse Engineering', find_pattern: 'Reverse Engineering', xor_bruteforce: 'Reverse Engineering',
  decode_payload: 'Reverse Engineering', checksec_binary: 'Reverse Engineering', disassemble_bytes: 'Reverse Engineering',
  extract_urls: 'Reverse Engineering', compare_files: 'Reverse Engineering', yara_scan: 'Reverse Engineering',
  apk_decode: 'Rebuild & Decompile', apk_rebuild: 'Rebuild & Decompile', apk_sign: 'Rebuild & Decompile',
  apk_info: 'Rebuild & Decompile', jadx_decompile: 'Rebuild & Decompile', jar_extract: 'Rebuild & Decompile',
  jar_rebuild: 'Rebuild & Decompile', java_compile: 'Rebuild & Decompile', dotnet_decompile: 'Rebuild & Decompile',
  patch_binary: 'Rebuild & Decompile', extract_section: 'Rebuild & Decompile', unminify_js: 'Rebuild & Decompile',
  smali_patch: 'Rebuild & Decompile', install_re_tool: 'Rebuild & Decompile', run_r2: 'Rebuild & Decompile'
};

class ToolRegistry extends EventEmitter {
  constructor() {
    super();
    this.tools = {};
    this.schemas = [];
    this.registerAll();
  }

  registerAll() {
    // 1. Filesystem Tools
    this.register('read_file', 'Read contents of a file in the workspace with line numbers', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to file in workspace' },
        start_line: { type: 'integer', description: 'Starting line number (1-indexed)' },
        end_line: { type: 'integer', description: 'Ending line number (inclusive)' }
      },
      required: ['path']
    }, filesystem.read_file, false);

    this.register('write_file', 'Create or overwrite a file in the workspace', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to file in workspace' },
        content: { type: 'string', description: 'File content to write' },
        overwrite: { type: 'boolean', description: 'Whether to overwrite if file already exists (default true)' }
      },
      required: ['path', 'content']
    }, filesystem.write_file, true);

    this.register('edit_file_replace', 'Surgically replace exact string occurrence(s) in a workspace file', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to file in workspace' },
        target: { type: 'string', description: 'Exact string to search for' },
        replacement: { type: 'string', description: 'Replacement string' }
      },
      required: ['path', 'target', 'replacement']
    }, filesystem.edit_file_replace, true);

    this.register('list_directory', 'List files and directories inside a workspace path', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative directory path (default .)' },
        recursive: { type: 'boolean', description: 'Whether to list recursively' },
        max_depth: { type: 'integer', description: 'Max depth for recursive listing (default 3)' }
      }
    }, filesystem.list_directory, false);

    this.register('search_code', 'Search for text or regex across workspace files', {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term or regex pattern' },
        path: { type: 'string', description: 'Directory to search within (default .)' },
        is_regex: { type: 'boolean', description: 'Whether query is a regex pattern' },
        max_results: { type: 'integer', description: 'Maximum matches to return (default 50)' }
      },
      required: ['query']
    }, filesystem.search_code, false);

    this.register('delete_file', 'Delete a file or directory inside the workspace', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to file or directory' },
        recursive: { type: 'boolean', description: 'Delete directory recursively (default false)' }
      },
      required: ['path']
    }, filesystem.delete_file, true);

    this.register('get_file_info', 'Get file metadata (size, modified time, directory status)', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to file or directory' }
      },
      required: ['path']
    }, filesystem.get_file_info, false);

    this.register('edit_file_multi', 'Apply several surgical find/replace edits to one file in a single atomic operation. Each edit must match a unique string (or set replace_all). Safer and faster than calling edit_file_replace repeatedly. Automatically backs up the file first.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' },
        edits: {
          type: 'array',
          description: 'List of edits applied in order',
          items: {
            type: 'object',
            properties: {
              target: { type: 'string', description: 'Exact string to find' },
              replacement: { type: 'string', description: 'Replacement string' },
              replace_all: { type: 'boolean', description: 'Replace every occurrence (default false — target must be unique)' }
            },
            required: ['target', 'replacement']
          }
        }
      },
      required: ['path', 'edits']
    }, filesystem.edit_file_multi, true);

    this.register('move_file', 'Move or rename a file or directory inside the workspace. Backs up the destination if it is being overwritten.', {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Current relative path' },
        to: { type: 'string', description: 'New relative path' },
        overwrite: { type: 'boolean', description: 'Overwrite destination if it exists (default false)' }
      },
      required: ['from', 'to']
    }, filesystem.move_file, true);

    this.register('copy_file', 'Copy a file or directory (recursive) to a new location inside the workspace.', {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source relative path' },
        to: { type: 'string', description: 'Destination relative path' },
        overwrite: { type: 'boolean', description: 'Overwrite destination if it exists (default false)' }
      },
      required: ['from', 'to']
    }, filesystem.copy_file, true);

    this.register('list_backups', 'List automatic file backups (snapshots taken before overwrites, edits, and deletes). Use with restore_backup to roll back a change.', {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max entries to return (default 50)' }
      }
    }, filesystem.list_backups, false);

    this.register('restore_backup', 'Restore a file from an automatic backup by its id (from list_backups). The current version is itself backed up first, so restore is reversible.', {
      type: 'object',
      properties: {
        backup_id: { type: 'string', description: 'Backup id from list_backups' }
      },
      required: ['backup_id']
    }, filesystem.restore_backup, true);

    // 2. Terminal & Process Tools
    this.register('run_command', 'Run a terminal command (PowerShell / Bash) in workspace. Assigns a job_id and supports background execution.', {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        is_background: { type: 'boolean', description: 'Set true for long-running processes (e.g. servers, dev builds, npm install)' },
        timeout_seconds: { type: 'integer', description: 'Max execution time in seconds (default 300)' },
        shell: { type: 'string', description: 'Optional shell override (e.g. powershell.exe, cmd.exe, bash)' }
      },
      required: ['command']
    }, terminal.run_command, true);

    this.register('get_job_status', 'Check status, exit code, and live activity of a background command job', {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job ID returned by run_command' }
      },
      required: ['job_id']
    }, terminal.get_job_status, false);

    this.register('get_job_output', 'Get output logs (stdout/stderr) from a background command job', {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job ID' },
        max_lines: { type: 'integer', description: 'Number of recent lines to retrieve (default 100)' }
      },
      required: ['job_id']
    }, terminal.get_job_output, false);

    this.register('list_jobs', 'List all running and completed background jobs', {
      type: 'object',
      properties: {
        status_filter: { type: 'string', enum: ['running', 'completed', 'failed', 'cancelled'], description: 'Filter by job status' }
      }
    }, terminal.list_jobs, false);

    this.register('cancel_job', 'Stop or cancel a running background command job', {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job ID to cancel' },
        reason: { type: 'string', description: 'Reason for cancellation' }
      },
      required: ['job_id']
    }, terminal.cancel_job, true);

    // 3. Database Tools
    this.register('sqlite_query', 'Execute a SQL query (SELECT, INSERT, UPDATE, DELETE) on a workspace SQLite database', {
      type: 'object',
      properties: {
        database_file: { type: 'string', description: 'Relative path to SQLite file (default app.db)' },
        sql: { type: 'string', description: 'SQL query string' },
        params: { type: 'array', items: {}, description: 'Query parameters for placeholders' }
      },
      required: ['sql']
    }, database.sqlite_query, true);

    this.register('sqlite_schema', 'Inspect tables, columns, views, and DDL schema of a SQLite database', {
      type: 'object',
      properties: {
        database_file: { type: 'string', description: 'Relative path to SQLite file (default app.db)' }
      }
    }, database.sqlite_schema, false);

    this.register('sqlite_execute_script', 'Execute a multi-statement SQL script (e.g. migrations, tables creation, seed)', {
      type: 'object',
      properties: {
        database_file: { type: 'string', description: 'Relative path to SQLite file (default app.db)' },
        sql_script: { type: 'string', description: 'Full SQL script to execute' }
      },
      required: ['sql_script']
    }, database.sqlite_execute_script, true);

    // 4. Git Tools
    this.register('git_status', 'Get git repository status (staged, unstaged, untracked files, branch)', {
      type: 'object',
      properties: {}
    }, git.git_status, false);

    this.register('git_diff', 'View git diff for working tree or staged changes', {
      type: 'object',
      properties: {
        staged: { type: 'boolean', description: 'Whether to view staged changes' },
        file: { type: 'string', description: 'Optional specific file path' }
      }
    }, git.git_diff, false);

    this.register('git_log', 'View recent commit history', {
      type: 'object',
      properties: {
        max_count: { type: 'integer', description: 'Number of commits to retrieve (default 10)' }
      }
    }, git.git_log, false);

    this.register('git_commit', 'Stage changes and create a git commit', {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message' },
        add_all: { type: 'boolean', description: 'Whether to stage all changes with git add -A (default true)' }
      },
      required: ['message']
    }, git.git_commit, true);

    this.register('git_branch', 'List branches or create/checkout a branch', {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Branch name to switch to or create' },
        create: { type: 'boolean', description: 'Create branch if true' }
      }
    }, git.git_branch, true);

    // 5. System & Context Tools
    this.register('get_project_context', 'Get active project details, directory path, and developer notes (such as localhost URLs, XAMPP port, MySQL credentials, tech stack). Also tells you if context is not set yet.', {
      type: 'object',
      properties: {}
    }, system.get_project_context, false);

    this.register('update_project_context', 'Set or update the developer notes and context for the active project workspace. Use this when project context is not set, or when you discover new details (localhost URL, database config, tech stack, env vars, key architecture decisions) that will help you work more effectively in future sessions. The notes are saved permanently and passed to you on every connection.', {
      type: 'object',
      properties: {
        notes: {
          type: 'string',
          description: 'Developer notes to save. Include: localhost URL, tech stack, database name/user/password, key directories, special build commands, env variables, and any important project details.'
        },
        project_type: {
          type: 'string',
          description: 'Tech stack of the project (e.g. PHP / XAMPP, Node.js, Python, Full-Stack)'
        },
        append: {
          type: 'boolean',
          description: 'If true, append these notes to existing notes instead of replacing them. Default: false (replace).'
        }
      },
      required: ['notes']
    }, system.update_project_context, false);

    this.register('get_system_info', 'Get OS, RAM, CPU info and active workspace details', {
      type: 'object',
      properties: {}
    }, system.get_system_info, false);

    this.register('check_port', 'Check if a local TCP port (e.g. 3000, 5173, 8080) is free or in use', {
      type: 'object',
      properties: {
        port: { type: 'integer', description: 'Port number to check' },
        host: { type: 'string', description: 'Host (default 127.0.0.1)' }
      },
      required: ['port']
    }, system.check_port, false);

    this.register('fetch_http', 'Send an HTTP request to inspect local servers or external APIs', {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Target URL' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], description: 'HTTP method' },
        headers: { type: 'object', description: 'Custom headers' },
        body: { description: 'Request body' }
      },
      required: ['url']
    }, system.fetch_http, false);

    this.register('list_processes', 'List running OS processes (name, PID, memory). Optionally filter by name or PID. Useful for finding stuck dev servers or checking what holds a port.', {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Case-insensitive name substring or exact PID to filter by' },
        limit: { type: 'integer', description: 'Max processes to return (default 50)' }
      }
    }, system.list_processes, false);

    this.register('kill_process', 'Terminate a process by PID or image name. Use to stop a hung dev server, locked port, or runaway build.', {
      type: 'object',
      properties: {
        pid: { type: 'integer', description: 'Process ID to kill' },
        name: { type: 'string', description: 'Process/image name to kill (e.g. node.exe). Kills all matching + children.' },
        force: { type: 'boolean', description: 'Force kill (default true)' }
      }
    }, system.kill_process, true);

    this.register('read_env', 'Read a .env style file and return its variables. Secret-looking values (password/token/key/secret) are hidden unless reveal is true.', {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Relative path to the env file (default .env)' },
        reveal: { type: 'boolean', description: 'Show secret values in plaintext (default false)' }
      }
    }, system.read_env, false);

    this.register('notify_user', 'Send a desktop notification to the developer running OmniDev Studio. Use to flag that you need input, finished a long task, or hit something important.', {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Notification title (default "OmniDev Agent")' },
        message: { type: 'string', description: 'Notification body text' }
      },
      required: ['message']
    }, system.notify_user, false);

    // 5b. MySQL / MariaDB Tools (via mysql CLI — e.g. XAMPP)
    this.register('mysql_query', 'Run a SQL query against a MySQL/MariaDB server (e.g. XAMPP). Credentials come from params (read them from project notes). Returns rows as objects.', {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SQL statement to execute' },
        database: { type: 'string', description: 'Database/schema to use' },
        host: { type: 'string', description: 'Host (default 127.0.0.1)' },
        port: { type: 'integer', description: 'Port (default 3306)' },
        user: { type: 'string', description: 'User (default root)' },
        password: { type: 'string', description: 'Password (default empty, as in default XAMPP)' }
      },
      required: ['sql']
    }, mysql.mysql_query, true);

    this.register('mysql_databases', 'List all databases/schemas on a MySQL/MariaDB server.', {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Host (default 127.0.0.1)' },
        port: { type: 'integer', description: 'Port (default 3306)' },
        user: { type: 'string', description: 'User (default root)' },
        password: { type: 'string', description: 'Password (default empty)' }
      }
    }, mysql.mysql_databases, false);

    this.register('mysql_schema', 'Inspect a MySQL/MariaDB database: list its tables, or DESCRIBE a specific table when "table" is given.', {
      type: 'object',
      properties: {
        database: { type: 'string', description: 'Database/schema name' },
        table: { type: 'string', description: 'Optional table to describe' },
        host: { type: 'string', description: 'Host (default 127.0.0.1)' },
        port: { type: 'integer', description: 'Port (default 3306)' },
        user: { type: 'string', description: 'User (default root)' },
        password: { type: 'string', description: 'Password (default empty)' }
      },
      required: ['database']
    }, mysql.mysql_schema, false);

    // 6. Headless Browser Tools (Puppeteer)
    this.register('take_screenshot', 'Navigate to a URL in a headless browser and take a screenshot. Saves the image to the workspace. Useful for visually inspecting a running localhost app or web page.', {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL including protocol (e.g. http://localhost:3000 or https://example.com)' },
        output_path: { type: 'string', description: 'Relative path in workspace to save the screenshot PNG (e.g. screenshots/home.png). Auto-generated if omitted.' },
        width: { type: 'integer', description: 'Viewport width in pixels (default 1280)' },
        height: { type: 'integer', description: 'Viewport height in pixels (default 800)' },
        full_page: { type: 'boolean', description: 'Capture the full scrollable page, not just the visible viewport (default false)' }
      },
      required: ['url']
    }, browser.take_screenshot, false);

    this.register('get_page_text', 'Get the visible text content from a URL, optionally scoped to a CSS selector. Useful for reading rendered app output or dynamic content.', {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to navigate to' },
        selector: { type: 'string', description: 'Optional CSS selector to extract text from a specific element (e.g. #output, .result, table)' }
      },
      required: ['url']
    }, browser.get_page_text, false);

    this.register('get_page_console_errors', 'Visit a URL in a headless browser and collect all console errors, warnings, and page errors that occur during page load. Useful for debugging a running app.', {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to open' },
        wait_ms: { type: 'integer', description: 'Milliseconds to wait after DOM load for JS to run (default 3000)' }
      },
      required: ['url']
    }, browser.get_page_console_errors, false);

    this.register('click_element', 'Click a DOM element on a web page by CSS selector. Optionally waits for navigation to complete after the click.', {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to navigate to first' },
        selector: { type: 'string', description: 'CSS selector for the element to click (e.g. button#submit, .menu-item, a[href="/login"])' },
        wait_for_navigation: { type: 'boolean', description: 'Whether to wait for page navigation after click (default true)' }
      },
      required: ['url', 'selector']
    }, browser.click_element, false);

    // 7. Reverse Engineering & Security Research Tools
    this.register('strings_extract', 'Extract printable ASCII strings from any binary file. Useful for finding hardcoded URLs, registry keys, passwords, error messages, and indicators of compromise in malware or unknown binaries.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the binary file in workspace' },
        min_length: { type: 'integer', description: 'Minimum string length to extract (default 4)' },
        offset: { type: 'integer', description: 'Start scanning from this byte offset (useful for large files)' },
        limit: { type: 'integer', description: 'Maximum number of strings to return (default 2000)' }
      },
      required: ['path']
    }, reversing.strings_extract, false);

    this.register('hex_dump', 'Produce a hex + ASCII dump of a file section (like xxd/hexdump). Essential for inspecting binary structure, file headers, and encoded data.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' },
        offset: { type: 'integer', description: 'Byte offset to start reading (default 0)' },
        length: { type: 'integer', description: 'Number of bytes to dump (default 512, max 65536)' },
        width: { type: 'integer', description: 'Bytes per line (default 16)' }
      },
      required: ['path']
    }, reversing.hex_dump, false);

    this.register('file_identify', 'Identify file format, architecture, and type using magic bytes — like the Unix "file" command. Detects PE, ELF, Mach-O, ZIP, PDF, DEX, and 25+ other formats. Also shows entropy and PE/ELF header details.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file to identify' }
      },
      required: ['path']
    }, reversing.file_identify, false);

    this.register('entropy_analysis', 'Calculate Shannon entropy by chunk across a binary file. High entropy (>7.0) regions indicate packed, encrypted, or compressed code. Essential for detecting obfuscation and finding packer boundaries.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the binary file' },
        chunk_size: { type: 'integer', description: 'Size of each entropy chunk in bytes (default 256)' }
      },
      required: ['path']
    }, reversing.entropy_analysis, false);

    this.register('hash_file', 'Compute MD5, SHA1, SHA256, and/or SHA512 hashes of a file. Includes a VirusTotal lookup link for the SHA256. Use for malware identification and integrity verification.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' },
        algorithms: { type: 'array', items: { type: 'string', enum: ['md5', 'sha1', 'sha256', 'sha512'] }, description: 'Hash algorithms to compute (default: md5, sha1, sha256)' }
      },
      required: ['path']
    }, reversing.hash_file, false);

    this.register('pe_info', 'Parse Windows PE (EXE/DLL) file headers: machine type, compile timestamp, sections, entry point, image base, subsystem, and security features (ASLR, NX, CFG, High Entropy VA). Reports per-section entropy to detect packed sections.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to PE file (.exe, .dll, .sys, etc.)' }
      },
      required: ['path']
    }, reversing.pe_info, false);

    this.register('elf_info', 'Parse Linux/Unix ELF binary headers: bitness, endianness, type (exec/shared/relocatable), machine architecture, entry point, program headers/segments, and security features (NX, PIE, RELRO).', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to ELF file' }
      },
      required: ['path']
    }, reversing.elf_info, false);

    this.register('find_pattern', 'Search for a hex byte sequence, ASCII string, UTF-16LE wide string, or regex pattern across a binary file. Supports wildcard bytes (??) in hex mode. Returns all offsets where pattern matches.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to file to search' },
        pattern: { type: 'string', description: 'Pattern to search: hex bytes (e.g. "4d5a9000"), ASCII string, or regex. Wildcards: "4d??90" matches 4d, any byte, 90.' },
        pattern_type: { type: 'string', enum: ['hex', 'ascii', 'utf16le', 'regex', 'string'], description: 'Type of pattern (default: hex)' },
        max_results: { type: 'integer', description: 'Maximum matches to return (default 100)' }
      },
      required: ['path', 'pattern']
    }, reversing.find_pattern, false);

    this.register('xor_bruteforce', 'Brute-force XOR decryption with all 256 single-byte keys on a file region. Scores each result by printable character ratio. Optionally tests against known plaintext. Classic CTF and malware deobfuscation technique.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' },
        offset: { type: 'integer', description: 'Byte offset to start decrypting (default 0)' },
        length: { type: 'integer', description: 'Number of bytes to analyze (default 256, max 4096)' },
        known_plaintext: { type: 'string', description: 'Optional: known plaintext string to look for in decrypted output (prioritizes matching keys)' },
        key: { type: 'string', description: 'If you already know the XOR key (hex e.g. "0x2a" or decimal), skip bruteforce and just decrypt' }
      },
      required: ['path']
    }, reversing.xor_bruteforce, false);

    this.register('decode_payload', 'Decode obfuscated data through one or more encoding layers: Base64, Hex, URL encoding, HTML entities, ROT13, ROT47, Base32, Unicode escapes. Supports chaining multiple decodings in sequence.', {
      type: 'object',
      properties: {
        data: { type: 'string', description: 'The encoded string to decode' },
        encoding: { type: 'string', enum: ['base64', 'hex', 'url', 'html', 'rot13', 'rot47', 'base32', 'unicode_escape', 'auto'], description: 'Encoding to apply (use "auto" to guess). Default: auto' },
        chain: { type: 'array', items: { type: 'string' }, description: 'Apply multiple decodings in order, e.g. ["base64", "url", "hex"]. Overrides "encoding".' }
      },
      required: ['data']
    }, reversing.decode_payload, false);

    this.register('checksec_binary', 'Check security mitigations of a PE or ELF binary: ASLR, NX (DEP), PIE, Stack Canary, RELRO, CFG, FORTIFY. Equivalent to the checksec.sh tool. Essential for vulnerability research and exploit development.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to PE (.exe/.dll) or ELF binary' }
      },
      required: ['path']
    }, reversing.checksec_binary, false);

    this.register('disassemble_bytes', 'Disassemble a hex-encoded byte sequence into x86/x64 instructions. Uses ndisasm or objdump if available, falls back to built-in opcode table. For shellcode analysis, CTF challenges, and patch diffing.', {
      type: 'object',
      properties: {
        bytes: { type: 'string', description: 'Hex-encoded bytes to disassemble (e.g. "5589e583ec10c3" or "55 89 e5")' },
        arch: { type: 'string', enum: ['x86', 'x64', 'x86_64'], description: 'Target architecture (default: x86)' },
        base_address: { type: 'string', description: 'Base virtual address for the first byte (e.g. "0x401000"). Default: 0x0' }
      },
      required: ['bytes']
    }, reversing.disassemble_bytes, false);

    this.register('extract_urls', 'Extract all URLs, IP addresses, domain names, email addresses, and Windows registry keys from a binary or text file (scans both ASCII and UTF-16LE wide strings). Essential for malware network IOC extraction.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' },
        include_ips: { type: 'boolean', description: 'Include IP addresses in results (default true)' },
        include_emails: { type: 'boolean', description: 'Include email addresses in results (default true)' }
      },
      required: ['path']
    }, reversing.extract_urls, false);

    this.register('compare_files', 'Byte-level diff between two binary files. Reports similarity percentage, exact differing byte offsets, and which file has extra trailing bytes. Useful for patch analysis, variant diffing, and unpacker output comparison.', {
      type: 'object',
      properties: {
        path_a: { type: 'string', description: 'Relative path to first file' },
        path_b: { type: 'string', description: 'Relative path to second file' },
        max_diffs: { type: 'integer', description: 'Maximum differences to report (default 100)' }
      },
      required: ['path_a', 'path_b']
    }, reversing.compare_files, false);

    this.register('yara_scan', 'Scan a file with YARA rules for malware family detection, capability identification, or custom IOC matching. Accepts rules as a file path or inline rule string. Requires YARA installed (falls back gracefully with install hint).', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file to scan' },
        rules_path: { type: 'string', description: 'Relative path to .yar YARA rules file in workspace' },
        rules_string: { type: 'string', description: 'Inline YARA rule string (alternative to rules_path). E.g. \'rule test { strings: $a = "password" condition: $a }\'' }
      },
      required: ['path']
    }, reversing.yara_scan, false);

    // 8. Rebuild, Decompile & Repackage Tools
    this.register('apk_decode', 'Disassemble an Android APK into Smali bytecode + resources using apktool. Output is a directory you can browse, modify, and rebuild. Essential for Android app analysis and modification.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the .apk file' },
        output_dir: { type: 'string', description: 'Output directory for decoded files (default: decoded/<apkname>)' },
        force: { type: 'boolean', description: 'Force overwrite existing output dir (default false)' },
        no_src: { type: 'boolean', description: 'Skip Smali disassembly, only decode resources (default false)' },
        no_res: { type: 'boolean', description: 'Skip resource decoding, only disassemble Smali (default false)' }
      },
      required: ['path']
    }, rebuild.apk_decode, false);

    this.register('apk_rebuild', 'Rebuild a modified APK from a decoded directory (produced by apk_decode). Recompiles Smali back into DEX and repacks with resources. Must be signed before installing.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the decoded APK directory (from apk_decode)' },
        output_path: { type: 'string', description: 'Output path for rebuilt APK (default: rebuilt/<name>_rebuilt.apk)' }
      },
      required: ['path']
    }, rebuild.apk_rebuild, false);

    this.register('apk_sign', 'Sign an APK with a debug keystore (default) or a custom keystore. Required after rebuilding an APK. Debug signing is auto-generated — safe for research/testing on emulators and sideloaded devices.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the unsigned .apk file' },
        output_path: { type: 'string', description: 'Output path for signed APK (default: same dir with _signed suffix)' },
        use_debug_key: { type: 'boolean', description: 'Use auto-generated debug keystore (default true)' },
        keystore_path: { type: 'string', description: 'Relative path to custom .jks/.keystore file (if use_debug_key is false)' },
        keystore_pass: { type: 'string', description: 'Keystore password' },
        key_alias: { type: 'string', description: 'Key alias inside keystore' },
        key_pass: { type: 'string', description: 'Key password (defaults to keystore_pass)' }
      },
      required: ['path']
    }, rebuild.apk_sign, false);

    this.register('apk_info', 'Extract APK metadata without fully decoding: package name, version, permissions, activities, min/target SDK. Quick reconnaissance tool for Android app analysis.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the .apk file' }
      },
      required: ['path']
    }, rebuild.apk_info, false);

    this.register('jadx_decompile', 'Decompile an Android APK, DEX, AAR, or Java JAR file into readable Java source code using JADX. Output is browsable .java files. Requires jadx on PATH — use install_re_tool to get it.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to .apk / .jar / .dex / .aar file' },
        output_dir: { type: 'string', description: 'Output directory for Java sources (default: decompiled/<name>_java)' },
        decompile_resources: { type: 'boolean', description: 'Also decompile resources (default true)' },
        show_bad_code: { type: 'boolean', description: 'Include partially decompiled/broken methods (default true)' }
      },
      required: ['path']
    }, rebuild.jadx_decompile, false);

    this.register('jar_extract', 'Extract the contents of a JAR, ZIP, or APK archive to a workspace directory. Works like "jar xf" or "unzip". Use to inspect and modify JAR/ZIP internals before rebuilding.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the .jar / .zip / .apk file' },
        output_dir: { type: 'string', description: 'Directory to extract into (default: extracted/<name>)' }
      },
      required: ['path']
    }, rebuild.jar_extract, false);

    this.register('jar_rebuild', 'Repack a directory into a JAR, ZIP, or APK archive. Use after modifying extracted contents. Equivalent to "jar cf" or "zip -r".', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the directory to pack' },
        output_path: { type: 'string', description: 'Output path for the archive (default: rebuilt/<dirname>.jar)' },
        manifest_path: { type: 'string', description: 'Optional: path to a custom MANIFEST.MF file to include' }
      },
      required: ['path']
    }, rebuild.jar_rebuild, false);

    this.register('java_compile', 'Compile .java source files using javac. Accepts a single file or a directory (recursive). Outputs .class files to output_dir. Use after editing decompiled Java to rebuild a JAR.', {
      type: 'object',
      properties: {
        source_path: { type: 'string', description: 'Relative path to .java file or directory containing Java sources' },
        output_dir: { type: 'string', description: 'Directory for compiled .class files (default: compiled/classes)' },
        classpath: { type: 'string', description: 'Optional classpath (colon/semicolon-separated JAR paths)' },
        source_version: { type: 'string', description: 'Java source version (e.g. "8", "11", "17")' },
        target_version: { type: 'string', description: 'Java target bytecode version' }
      },
      required: ['source_path']
    }, rebuild.java_compile, false);

    this.register('dotnet_decompile', 'Decompile a .NET EXE or DLL into C# source code using ilspycmd. Requires .NET SDK and ilspycmd global tool. Use install_re_tool({ tool: "ilspycmd" }) to set up.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to .exe or .dll file' },
        output_dir: { type: 'string', description: 'Output directory for .cs files (default: decompiled/<name>_dotnet)' }
      },
      required: ['path']
    }, rebuild.dotnet_decompile, false);

    this.register('patch_binary', 'Apply raw byte patches to a binary file at specific offsets. Use for binary patching: NOP-ing instructions, changing constants, flipping flags. Creates a .bak backup automatically.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the binary file to patch' },
        patches: {
          type: 'array',
          description: 'Array of patches to apply',
          items: {
            type: 'object',
            properties: {
              offset: { type: 'string', description: 'Byte offset (hex: "0x401234" or decimal: 4198964)' },
              bytes: { type: 'string', description: 'Hex bytes to write (e.g. "90 90 90" for 3 NOPs)' },
              comment: { type: 'string', description: 'Optional label for this patch' }
            },
            required: ['offset', 'bytes']
          }
        },
        output_path: { type: 'string', description: 'Save patched version here (default: overwrites input, with .bak backup)' },
        backup: { type: 'boolean', description: 'Create .bak backup before patching (default true)' }
      },
      required: ['path', 'patches']
    }, rebuild.patch_binary, true);

    this.register('extract_section', 'Extract a named PE binary section (.text, .data, .rsrc, etc.) into a separate file for analysis. Useful for isolating packed shellcode, encrypted data, or resources.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to PE binary' },
        section_name: { type: 'string', description: 'Section name to extract (e.g. ".text", ".rsrc", ".data", "UPX0")' },
        output_path: { type: 'string', description: 'Output path for extracted section bytes' }
      },
      required: ['path', 'section_name']
    }, rebuild.extract_section, false);

    this.register('unminify_js', 'Pretty-print / unminify a minified JavaScript file for readability. Uses prettier if available, falls back to js-beautify or basic built-in formatter. Essential for web app reverse engineering.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to minified .js file' },
        output_path: { type: 'string', description: 'Output path for formatted JS (default: same dir with .unmin.js extension)' }
      },
      required: ['path']
    }, rebuild.unminify_js, false);

    this.register('smali_patch', 'Find and replace text across all Smali files in a decoded APK directory. Batch-modify opcodes, class names, method calls, or string values. Use dry_run first to preview changes before applying.', {
      type: 'object',
      properties: {
        decoded_dir: { type: 'string', description: 'Relative path to decoded APK directory (from apk_decode)' },
        find: { type: 'string', description: 'Text to find in Smali files' },
        replace: { type: 'string', description: 'Replacement text' },
        file_pattern: { type: 'string', description: 'Regex to filter which files to patch (default: .smali$)' },
        dry_run: { type: 'boolean', description: 'If true, only report matches without modifying files (default false)' }
      },
      required: ['decoded_dir', 'find', 'replace']
    }, rebuild.smali_patch, true);

    this.register('install_re_tool', 'Check if a reverse engineering tool is installed and provide installation instructions or auto-install it. Supported: jadx, apktool, ilspycmd, yara, radare2, ghidra, frida, objdump, adb, prettier.', {
      type: 'object',
      properties: {
        tool: { type: 'string', enum: ['jadx', 'apktool', 'ilspycmd', 'yara', 'radare2', 'ghidra', 'frida', 'objdump', 'adb', 'prettier'], description: 'Tool name to check/install' }
      },
      required: ['tool']
    }, rebuild.install_re_tool, false);

    this.register('run_r2', 'Run radare2 (r2) commands on a binary file. Accepts any r2 command string or semicolon-separated list (e.g. "aaa; pdf @ main" to analyze and print main function). Requires radare2 on PATH.', {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the binary to analyze' },
        commands: { type: 'string', description: 'r2 command(s) to run (semicolon-separated). Examples: "i" (file info), "aaa; afl" (analyze + list functions), "pdf @ sym.main" (disassemble main), "iz" (strings), "iE" (exports)' },
        write_mode: { type: 'boolean', description: 'Open in write mode (-w flag) to allow patching via r2 (default false)' }
      },
      required: ['path', 'commands']
    }, rebuild.run_r2, false);

    // 9. Developer Workflow Tools
    this.register('run_tests', 'Detect and run the project test suite (jest, vitest, pytest, phpunit, go test, or npm test). Returns pass/fail and output. Use after making changes to verify nothing broke.', {
      type: 'object',
      properties: {
        framework: { type: 'string', enum: ['auto', 'jest', 'vitest', 'pytest', 'phpunit', 'go', 'npm'], description: 'Test framework (default auto-detect)' },
        extra_args: { type: 'string', description: 'Extra CLI args (e.g. a specific test file or -k filter)' }
      }
    }, devtools.run_tests, false);

    this.register('lint_code', 'Run the project linter (eslint / flake8 / phpcs). Optionally auto-fix. Returns issues found.', {
      type: 'object',
      properties: {
        fix: { type: 'boolean', description: 'Auto-fix fixable problems (eslint --fix)' },
        target: { type: 'string', description: 'Path/glob to lint (default .)' }
      }
    }, devtools.lint_code, false);

    this.register('format_code', 'Format code with the project formatter (prettier / black / php-cs-fixer). Writes changes in place.', {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Path/glob to format (default .)' }
      }
    }, devtools.format_code, true);

    this.register('package_manager', 'Manage dependencies via npm/yarn/pnpm/pip/composer: install, add, remove, list, or update packages.', {
      type: 'object',
      properties: {
        manager: { type: 'string', enum: ['auto', 'npm', 'yarn', 'pnpm', 'pip', 'composer'], description: 'Package manager (default auto-detect)' },
        action: { type: 'string', enum: ['install', 'add', 'remove', 'list', 'update'], description: 'What to do' },
        packages: { type: 'array', items: { type: 'string' }, description: 'Package names for add/remove/update' },
        dev: { type: 'boolean', description: 'Install as a dev dependency' }
      },
      required: ['action']
    }, devtools.package_manager, true);

    this.register('codebase_map', 'Scan the active workspace and return a map of its tech stack, top-level directories, key config files, npm scripts, dependencies, and file-type breakdown. Use this first to understand an unfamiliar project.', {
      type: 'object',
      properties: {}
    }, devtools.codebase_map, false);

    // 10. Docker Tools
    this.register('docker_ps', 'List Docker containers (running, or all with all:true).', {
      type: 'object',
      properties: { all: { type: 'boolean', description: 'Include stopped containers' } }
    }, docker.docker_ps, false);

    this.register('docker_logs', 'Fetch recent logs from a Docker container by name or id.', {
      type: 'object',
      properties: {
        container: { type: 'string', description: 'Container name or id' },
        tail: { type: 'integer', description: 'Number of recent lines (default 200)' }
      },
      required: ['container']
    }, docker.docker_logs, false);

    this.register('docker_compose', 'Run a docker compose action in the workspace: up, down, ps, logs, restart, build, stop, start.', {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['up', 'down', 'ps', 'logs', 'restart', 'build', 'stop', 'start'], description: 'Compose action' },
        service: { type: 'string', description: 'Optional specific service name' },
        detached: { type: 'boolean', description: 'For "up": run detached (default true)' }
      }
    }, docker.docker_compose, true);

    // 11. Web UI / Dashboard Scaffolding
    this.register('list_ui_templates', 'List available prebuilt admin/dashboard UI templates (AdminLTE, Bootstrap 5, Tailwind) that scaffold_dashboard can generate.', {
      type: 'object',
      properties: {}
    }, scaffold.list_ui_templates, false);

    this.register('scaffold_dashboard', 'Generate a complete, professional admin dashboard (sidebar, topbar, stat cards, chart, data table) from a prebuilt theme into the workspace. Makes web apps look developer-built, not AI-mocked. Pick a template from list_ui_templates.', {
      type: 'object',
      properties: {
        template: { type: 'string', enum: ['adminlte', 'bootstrap5', 'tailwind'], description: 'Theme to use (default bootstrap5)' },
        app_name: { type: 'string', description: 'App/brand name shown in the UI' },
        output_dir: { type: 'string', description: 'Workspace sub-folder to write into (default .)' },
        filename: { type: 'string', description: 'Output HTML filename (default dashboard.html)' }
      }
    }, scaffold.scaffold_dashboard, true);

    // 12. Safety — Checkpoints & Secrets Vault
    this.register('create_checkpoint', 'Take a full snapshot of the workspace source (a restore point) before a risky set of changes. Universal — no git needed.', {
      type: 'object',
      properties: { label: { type: 'string', description: 'Optional label for the checkpoint' } }
    }, safety.create_checkpoint, false);

    this.register('list_checkpoints', 'List saved workspace checkpoints (restore points).', {
      type: 'object', properties: {}
    }, safety.list_checkpoints, false);

    this.register('restore_checkpoint', 'Roll the whole workspace back to a saved checkpoint. A safety snapshot of the current state is taken first.', {
      type: 'object',
      properties: { checkpoint_id: { type: 'string', description: 'Checkpoint id from list_checkpoints' } },
      required: ['checkpoint_id']
    }, safety.restore_checkpoint, true);

    this.register('vault_set', 'Store a secret (API key, DB password, token) encrypted at rest in the vault, instead of plaintext in project notes.', {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Secret name, e.g. STRIPE_KEY' },
        value: { type: 'string', description: 'Secret value to encrypt and store' }
      },
      required: ['key', 'value']
    }, safety.vault_set, true);

    this.register('vault_get', 'Retrieve a decrypted secret from the vault by name.', {
      type: 'object',
      properties: { key: { type: 'string', description: 'Secret name' } },
      required: ['key']
    }, safety.vault_get, true);

    this.register('vault_list', 'List the names of secrets stored in the vault (values stay encrypted).', {
      type: 'object', properties: {}
    }, safety.vault_list, false);

    this.register('vault_delete', 'Delete a secret from the vault.', {
      type: 'object',
      properties: { key: { type: 'string', description: 'Secret name to delete' } },
      required: ['key']
    }, safety.vault_delete, true);
  }

  register(name, description, inputSchema, handler, isCritical = false) {
    this.tools[name] = { handler, isCritical };
    this.schemas.push({
      name,
      description,
      inputSchema
    });
  }

  getSchemas() {
    return this.schemas;
  }

  getCategory(name) {
    return TOOL_CATEGORY[name] || 'Other';
  }

  async executeTool(name, params = {}) {
    const tool = this.tools[name];
    if (!tool) {
      throw new Error(`Tool "${name}" is not registered.`);
    }

    const startTime = Date.now();

    // Permission check
    const permission = await permissionsManager.requestApproval({
      tool: name,
      params,
      isCritical: tool.isCritical,
      description: `Tool "${name}" invocation`
    });

    if (!permission.approved) {
      const errResponse = {
        tool: name,
        approved: false,
        error: permission.reason || 'Execution rejected by user permission policy.',
        duration_ms: Date.now() - startTime
      };
      audit.record({ ...errResponse, params, success: false });
      this.emit('toolExecuted', errResponse);
      return errResponse;
    }

    try {
      // Global safety net: no async tool can hang the server forever.
      // (External tools have their own shorter timeouts; this catches stuck
      // handlers and misbehaving plugins.)
      const HARD_TIMEOUT_MS = 15 * 60 * 1000;
      let timeoutHandle;
      const timeoutGuard = new Promise((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Tool "${name}" exceeded the ${HARD_TIMEOUT_MS / 60000}-minute safety timeout and was aborted.`)),
          HARD_TIMEOUT_MS
        );
      });
      const result = await Promise.race([
        Promise.resolve(tool.handler(params)),
        timeoutGuard
      ]).finally(() => clearTimeout(timeoutHandle));
      const executionRecord = {
        tool: name,
        params,
        approved: true,
        success: true,
        result,
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
      audit.record(executionRecord);
      this.emit('toolExecuted', executionRecord);
      return result;
    } catch (err) {
      const errorRecord = {
        tool: name,
        params,
        approved: true,
        success: false,
        error: err.message,
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
      audit.record(errorRecord);
      this.emit('toolExecuted', errorRecord);
      throw err;
    }
  }
}

module.exports = new ToolRegistry();
