/**
 * Chunked Upload Middleware
 * Handles resumable chunked file uploads
 * @module middleware/chunkUpload
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CONFIG = require('../config');

/**
 * Generate unique identifier for upload session
 * @param {string} fileName - Original file name
 * @returns {string} Unique identifier
 */
function generateUploadId(fileName) {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  return `${timestamp}_${random}_${fileName}`;
}

/**
 * Get chunk directory path
 * @param {string} uploadId - Upload session ID
 * @returns {string} Directory path
 */
function getChunkDir(uploadId) {
  return path.join(CONFIG.OUTPUT_BASE, 'chunks', uploadId);
}

/**
 * Ensure chunk directory exists
 * @param {string} uploadId - Upload session ID
 */
function ensureChunkDir(uploadId) {
  const chunkDir = getChunkDir(uploadId);
  if (!fs.existsSync(chunkDir)) {
    fs.mkdirSync(chunkDir, { recursive: true });
  }
  return chunkDir;
}

/**
 * Save chunk to disk
 * @param {string} uploadId - Upload session ID
 * @param {number} chunkNumber - Chunk number
 * @param {string} chunkFilePath - Path to the chunk file uploaded by multer
 */
function saveChunk(uploadId, chunkNumber, chunkFilePath) {
  const chunkDir = ensureChunkDir(uploadId);
  const chunkPath = path.join(chunkDir, `chunk_${chunkNumber}`);
  fs.copyFileSync(chunkFilePath, chunkPath);
}

/**
 * Check if chunk exists
 * @param {string} uploadId - Upload session ID
 * @param {number} chunkNumber - Chunk number
 * @returns {boolean} True if chunk exists
 */
function chunkExists(uploadId, chunkNumber) {
  const chunkDir = getChunkDir(uploadId);
  const chunkPath = path.join(chunkDir, `chunk_${chunkNumber}`);
  return fs.existsSync(chunkPath);
}

/**
 * Get all chunks for upload
 * @param {string} uploadId - Upload session ID
 * @returns {string[]} Array of chunk file paths
 */
function getChunks(uploadId) {
  const chunkDir = getChunkDir(uploadId);
  if (!fs.existsSync(chunkDir)) return [];

  return fs.readdirSync(chunkDir)
    .filter(file => file.startsWith('chunk_'))
    .sort((a, b) => {
      const numA = parseInt(a.replace('chunk_', ''));
      const numB = parseInt(b.replace('chunk_', ''));
      return numA - numB;
    })
    .map(file => path.join(chunkDir, file));
}

/**
 * Combine chunks into final file and validate
 * @param {string} uploadId - Upload session ID
 * @param {string} finalPath - Final file path
 * @param {string} fieldName - Field name (soFile or metaFile)
 * @returns {Promise<Object>} Result with success status and validation
 */
async function combineChunks(uploadId, finalPath) {
  const chunks = getChunks(uploadId);
  if (chunks.length === 0) return { success: false };

  const writeStream = fs.createWriteStream(finalPath);

  for (const chunkPath of chunks) {
    const chunkData = fs.readFileSync(chunkPath);
    writeStream.write(chunkData);
  }

  writeStream.end();

  return new Promise((resolve) => {
    writeStream.on('finish', () => {
      // Clean up chunks after successful combination
      cleanupChunks(uploadId);
      resolve({ success: true });
    });

    writeStream.on('error', () => {
      resolve({ success: false, error: 'File combination failed' });
    });
  });
}

/**
 * Clean up chunk files
 * @param {string} uploadId - Upload session ID
 */
function cleanupChunks(uploadId) {
  const chunkDir = getChunkDir(uploadId);
  if (fs.existsSync(chunkDir)) {
    fs.rmSync(chunkDir, { recursive: true, force: true });
  }
}

/**
 * Get upload progress
 * @param {string} uploadId - Upload session ID
 * @param {number} totalChunks - Total number of chunks
 * @returns {Object} Progress information
 */
function getUploadProgress(uploadId, totalChunks) {
  const chunks = getChunks(uploadId);
  return {
    uploadedChunks: chunks.length,
    totalChunks: totalChunks,
    percentage: Math.round((chunks.length / totalChunks) * 100)
  };
}

/**
 * Handle chunked upload request
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
async function handleChunkUpload(req, res) {
  try {
    // Extract resumable.js parameters from the request
    const uploadId = req.body.resumableIdentifier;
    const chunkNumber = parseInt(req.body.resumableChunkNumber);
    const totalChunks = parseInt(req.body.resumableTotalChunks);
    const fileName = req.body.resumableFilename;
    const fieldName = req.body.fieldName;
    const chunk = req.file;

    if (!chunk) {
      return res.status(400).json({ error: 'No chunk provided' });
    }

    // Generate upload ID if not provided
    let currentUploadId = uploadId;
    if (!currentUploadId) {
      currentUploadId = generateUploadId(fileName);
    }

    // Save chunk
    saveChunk(currentUploadId, chunkNumber, chunk.path);

    // Clean up multer temp file
    try {
      fs.unlinkSync(chunk.path);
    } catch (error) {
      console.warn(`Failed to cleanup temp file: ${chunk.path}`, error.message);
    }

    // Check if upload is complete
    const progress = getUploadProgress(currentUploadId, totalChunks);

    if (progress.uploadedChunks === totalChunks) {
      // All chunks received, combine them
      const finalPath = path.join(CONFIG.OUTPUT_BASE, 'temp', `${currentUploadId}_${fileName}`);
      const result = await combineChunks(currentUploadId, finalPath);

      if (result.success) {
        return res.json({
          success: true,
          uploadId: currentUploadId,
          complete: true,
          filePath: finalPath,
          fileName: fileName,
          fieldName: fieldName
        });
      } else {
        return res.status(500).json({
          error: 'Failed to combine chunks',
          details: result.error
        });
      }
    }

    res.json({
      success: true,
      uploadId: currentUploadId,
      complete: false,
      progress: progress
    });

  } catch (error) {
    console.error('Chunk upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
}

/**
 * Check upload status
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
function checkUploadStatus(req, res) {
  try {
    const { uploadId, totalChunks } = req.query;

    if (!uploadId || !totalChunks) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    const progress = getUploadProgress(uploadId, parseInt(totalChunks));

    res.json({
      success: true,
      progress: progress,
      complete: progress.uploadedChunks === parseInt(totalChunks)
    });

  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Status check failed' });
  }
}

module.exports = {
  handleChunkUpload,
  checkUploadStatus,
  cleanupChunks,
  generateUploadId,
  getUploadProgress
};
