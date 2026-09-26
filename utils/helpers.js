/**
 * Utility Functions
 * Common helper functions for file operations, hashing, and system management
 * @module helpers
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const crypto = require('crypto');
const archiver = require('archiver');
const pathModule = require('path');
const CONFIG = require('../config');
const logger = require('./logger');

/**
 * Ensure all required directories exist
 * @async
 */
async function ensureDirectories() {
  const dirs = [
    CONFIG.OUTPUT_BASE,
    pathModule.join(CONFIG.OUTPUT_BASE, 'temp'),
    pathModule.join(CONFIG.OUTPUT_BASE, 'results'),
    'logs'
  ];

  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      logger.error(`Failed to create directory ${dir}:`, error);
    }
  }
}

/**
 * Calculate SHA256 hash of a file
 * @async
 * @param {string} filePath - Path to the file to hash
 * @returns {Promise<string>} SHA256 hash as hexadecimal string
 */
async function fileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fsSync.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Create a ZIP archive from a directory
 * @async
 * @param {string} sourceDir - Source directory to archive
 * @param {string} outPath - Output path for the ZIP file
 * @param {Function} [onProgress] - Progress callback function
 * @returns {Promise<string>} Path to the created ZIP file
 */
async function zipDirectory(sourceDir, outPath, onProgress) {
  return new Promise((resolve, reject) => {
    const output = fsSync.createWriteStream(outPath);
    const archive = archiver('zip', {
      zlib: { level: 9 },
      forceLocalTime: true
    });

    let totalBytes = 0;
    let processedBytes = 0;

    output.on('close', () => resolve(outPath));
    archive.on('error', reject);
    archive.on('progress', (progress) => {
      if (onProgress && totalBytes > 0) {
        const percent = Math.round((processedBytes / totalBytes) * 100);
        onProgress(percent);
      }
    });

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

/**
 * Remove a folder and all its contents
 * @async
 * @param {string} folderPath - Path to the folder to remove
 */
async function removeFolder(folderPath) {
  try {
    if (fsSync.existsSync(folderPath)) {
      await fs.rm(folderPath, { recursive: true, force: true });
    }
  } catch (error) {
    logger.error('Error removing folder:', error);
  }
}

/**
 * Clean up temporary files
 * @async
 * @param {Array} files - Array of file objects with path property
 */
async function cleanupFiles(files) {
  for (const file of files) {
    try {
      if (fsSync.existsSync(file.path)) {
        await fs.unlink(file.path);
      }
    } catch (error) {
      logger.error('Error cleaning up file:', error);
    }
  }
}

/**
 * Validate and find the Il2CppDumper executable path
 * @returns {string} Resolved path to Il2CppDumper.dll
 * @throws {Error} If Il2CppDumper.dll is not found in any expected location
 */
function validateDumperPath() {
  const possiblePaths = [];

  if (process.env.IL2CPP_DUMPER_PATH) {
    possiblePaths.push(process.env.IL2CPP_DUMPER_PATH);
  }

  possiblePaths.push(
    'Il2CppDumper/Il2CppDumper/bin/Release/net8.0/Il2CppDumper.dll',
    'Il2CppDumper/Il2CppDumper.dll',
    'Il2CppDumper.dll'
  );

  for (const path of possiblePaths) {
    const resolvedPath = pathModule.resolve(path);
    if (fsSync.existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }

  throw new Error('Il2CppDumper.dll not found in any expected location');
}

/**
 * In-memory hash store for caching results
 * @type {Object.<string, Object>}
 */
let hashStore = {};

/**
 * Load hash store from persistent storage
 * @async
 */
async function loadHashStore() {
  try {
    const data = await fs.readFile(CONFIG.HASH_STORE_FILE, 'utf-8');
    hashStore = JSON.parse(data);
  } catch {
    hashStore = {};
  }
}

/**
 * Save hash store to persistent storage
 * @async
 */
async function saveHashStore() {
  try {
    await fs.writeFile(CONFIG.HASH_STORE_FILE, JSON.stringify(hashStore, null, 2));
  } catch (error) {
    logger.error('Failed to save hash store:', error);
  }
}

module.exports = {
  ensureDirectories,
  fileHash,
  zipDirectory,
  removeFolder,
  cleanupFiles,
  validateDumperPath,
  loadHashStore,
  saveHashStore,
  hashStore
};
