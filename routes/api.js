/**
 * API Routes
 * REST API endpoints for Il2CppDumper functionality
 * @module routes/api
 */

const express = require('express');
const DumpController = require('../controllers/DumpController');
const SystemController = require('../controllers/SystemController');
const upload = require('../middleware/upload');
const { verifyTurnstileToken } = require('../middleware/turnstile');
const { handleChunkUpload, checkUploadStatus } = require('../middleware/chunkUpload');

const router = express.Router();
const dumpController = new DumpController();
const systemController = new SystemController(dumpController.jobManager, dumpController.sseManager);

/**
 * Job Management Routes
 * @route POST /dump - Submit new dump job
 * @route GET /jobs/:jobId - Get job status
 * @route GET /jobs - Get all jobs
 * @route DELETE /jobs/:jobId - Cancel job
 */
router.post('/dump', upload.fields([
  { name: 'soFile', maxCount: 1 },
  { name: 'metaFile', maxCount: 1 }
]), dumpController.submitJob.bind(dumpController));

router.get('/jobs/:jobId', dumpController.getJob.bind(dumpController));
router.get('/jobs', dumpController.getAllJobs.bind(dumpController));
router.delete('/jobs/:jobId', verifyTurnstileToken, dumpController.cancelJob.bind(dumpController));

/**
 * SSE Progress endpoint for real-time job updates
 * @route GET /jobs/:jobId/progress
 */
router.get('/jobs/:jobId/progress', systemController.handleSSEProgress.bind(systemController));

/**
 * Download processed dump files
 * @route GET /download/:filename
 */
router.get('/download/:filename', systemController.downloadFile.bind(systemController));

/**
 * Health check endpoint
 * @route GET /health
 */
router.get('/health', systemController.getHealth.bind(systemController));

/**
 * Cache Management Routes
 * @route GET /cache/stats - Get cache statistics
 * @route DELETE /cache - Clear all cache
 * @route DELETE /cache/:hash - Delete specific cache entry
 */
router.get('/cache/stats', systemController.getCacheStats.bind(systemController));
router.delete('/cache', verifyTurnstileToken, systemController.clearCache.bind(systemController));
router.delete('/cache/:hash', verifyTurnstileToken, systemController.deleteCacheEntry.bind(systemController));

/**
 * File validation endpoint
 * @route POST /validate
 */
router.post('/validate', upload.single('file'), systemController.validateFile.bind(systemController));

/**
 * Chunked upload endpoints
 * @route POST /upload/chunk - Upload file chunk
 * @route GET /upload/chunk - Check chunk existence (for Resumable.js)
 * @route GET /upload/status - Check upload status
 */
router.post('/upload/chunk', upload.chunkUpload.single('chunk'), handleChunkUpload);
router.get('/upload/chunk', systemController.checkChunkExistence.bind(systemController));
router.get('/upload/status', checkUploadStatus);

/**
 * Validate uploaded files by path
 * @route POST /validate/uploaded
 */
router.post('/validate/uploaded', systemController.validateUploadedFiles.bind(systemController));

/**
 * System information endpoint
 * @route GET /system/info
 */
router.get('/system/info', systemController.getSystemInfo.bind(systemController));

/**
 * Bulk operations endpoint
 * @route GET /jobs/export
 */
router.get('/jobs/export', systemController.exportJobs.bind(systemController));

/**
 * Metrics endpoint for monitoring
 * @route GET /metrics
 */
router.get('/metrics', systemController.getMetrics.bind(systemController));

module.exports = router;
