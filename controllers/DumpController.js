/**
 * Il2Cpp Dump Controller
 * Handles Il2CppDumper job processing, validation, and management
 * @module DumpController
 */

const { spawn } = require('child_process');
const fs = require('fs').promises;
const fsSync = require('fs');
const crypto = require('crypto');
const pathModule = require('path');
const CONFIG = require('../config');
const JobManager = require('../services/JobManager');
const SSEManager = require('../services/SSEManager');
const FileValidator = require('../utils/FileValidator');
const logger = require('../utils/logger');
const { fileHash, zipDirectory, removeFolder, cleanupFiles, validateDumperPath, hashStore, saveHashStore } = require('../utils/helpers');

/**
 * Controller for handling Il2Cpp dump operations
 */
class DumpController {
  /**
   * Create a new DumpController instance
   */
  constructor() {
    /** @type {JobManager} */
    this.jobManager = new JobManager();
    /** @type {SSEManager} */
    this.sseManager = new SSEManager();
  }

  /**
   * Process Il2Cpp dump for a given job
   * @async
   * @param {string} jobId - Unique job identifier
   * @param {Object} soFile - SO file object from multer
   * @param {Object} metaFile - Metadata file object from multer
   */
  async processIl2CppDump(jobId, soFile, metaFile) {
    const job = this.jobManager.getJob(jobId);
    if (!job) return;

    this.jobManager.incrementActiveJobs();

    try {
      // Enhanced status updates with more detailed information
      const updateProgress = (progress, message, extraData = {}) => {
        const updateData = {
          status: 'processing',
          progress,
          message,
          jobId,
          timestamp: Date.now(),
          ...extraData
        };

        this.jobManager.updateJob(jobId, { progress, ...extraData });
        this.sseManager.broadcast(jobId, updateData);

        console.log(`[Job ${jobId}] Progress: ${progress}% - ${message}`);
      };

      updateProgress(5, 'Starting validation...');

      // File integrity validation
      // For chunked uploads, we may not have accurate size info, so we'll validate differently
      const [soValid, metaValid] = await Promise.all([
        soFile.size ? FileValidator.validateFileIntegrity(soFile.path, soFile.size) :
          FileValidator.validateFileExists(soFile.path),
        metaFile.size ? FileValidator.validateFileIntegrity(metaFile.path, metaFile.size) :
          FileValidator.validateFileExists(metaFile.path)
      ]);

      if (!soValid || !metaValid) {
        throw new Error('File integrity validation failed');
      }

      // File permission validation
      const [soPerms, metaPerms] = await Promise.all([
        FileValidator.validateFilePermissions(soFile.path),
        FileValidator.validateFilePermissions(metaFile.path)
      ]);

      if (!soPerms || !metaPerms) {
        throw new Error('File permission validation failed - insecure file permissions detected');
      }

      updateProgress(10, 'Validating file formats...');

      // File format validation
      const [isELF, isMetadata] = await Promise.all([
        FileValidator.validateELF(soFile.path),
        FileValidator.validateMetadata(metaFile.path)
      ]);

      if (!isELF) {
        throw new Error('SO file is not a valid ELF binary');
      }
      if (!isMetadata) {
        throw new Error('Metadata file is not a valid Il2Cpp metadata file');
      }

      updateProgress(20, 'Computing file hashes...');

      // Calculate hashes
      const [soHash, metaHash] = await Promise.all([
        fileHash(soFile.path),
        fileHash(metaFile.path)
      ]);

      const combinedHash = crypto.createHash('sha256')
        .update(soHash + metaHash)
        .digest('hex');

      // Check cache
      if (CONFIG.ENABLE_HASH_CHECK && hashStore[combinedHash]) {
        const cachedZip = hashStore[combinedHash].zipPath;
        if (fsSync.existsSync(cachedZip)) {
          const completionData = {
            status: 'completed',
            progress: 100,
            message: 'Using cached result',
            downloadUrl: `/api/download/${pathModule.basename(cachedZip)}`,
            cached: true,
            hash: combinedHash,
            jobId
          };

          this.jobManager.updateJob(jobId, completionData);
          this.sseManager.broadcast(jobId, completionData);
          return;
        }
        delete hashStore[combinedHash];
      }

      updateProgress(30, 'Setting up processing environment...');

      // Create output directory
      const outputDir = pathModule.join(CONFIG.OUTPUT_BASE, 'results', `output-${jobId}`);
      await fs.mkdir(outputDir, { recursive: true });

      const dumperDll = validateDumperPath();
      const args = [dumperDll, soFile.path, metaFile.path, outputDir];

      logger.info(`Starting Il2CppDumper for job ${jobId}: dotnet ${args.join(' ')}`);

      updateProgress(40, 'Running Il2CppDumper...');

      // Run Il2CppDumper with enhanced progress tracking
      const result = await new Promise((resolve, reject) => {
        const dotnet = spawn('dotnet', args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: CONFIG.JOB_TIMEOUT
        });

        dotnet.stdin.write('0\n');

        let output = '';
        let error = '';
        let progressCount = 40;

        // More frequent progress updates during processing
        const progressInterval = setInterval(() => {
          if (progressCount < 80) {
            progressCount += 2;
            updateProgress(progressCount, 'Processing files...', {
              stage: 'dumping'
            });
          }
        }, 2000);

        dotnet.stdout.on('data', data => {
          const text = data.toString();
          output += text;
          logger.debug(`Job ${jobId} STDOUT:`, text.trim());

          // Send real-time output to SSE clients
          this.sseManager.broadcast(jobId, {
            type: 'output',
            data: text.trim(),
            progress: progressCount,
            jobId,
            timestamp: Date.now()
          });
        });

        dotnet.stderr.on('data', data => {
          const text = data.toString();
          error += text;
          logger.debug(`Job ${jobId} STDERR:`, text.trim());

          // Send error output to SSE clients
          this.sseManager.broadcast(jobId, {
            type: 'error_output',
            data: text.trim(),
            progress: progressCount,
            jobId,
            timestamp: Date.now()
          });
        });

        dotnet.on('close', (code) => {
          clearInterval(progressInterval);
          resolve({ code, output, error });
        });

        dotnet.on('error', (err) => {
          clearInterval(progressInterval);
          reject(new Error(`Failed to start Il2CppDumper: ${err.message}`));
        });
      });

      if (result.code !== 0) {
        throw new Error(`Il2CppDumper failed with code ${result.code}:\n${result.error || result.output}`);
      }

      updateProgress(85, 'Creating archive...');

      // Create zip file with progress
      const zipPath = pathModule.join(CONFIG.OUTPUT_BASE, 'results', `dump-${jobId}.zip`);
      await zipDirectory(outputDir, zipPath, (progress) => {
        const totalProgress = 85 + (progress * 0.1);
        updateProgress(totalProgress, `Creating archive... ${progress}%`, {
          stage: 'archiving',
          archiveProgress: progress
        });
      });

      // Update cache
      if (CONFIG.ENABLE_HASH_CHECK) {
        hashStore[combinedHash] = {
          zipPath,
          timestamp: Date.now(),
          jobId,
          originalFiles: {
            soFile: soFile.originalname,
            metaFile: metaFile.originalname
          },
          hashes: { soHash, metaHash, combinedHash }
        };
        await saveHashStore();
      }

      // Final cleanup
      await removeFolder(outputDir);

      const downloadUrl = `/api/download/${pathModule.basename(zipPath)}`;
      const completionData = {
        status: 'completed',
        progress: 100,
        message: 'Dump completed successfully!',
        downloadUrl,
        outputLog: result.output,
        hash: combinedHash,
        cached: false,
        jobId,
        completedAt: Date.now()
      };

      this.jobManager.updateJob(jobId, completionData);
      this.sseManager.broadcast(jobId, completionData);

      logger.info(`Job ${jobId} completed successfully`);

    } catch (error) {
      logger.error(`Job ${jobId} failed:`, error);

      const errorData = {
        status: 'failed',
        error: error.message,
        progress: 0,
        message: 'Processing failed',
        jobId,
        failedAt: Date.now()
      };

      this.jobManager.updateJob(jobId, errorData);
      this.sseManager.broadcast(jobId, errorData);
    } finally {
      this.jobManager.decrementActiveJobs();
      await cleanupFiles([soFile, metaFile]);
    }
  }

  /**
   * Submit a new Il2Cpp dump job
   * @async
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async submitJob(req, res) {
    try {
      let soFilePath, metaFilePath, soFileName, metaFileName;

      // Check if using chunked upload (file paths provided)
      if (req.body.soFilePath && req.body.metaFilePath) {
        soFilePath = req.body.soFilePath;
        metaFilePath = req.body.metaFilePath;
        soFileName = req.body.soFileName;
        metaFileName = req.body.metaFileName;

        // Verify files exist
        const fs = require('fs');
        if (!fs.existsSync(soFilePath) || !fs.existsSync(metaFilePath)) {
          return res.status(400).json({
            success: false,
            error: 'Uploaded files not found'
          });
        }
      } else if (req.files && req.files.soFile && req.files.metaFile) {
        // Fallback to traditional upload
        soFilePath = req.files.soFile[0].path;
        metaFilePath = req.files.metaFile[0].path;
        soFileName = req.files.soFile[0].originalname;
        metaFileName = req.files.metaFile[0].originalname;
      } else {
        return res.status(400).json({
          success: false,
          error: 'Both SO file and metadata file are required'
        });
      }

      if (!this.jobManager.canProcessJob()) {
        // Cleanup uploaded files if using chunked upload
        if (req.body.soFilePath) {
          const fs = require('fs');
          try {
            if (fs.existsSync(soFilePath)) fs.unlinkSync(soFilePath);
            if (fs.existsSync(metaFilePath)) fs.unlinkSync(metaFilePath);
          } catch (error) {
            console.error('Error cleaning up files:', error);
          }
        } else if (req.files) {
          await cleanupFiles([...Object.values(req.files).flat()]);
        }
        return res.status(503).json({
          success: false,
          error: 'Server is at maximum capacity. Please try again later.',
          queuePosition: this.jobManager.activeJobs
        });
      }

      // Create job with file information
      const job = this.jobManager.createJob({
        soFile: soFileName,
        metaFile: metaFileName,
        soFilePath,
        metaFilePath
      });

      // Start processing asynchronously
      setImmediate(() => {
        this.processIl2CppDump(job.id, {
          path: soFilePath,
          originalname: soFileName
        }, {
          path: metaFilePath,
          originalname: metaFileName
        });
      });

      res.json({
        success: true,
        jobId: job.id,
        message: 'Job created successfully',
        estimatedTime: '2-10 minutes',
        progressUrl: `/api/jobs/${job.id}/progress`
      });

    } catch (error) {
      logger.error('Dump submission error:', error);

      if (req.files) {
        await cleanupFiles([...Object.values(req.files).flat()]);
      }

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  getJob(req, res) {
    const job = this.jobManager.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    res.json({
      success: true,
      job
    });
  }

  /**
   * Get list of jobs with optional filtering
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  getAllJobs(req, res) {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const status = req.query.status;

    let result = this.jobManager.getAllJobs(limit, offset);

    if (status) {
      result.jobs = result.jobs.filter(job => job.status === status);
    }

    res.json({
      success: true,
      ...result
    });
  }

  /**
   * Cancel a queued job
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  cancelJob(req, res) {
    const job = this.jobManager.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    if (job.status === 'processing') {
      return res.status(400).json({
        success: false,
        error: 'Cannot cancel job that is currently processing'
      });
    }

    this.jobManager.updateJob(req.params.jobId, {
      status: 'cancelled',
      cancelledAt: Date.now()
    });

    res.json({
      success: true,
      message: 'Job cancelled successfully'
    });
  }
}

module.exports = DumpController;
