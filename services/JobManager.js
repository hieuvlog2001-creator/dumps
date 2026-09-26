/**
 * Job Management Service
 * Handles job queuing, processing, and persistence
 * @module JobManager
 */

const fs = require('fs').promises;
const pathModule = require('path');
const { v4: uuidv4 } = require('uuid');
const CONFIG = require('../config');
const logger = require('../utils/logger');

/**
 * Job data structure
 * @typedef {Object} Job
 * @property {string} id - Unique job identifier
 * @property {string} status - Job status (queued/processing/completed/failed)
 * @property {number} progress - Job completion percentage
 * @property {number} createdAt - Job creation timestamp
 * @property {Object} files - File information
 * @property {Object} size - File sizes
 */

/**
 * JobManager class for handling Il2Cpp dump jobs
 */
class JobManager {
  /**
   * Create a new JobManager instance
   */
  constructor() {
    /** @type {Map<string, Job>} */
    this.jobs = new Map();
    /** @type {number} */
    this.activeJobs = 0;
    this.loadJobs();
  }

  /**
   * Load jobs from persistent storage
   * @async
   */
  async loadJobs() {
    try {
      const data = await fs.readFile(CONFIG.JOBS_STORE_FILE, 'utf-8');
      const jobsData = JSON.parse(data);
      for (const [id, job] of Object.entries(jobsData)) {
        if (job.status === 'processing') {
          job.status = 'failed';
          job.error = 'Server restart during processing';
        }
        this.jobs.set(id, job);
      }
    } catch (error) {
      logger.info('No existing jobs file found, starting fresh');
    }
  }

  /**
   * Save jobs to persistent storage
   * @async
   */
  async saveJobs() {
    try {
      const jobsObj = Object.fromEntries(this.jobs);
      await fs.writeFile(CONFIG.JOBS_STORE_FILE, JSON.stringify(jobsObj, null, 2));
    } catch (error) {
      logger.error('Failed to save jobs store:', error);
    }
  }

  /**
   * Create a new job from uploaded files
   * @param {Object} files - Uploaded files object from multer
   * @returns {Job} The created job object
   */
  createJob(files) {
    const jobId = uuidv4();
    const job = {
      id: jobId,
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
      files: {
        soFile: files.soFile[0].originalname,
        metaFile: files.metaFile[0].originalname
      },
      size: {
        soFile: files.soFile[0].size,
        metaFile: files.metaFile[0].size
      }
    };

    this.jobs.set(jobId, job);
    this.saveJobs();
    return job;
  }

  /**
   * Update an existing job
   * @param {string} jobId - Job identifier
   * @param {Object} updates - Properties to update
   * @returns {Job|null} Updated job or null if not found
   */
  updateJob(jobId, updates) {
    const job = this.jobs.get(jobId);
    if (job) {
      Object.assign(job, updates, { updatedAt: Date.now() });
      this.saveJobs();
      return job;
    }
    return null;
  }

  /**
   * Get a job by ID
   * @param {string} jobId - Job identifier
   * @returns {Job|null} Job object or null if not found
   */
  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  /**
   * Get all jobs with pagination
   * @param {number} [limit=50] - Maximum number of jobs to return
   * @param {number} [offset=0] - Number of jobs to skip
   * @returns {Object} Paginated job results
   */
  getAllJobs(limit = 50, offset = 0) {
    const jobsArray = Array.from(this.jobs.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(offset, offset + limit);

    return {
      jobs: jobsArray,
      total: this.jobs.size,
      limit,
      offset
    };
  }

  /**
   * Check if a new job can be processed
   * @returns {boolean} True if job can be processed
   */
  canProcessJob() {
    return this.activeJobs < CONFIG.MAX_CONCURRENT_JOBS;
  }

  /**
   * Increment active jobs counter
   */
  incrementActiveJobs() {
    this.activeJobs++;
  }

  /**
   * Decrement active jobs counter
   */
  decrementActiveJobs() {
    this.activeJobs = Math.max(0, this.activeJobs - 1);
  }

  /**
   * Clean up old completed/failed jobs
   */
  cleanupOldJobs() {
    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const toDelete = [];

    for (const [id, job] of this.jobs) {
      if (job.createdAt < cutoff && job.status !== 'processing') {
        toDelete.push(id);
      }
    }

    toDelete.forEach(id => this.jobs.delete(id));
    if (toDelete.length > 0) {
      this.saveJobs();
      logger.info(`Cleaned up ${toDelete.length} old jobs`);
    }
  }
}

module.exports = JobManager;
