const jobsManager = require('../jobs');

module.exports = {
  run_command: async ({ command, is_background = false, timeout_seconds = 300, shell = null }) => {
    if (!command || typeof command !== 'string' || !command.trim()) {
      throw new Error('A non-empty "command" string is required.');
    }

    const result = await jobsManager.runCommand({
      command: command.trim(),
      isAsync: Boolean(is_background),
      timeoutSeconds: Number(timeout_seconds) || 300,
      shell
    });

    return result;
  },

  get_job_status: async ({ job_id }) => {
    if (!job_id) throw new Error('job_id is required');
    const job = jobsManager.getJob(job_id);
    if (!job) {
      throw new Error(`Job not found: ${job_id}`);
    }
    return job;
  },

  list_jobs: async ({ status_filter = null }) => {
    return {
      jobs: jobsManager.listJobs(status_filter)
    };
  },

  cancel_job: async ({ job_id, reason = null }) => {
    if (!job_id) throw new Error('job_id is required');
    return jobsManager.cancelJob(job_id, reason || 'Cancelled by AI request');
  },

  get_job_output: async ({ job_id, max_lines = 100 }) => {
    if (!job_id) throw new Error('job_id is required');
    const result = jobsManager.getJobOutput(job_id, Number(max_lines) || 100);
    if (!result) {
      throw new Error(`Job not found: ${job_id}`);
    }
    return result;
  }
};
