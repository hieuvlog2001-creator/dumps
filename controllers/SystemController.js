/**
 * System Controller
 * Handles system-level operations like health checks, cache management, and file validation
 * @module SystemController
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const pathModule = require('path');
const CONFIG = require('../config');
const JobManager = require('../services/JobManager');
const FileValidator = require('../utils/FileValidator');
const logger = require('../utils/logger');
const { cleanupFiles, validateDumperPath, hashStore, saveHashStore } = require('../utils/helpers');
const SSEManager = require('../services/SSEManager');
/**
 * System controller for administrative operations
 */
class SystemController {
  /**
   * Create a new SystemController instance
   * @param {JobManager} jobManager - Shared job manager instance
   * @param {SSEManager} sseManager - Shared SSE manager instance
   */
  constructor(jobManager = null, sseManager = null) {
    /** @type {JobManager} */
    this.jobManager = jobManager || new JobManager();
    /** @type {SSEManager} */
    this.sseManager = sseManager || new SSEManager();
  }

  /**
   * Validate uploaded file format and integrity
   * Optimized to read only headers/metadata, not full file content
   * @async
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async validateFile(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file provided'
        });
      }

      const file = req.file;
      const results = {
        filename: file.originalname,
        size: file.size,
        type: 'unknown',
        valid: false,
        details: {}
      };

      // Determine file type and validate
      const ext = pathModule.extname(file.originalname).toLowerCase();

      if (['.so', '.dll', '.dylib'].includes(ext)) {
        results.type = 'binary';

        // Read only the ELF header (first 64 bytes) for validation
        try {
          const buffer = Buffer.alloc(64);
          const fd = await fs.open(file.path, 'r');
          await fd.read(buffer, 0, 64, 0);
          await fd.close();

          // Validate ELF magic bytes
          results.valid = FileValidator.validateELFHeader(buffer);

          if (results.valid) {
            results.details = {
              architecture: buffer[4] === 1 ? '32-bit' : '64-bit',
              endianness: buffer[5] === 1 ? 'little' : 'big',
              osAbi: buffer[7],
              type: buffer.readUInt16LE(16)
            };
          }
        } catch (error) {
          logger.warn('ELF header validation failed:', error);
          results.valid = false;
        }
      } else if (['.dat', '.meta'].includes(ext) || file.originalname.includes('global-metadata')) {
        results.type = 'metadata';

        // Read only the metadata header for validation
        try {
          const buffer = Buffer.alloc(16);
          const fd = await fs.open(file.path, 'r');
          await fd.read(buffer, 0, 16, 0);
          await fd.close();

          results.valid = FileValidator.validateMetadataHeader(buffer);

          if (results.valid) {
            const buffer = Buffer.alloc(32);
            const fd = await fs.open(file.path, 'r');
            await fd.read(buffer, 0, 32, 0);
            await fd.close();

            results.details = {
              signature: buffer.slice(0, 4).toString('hex'),
              version: buffer.readUInt32LE(4),
              stringLiteralOffset: buffer.readUInt32LE(8),
              stringLiteralSize: buffer.readUInt32LE(12)
            };
          }
          } catch (error) {
            logger.warn('Metadata analysis failed:', error);
          }
      }

      // Calculate hash
      results.hash = await require('../utils/helpers').fileHash(file.path);

      // Cleanup
      await cleanupFiles([file]);

      res.json({
        success: true,
        validation: results
      });

    } catch (error) {
      logger.error('File validation error:', error);

      if (req.file) {
        await cleanupFiles([req.file]);
      }

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get system health status
   * @async
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getHealth(req, res) {
    try {
      const dumperPath = validateDumperPath();
      const stats = await fs.stat(dumperPath);

      const healthData = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        dumper: {
          available: true,
          //path: dumperPath,
          size: stats.size,
          modified: stats.mtime
        },
        jobs: {
          active: this.jobManager.activeJobs,
          total: this.jobManager.jobs.size,
          maxConcurrent: CONFIG.MAX_CONCURRENT_JOBS
        },
        cache: {
          entries: Object.keys(hashStore).length,
          enabled: CONFIG.ENABLE_HASH_CHECK
        },
        system: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodeVersion: process.version
        }
      };

      res.json(healthData);
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Get cache statistics
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  getCacheStats(req, res) {
    const stats = {
      totalEntries: Object.keys(hashStore).length,
      enabled: CONFIG.ENABLE_HASH_CHECK,
      maxAge: CONFIG.MAX_CACHE_AGE,
      totalSize: 0,
      entries: []
    };

    if (stats.totalEntries > 0) {
      stats.oldestEntry = Math.min(...Object.values(hashStore).map(e => e.timestamp));
      stats.newestEntry = Math.max(...Object.values(hashStore).map(e => e.timestamp));

      // Calculate total cache size and collect entry details
      for (const [hash, entry] of Object.entries(hashStore)) {
        const entryStats = { hash, ...entry, exists: false, size: 0 };

        try {
          if (fsSync.existsSync(entry.zipPath)) {
            const stat = fsSync.statSync(entry.zipPath);
            entryStats.size = stat.size;
            entryStats.exists = true;
            stats.totalSize += stat.size;
          }
        } catch (error) {
          logger.warn(`Cache entry ${hash} file check failed:`, error);
        }

        stats.entries.push(entryStats);
      }
    }

    res.json({
      success: true,
      stats
    });
  }

  /**
   * Clear all cached entries
   * @async
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async clearCache(req, res) {
    try {
      let deletedCount = 0;
      let deletedSize = 0;

      for (const [hash, entry] of Object.entries(hashStore)) {
        try {
          if (fsSync.existsSync(entry.zipPath)) {
            const stat = fsSync.statSync(entry.zipPath);
            await fs.unlink(entry.zipPath);
            deletedSize += stat.size;
          }
          deletedCount++;
        } catch (error) {
          logger.error(`Failed to delete cache entry ${hash}:`, error);
        }
      }

      // Clear the hash store object
      Object.keys(hashStore).forEach(key => delete hashStore[key]);
      await saveHashStore();

      res.json({
        success: true,
        message: `Cleared cache: ${deletedCount} entries, ${Math.round(deletedSize / 1024 / 1024)}MB freed`
      });
    } catch (error) {
      logger.error('Cache clear error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async deleteCacheEntry(req, res) {
    const hash = req.params.hash;
    const entry = hashStore[hash];

    if (!entry) {
      return res.status(404).json({
        success: false,
        error: 'Cache entry not found'
      });
    }

    try {
      let deletedSize = 0;
      if (fsSync.existsSync(entry.zipPath)) {
        const stat = fsSync.statSync(entry.zipPath);
        await fs.unlink(entry.zipPath);
        deletedSize = stat.size;
      }

      delete hashStore[hash];
      await saveHashStore();

      res.json({
        success: true,
        message: `Cache entry deleted: ${Math.round(deletedSize / 1024 / 1024)}MB freed`
      });
    } catch (error) {
      logger.error(`Failed to delete cache entry ${hash}:`, error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  getSystemInfo(req, res) {
    const systemInfo = {
      server: {
        version: process.env.npm_package_version || '1.0.0',
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        uptime: process.uptime()
      },
      config: {
        maxFileSize: CONFIG.MAX_FILE_SIZE,
        maxConcurrentJobs: CONFIG.MAX_CONCURRENT_JOBS,
        cacheEnabled: CONFIG.ENABLE_HASH_CHECK,
        maxCacheAge: CONFIG.MAX_CACHE_AGE,
        jobTimeout: CONFIG.JOB_TIMEOUT
      },
      limits: {
        maxFileSize: `${Math.round(CONFIG.MAX_FILE_SIZE / 1024 / 1024)}MB`,
        allowedExtensions: CONFIG.ALLOWED_EXTENSIONS
      },
      statistics: {
        totalJobs: this.jobManager.jobs.size,
        activeJobs: this.jobManager.activeJobs,
        cacheEntries: Object.keys(hashStore).length
      }
    };

    res.json({
      success: true,
      info: systemInfo
    });
  }

  exportJobs(req, res) {
    const jobs = Array.from(this.jobManager.jobs.values());
    const exportData = {
      exported: new Date().toISOString(),
      totalJobs: jobs.length,
      jobs: jobs.map(job => ({
        ...job,
        // Remove sensitive data
        files: job.files ? Object.keys(job.files) : []
      }))
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="jobs-export-${Date.now()}.json"`);
    res.json(exportData);
  }

  getMetrics(req, res) {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);
    const dayAgo = now - (24 * 60 * 60 * 1000);

    const jobs = Array.from(this.jobManager.jobs.values());

    const metrics = {
      timestamp: new Date().toISOString(),
      jobs: {
        total: jobs.length,
        active: this.jobManager.activeJobs,
        completed: jobs.filter(j => j.status === 'completed').length,
        failed: jobs.filter(j => j.status === 'failed').length,
        lastHour: jobs.filter(j => j.createdAt > hourAgo).length,
        lastDay: jobs.filter(j => j.createdAt > dayAgo).length
      },
      cache: {
        entries: Object.keys(hashStore).length,
        hitRate: jobs.length > 0 ? jobs.filter(j => j.cached).length / jobs.length : 0
      },
      system: {
        uptime: process.uptime(),
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        }
      }
    };

    res.json({
      success: true,
      metrics
    });
  }

  /**
   * Validate uploaded files by path with security checks
   * @async
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async validateUploadedFiles(req, res) {
    try {
      const { soFilePath, metaFilePath } = req.body;

      if (!soFilePath || !metaFilePath) {
        return res.status(400).json({
          success: false,
          error: 'Both soFilePath and metaFilePath are required'
        });
      }

      // Security: Validate file paths
      const path = require('path');

      // Helper function to validate file path
      const validateFilePath = (filePath, expectedDir, fileType) => {
        try {
          // Resolve the path to prevent directory traversal
          const resolvedPath = path.resolve(filePath);
          const expectedPath = path.resolve(expectedDir);

          // Check if path is within expected directory
          if (!resolvedPath.startsWith(expectedPath)) {
            return { valid: false, error: 'Path outside allowed directory' };
          }

          // Check for dangerous characters
          if (resolvedPath.includes('..') || resolvedPath.includes('\0')) {
            return { valid: false, error: 'Invalid path characters' };
          }

          // Additional security: Check for sensitive file patterns
          const sensitivePatterns = [
            /\/etc\//,
            /\/proc\//,
            /\/sys\//,
            /\/dev\//,
            /\/var\/log\//,
            /\/home\//,
            /\/root\//,
            /\/usr\/local\//,
            /\/opt\//,
            /config/i,
            /settings/i,
            /secret/i,
            /private/i,
            /\.env/,
            /\.git/,
            /node_modules/,
            /package\.json/,
            /yarn\.lock/,
            /package-lock\.json/
          ];

          const fileName = path.basename(resolvedPath);
          for (const pattern of sensitivePatterns) {
            if (pattern.test(resolvedPath) || pattern.test(fileName)) {
              return { valid: false, error: 'Access to sensitive file blocked' };
            }
          }

          // Validate file extension based on type
          const allowedExtensions = {
            soFile: ['.so', '.dll', '.dylib'],
            metaFile: ['.dat', '.meta']
          };

          const fileExt = path.extname(fileName).toLowerCase();
          if (!allowedExtensions[fileType]?.includes(fileExt)) {
            return { valid: false, error: `Invalid file extension for ${fileType}` };
          }

          // Validate filename pattern (should match upload format)
          const expectedPattern = /^[a-zA-Z0-9_-]+_[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/;
          if (!expectedPattern.test(fileName)) {
            return { valid: false, error: 'Invalid filename format' };
          }

          // Check if file exists
          const fs = require('fs');
          if (!fs.existsSync(resolvedPath)) {
            return { valid: false, error: 'File does not exist' };
          }

          // Check file size (prevent extremely large files)
          const stats = fs.statSync(resolvedPath);
          const maxSize = fileType === 'soFile' ? 500 * 1024 * 1024 : 100 * 1024 * 1024; // 500MB for SO, 100MB for meta
          if (stats.size > maxSize) {
            return { valid: false, error: 'File too large' };
          }

          return { valid: true, resolvedPath };
        } catch (error) {
          return { valid: false, error: 'Path validation failed' };
        }
      };

      // Validate SO file path
      const soValidation = validateFilePath(soFilePath, CONFIG.OUTPUT_BASE, 'soFile');
      if (!soValidation.valid) {
        logger.warn(`Security violation - SO file path validation failed: ${soValidation.error}`, {
          path: soFilePath,
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });
        return res.status(400).json({
          success: false,
          error: `SO file path validation failed: ${soValidation.error}`
        });
      }

      // Validate metadata file path
      const metaValidation = validateFilePath(metaFilePath, CONFIG.OUTPUT_BASE, 'metaFile');
      if (!metaValidation.valid) {
        logger.warn(`Security violation - Metadata file path validation failed: ${metaValidation.error}`, {
          path: metaFilePath,
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });
        return res.status(400).json({
          success: false,
          error: `Metadata file path validation failed: ${metaValidation.error}`
        });
      }

      const validatedSoPath = soValidation.resolvedPath;
      const validatedMetaPath = metaValidation.resolvedPath;

      // Log successful validation
      logger.info('File path validation successful', {
        soFile: path.basename(validatedSoPath),
        metaFile: path.basename(validatedMetaPath),
        ip: req.ip
      });

      // Validate file types and integrity
      const [soExists, soValid, metaExists, metaValid] = await Promise.all([
        FileValidator.validateFileExists(validatedSoPath),
        FileValidator.validateELF(validatedSoPath),
        FileValidator.validateFileExists(validatedMetaPath),
        FileValidator.validateMetadata(validatedMetaPath)
      ]);

      const validation = {
        soFile: {
          exists: soExists,
          valid: soValid,
          filename: path.basename(validatedSoPath)
        },
        metaFile: {
          exists: metaExists,
          valid: metaValid,
          filename: path.basename(validatedMetaPath)
        }
      };

      const allValid = soExists && soValid && metaExists && metaValid;

      res.json({
        success: true,
        validation,
        valid: allValid
      });

    } catch (error) {
      logger.error('Uploaded file validation error:', error);
      res.status(500).json({
        success: false,
        error: 'Validation failed'
      });
    }
  }

  /**
   * Handle Server-Sent Events for job progress
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  handleSSEProgress(req, res) {
    const jobId = req.params.jobId;
    const job = this.jobManager.getJob(jobId);

    if (!job) {
      console.log(`[SSE] Job ${jobId} not found`);
      return res.status(404).json({ error: 'Job not found' });
    }

    console.log(`[SSE] Client connected for job ${jobId}`);

    // Use writeHead to set all headers at once - most reliable approach
    try {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
        'X-Accel-Buffering': 'no'
        // Don't set Content-Length or Transfer-Encoding - let Node.js handle it
      });
    } catch (error) {
      console.error(`[SSE] Failed to set headers for job ${jobId}:`, error);
      return res.status(500).json({ error: 'Failed to establish SSE connection' });
    }

    // Disable timeout for SSE connections
    res.setTimeout(0);

    // Track connection state
    let isConnected = true;
    let keepAliveInterval;

    // Graceful cleanup function
    const cleanup = () => {
      if (!isConnected) return;

      isConnected = false;
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
      this.sseManager.removeConnection(jobId, res);
      console.log(`[SSE] Cleaned up connection for job ${jobId}`);
    };

    // Handle client disconnect
    res.on('close', () => {
      console.log(`[SSE] Client disconnected from job ${jobId}`);
      cleanup();
    });

    res.on('error', (err) => {
      console.warn(`[SSE] Connection error for job ${jobId}:`, err.message);
      cleanup();
    });

    // Enhanced message sending function with retry logic
    const sendSSEMessage = (data, retries = 1) => {
      if (!isConnected || res.destroyed || res.finished) {
        return false;
      }

      try {
        const message = `data: ${JSON.stringify(data)}\n\n`;
        const success = res.write(message);

        if (!success && retries > 0) {
          // If write buffer is full, wait and retry once
          res.once('drain', () => {
            sendSSEMessage(data, retries - 1);
          });
        }

        return true;
      } catch (err) {
        console.warn(`[SSE] Failed to send message to job ${jobId}:`, err.message);
        cleanup();
        return false;
      }
    };

    // Send initial data
    const initialData = {
      status: job.status,
      progress: job.progress || 0,
      message: `Job ${job.status}`,
      jobId: jobId,
      timestamp: Date.now()
    };

    if (!sendSSEMessage(initialData)) {
      return; // Connection already failed
    }

    console.log(`[SSE] Sent initial progress to job ${jobId}`, initialData);

    // Register connection with the SSE manager
    this.sseManager.addConnection(jobId, res);

    // Keep-alive ping every 30s
    keepAliveInterval = setInterval(() => {
      if (!isConnected) {
        clearInterval(keepAliveInterval);
        return;
      }

      try {
        const success = res.write(`: keep-alive ${Date.now()}\n\n`);
        if (!success) {
          console.warn(`[SSE] Keep-alive write buffer full for job ${jobId}`);
        }
      } catch (err) {
        console.warn(`[SSE] Keep-alive failed for job ${jobId}:`, err.message);
        cleanup();
      }
    }, 30000);

    // Send completion data for already finished jobs
    if (job.status === 'completed' || job.status === 'failed') {
      setTimeout(() => {
        if (isConnected) {
          sendSSEMessage({
            status: job.status,
            progress: job.status === 'completed' ? 100 : 0,
            message: job.status === 'completed' ? 'Job completed' : `Job failed: ${job.error || 'Unknown error'}`,
            ...(job.downloadUrl && { downloadUrl: job.downloadUrl }),
            ...(job.error && { error: job.error }),
            jobId: jobId,
            timestamp: Date.now()
          });
        }
      }, 100);
    }
  }

  /**
   * Handle file downloads
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  downloadFile(req, res) {
    try {
      const filename = req.params.filename;

      // Sanitize filename
      if (!/^dump-[a-f0-9-]+\.zip$/.test(filename)) {
        return res.status(400).json({ error: 'Invalid filename format' });
      }

      const filePath = pathModule.join(CONFIG.OUTPUT_BASE, 'results', filename);

      if (!fsSync.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
      }

      const stat = fsSync.statSync(filePath);

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'private, max-age=3600');

      const stream = fsSync.createReadStream(filePath);
      stream.pipe(res);

      stream.on('error', (error) => {
        logger.error('Download error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Download failed' });
        }
      });
    } catch (error) {
      logger.error('Download setup error:', error);
      res.status(500).json({ error: 'Download failed' });
    }
  }

  /**
   * Handle chunk existence check for Resumable.js
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  checkChunkExistence(req, res) {
    const { resumableIdentifier, resumableChunkNumber } = req.query;
    if (!resumableIdentifier || !resumableChunkNumber) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    // For now, always return 404 to indicate chunk doesn't exist
    // This forces Resumable.js to upload all chunks
    res.status(404).end();
  }
}

module.exports = SystemController;
