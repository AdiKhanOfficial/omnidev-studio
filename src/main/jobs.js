const { spawn, exec } = require('child_process');
const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const workspaceManager = require('./workspace');

class JobsManager extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map(); // jobId -> job object
  }

  createJobId() {
    return `job-${uuidv4().slice(0, 8)}`;
  }

  /**
   * Spawns a command execution job.
   * If isAsync is false and finishes within syncTimeoutMs (default 10s), returns output directly.
   * Otherwise returns running job info with job_id for AI to check later.
   */
  async runCommand({ command, isAsync = false, timeoutSeconds = 300, shell = null }) {
    const jobId = this.createJobId();
    const isWin = os.platform() === 'win32';
    const chosenShell = shell || (isWin ? 'powershell.exe' : '/bin/bash');
    const cwd = workspaceManager.getWorkspace();

    const job = {
      id: jobId,
      command,
      shell: chosenShell,
      cwd,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      outputLines: [],
      isAsync: Boolean(isAsync),
      timeoutSeconds,
      process: null
    };

    this.jobs.set(jobId, job);
    this.emit('jobStarted', this.sanitizeJob(job));

    // Determine shell arguments
    let shellArgs = [];
    if (chosenShell.toLowerCase().includes('powershell')) {
      shellArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command];
    } else if (chosenShell.toLowerCase().includes('cmd')) {
      shellArgs = ['/c', command];
    } else {
      shellArgs = ['-c', command];
    }

    const child = spawn(chosenShell, shellArgs, {
      cwd,
      env: { ...process.env },
      windowsHide: true
    });

    job.process = child;
    job.pid = child.pid;

    const maxBufferedLines = 5000;
    // Coalesce rapid output into batched IPC emits (~120ms) so a chatty
    // process can't flood the renderer and freeze the UI.
    let bufOut = '', bufErr = '', flushTimer = null;
    const flushEmit = () => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (bufErr) { this.emit('jobOutput', { id: jobId, text: bufErr, isError: true }); bufErr = ''; }
      if (bufOut) { this.emit('jobOutput', { id: jobId, text: bufOut, isError: false }); bufOut = ''; }
    };
    const scheduleFlush = () => { if (!flushTimer) flushTimer = setTimeout(flushEmit, 120); };

    const appendOutput = (text, isError = false) => {
      const str = text.toString();
      const time = new Date().toLocaleTimeString();
      const lines = str.split(/\r?\n/);
      for (const line of lines) {
        if (!line && lines.length === 1) continue;
        job.outputLines.push({ time, text: line, isError });
      }
      // Trim in one splice instead of repeated O(n) shifts
      if (job.outputLines.length > maxBufferedLines) {
        job.outputLines.splice(0, job.outputLines.length - maxBufferedLines);
      }
      if (isError) bufErr += str; else bufOut += str;
      // Flush large bursts immediately; otherwise coalesce on the timer
      if (bufOut.length + bufErr.length >= 64 * 1024) flushEmit();
      else scheduleFlush();
    };

    child.stdout.setEncoding('utf8').on('data', appendOutput);
    child.stderr.setEncoding('utf8').on('data', data => appendOutput(data, true));

    // Handle timeout
    let timer = null;
    if (timeoutSeconds > 0) {
      timer = setTimeout(() => {
        if (job.status === 'running') {
          appendOutput(`\n[Process timed out after ${timeoutSeconds}s - Killing process]`, true);
          this.cancelJob(jobId, 'Timeout reached');
        }
      }, timeoutSeconds * 1000);
    }

    const completionPromise = new Promise((resolve) => {
      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        flushEmit();
        if (!job.process) return;
        if (job.status !== 'cancelled') job.status = code === 0 ? 'completed' : 'failed';
        job.exitCode = code;
        job.finishedAt = new Date().toISOString();
        job.process = null;
        this.emit('jobFinished', this.sanitizeJob(job));
        resolve(job);
      });

      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        appendOutput(`Process execution error: ${err.message}`, true);
        flushEmit();
        job.status = 'failed';
        job.exitCode = -1;
        job.finishedAt = new Date().toISOString();
        job.process = null;
        this.emit('jobFinished', this.sanitizeJob(job));
        resolve(job);
      });
    });

    // If caller explicitly wants async execution, return job immediately
    if (isAsync) {
      return {
        job_id: jobId,
        status: 'running',
        message: 'Command launched in background. Use get_job_status or get_job_output with this job_id to monitor progress.',
        started_at: job.startedAt,
        command
      };
    }

    // Wait up to 10 seconds synchronously for fast tasks
    const syncTimeout = 10000;
    let syncTimer;
    const raceResult = await Promise.race([
      completionPromise,
      new Promise(resolve => { syncTimer = setTimeout(() => resolve(null), syncTimeout); })
    ]).finally(() => clearTimeout(syncTimer));

    if (raceResult) {
      // Completed within sync window
      const fullOutput = job.outputLines.map(l => l.text).join('\n');
      return {
        job_id: jobId,
        status: job.status,
        exit_code: job.exitCode,
        output: fullOutput || '(No output produced)',
        duration_ms: new Date(job.finishedAt) - new Date(job.startedAt)
      };
    } else {
      // Still running, notify caller to poll status
      return {
        job_id: jobId,
        status: 'running',
        message: `Command is still running after ${syncTimeout / 1000}s. Job is running in background. Use get_job_status(job_id="${jobId}") to check result later.`,
        current_output: job.outputLines.slice(-30).map(l => l.text).join('\n')
      };
    }
  }

  cancelJob(jobId, reason = 'Cancelled by user') {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'running') {
      return { success: false, message: 'Job not found or not running.' };
    }

    job.status = 'cancelled';
    if (job.process && job.process.pid) {
      if (os.platform() === 'win32') {
        // Windows tree kill
        exec(`taskkill /pid ${job.process.pid} /T /F`, () => {});
      } else {
        job.process.kill('SIGTERM');
      }
    }

    job.finishedAt = new Date().toISOString();
    this.emit('jobCancelled', { id: jobId, reason });
    return { success: true, message: `Job ${jobId} cancelled: ${reason}` };
  }

  getJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return this.sanitizeJob(job);
  }

  getJobOutput(jobId, maxLines = 100) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    const lines = job.outputLines.slice(-maxLines).map(l => l.text).join('\n');
    return {
      job_id: jobId,
      status: job.status,
      exit_code: job.exitCode,
      lines_returned: Math.min(maxLines, job.outputLines.length),
      total_lines: job.outputLines.length,
      output: lines
    };
  }

  listJobs(filterStatus = null) {
    const list = Array.from(this.jobs.values());
    const filtered = filterStatus ? list.filter(j => j.status === filterStatus) : list;
    return filtered.map(j => this.sanitizeJob(j));
  }

  sanitizeJob(job) {
    return {
      id: job.id,
      command: job.command,
      status: job.status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      exitCode: job.exitCode,
      cwd: job.cwd,
      linesCount: job.outputLines.length,
      recentOutput: job.outputLines.slice(-10).map(l => l.text).join('\n')
    };
  }
}

module.exports = new JobsManager();
