/**
 * Application Configuration
 * Centralized configuration with environment variable support
 * @module config
 */

const pathModule = require('path');

/**
 * Application configuration object
 * @typedef {Object} Config
 * @property {boolean} ENABLE_HASH_CHECK - Enable result caching
 * @property {string} OUTPUT_BASE - Base directory for file operations
 * @property {string} HASH_STORE_FILE - Path to hash store file
 * @property {string} JOBS_STORE_FILE - Path to jobs store file
 * @property {number} MAX_FILE_SIZE - Maximum file size in bytes (500MB)
 * @property {number} CACHE_CLEANUP_INTERVAL - Cache cleanup interval in ms
 * @property {number} MAX_CACHE_AGE - Maximum cache age in ms
 * @property {number} MAX_CONCURRENT_JOBS - Maximum concurrent jobs
 * @property {number} JOB_TIMEOUT - Job timeout in ms
 * @property {Object} ALLOWED_EXTENSIONS - Allowed file extensions by type
 * @property {Buffer} ELF_MAGIC - ELF file magic bytes
 * @property {Buffer[]} METADATA_SIGNATURES - Il2Cpp metadata signatures
 */

/**
 * Application configuration
 * @type {Config}
 */
const CONFIG = {
  ENABLE_HASH_CHECK: process.env.ENABLE_HASH_CHECK !== 'false',
  OUTPUT_BASE: pathModule.resolve(process.env.OUTPUT_BASE || 'uploads'),
  HASH_STORE_FILE: pathModule.resolve(process.env.HASH_STORE_FILE || 'hashes.json'),
  JOBS_STORE_FILE: pathModule.resolve(process.env.JOBS_STORE_FILE || 'jobs.json'),
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE) || 500 * 1024 * 1024,
  CACHE_CLEANUP_INTERVAL: parseInt(process.env.CACHE_CLEANUP_INTERVAL) || 24 * 60 * 60 * 1000,
  MAX_CACHE_AGE: parseInt(process.env.MAX_CACHE_AGE) || 7 * 24 * 60 * 60 * 1000,
  MAX_CONCURRENT_JOBS: parseInt(process.env.MAX_CONCURRENT_JOBS) || 3,
  JOB_TIMEOUT: parseInt(process.env.JOB_TIMEOUT) || 600000,
  ALLOWED_EXTENSIONS: {
    soFile: ['.so', '.dll', '.dylib'],
    metaFile: ['.dat', '.meta', 'global-metadata.dat'],
    file: ['.so', '.dll', '.dylib', '.dat', '.meta']
  },
  ELF_MAGIC: Buffer.from([0x7F, 0x45, 0x4C, 0x46]),
  METADATA_SIGNATURES: [
    Buffer.from([0xAF, 0x1B, 0xB1, 0xFA]),
    Buffer.from([0xFA, 0xB1, 0x1B, 0xAF])
  ]
};

module.exports = CONFIG;
