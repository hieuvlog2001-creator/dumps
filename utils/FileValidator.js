/**
 * File Validation Utilities
 * Static methods for validating file types, integrity, and security
 * @module FileValidator
 */

const fs = require('fs').promises;
const pathModule = require('path');
const CONFIG = require('../config');
const logger = require('./logger');

/**
 * FileValidator class with static validation methods
 */
class FileValidator {
  /**
   * Validate if a file is an ELF binary by checking magic bytes
   * @static
   * @async
   * @param {string} filePath - Path to the file to validate
   * @returns {Promise<boolean>} True if file is ELF format
   */
  static async validateELF(filePath) {
    try {
      const fd = await fs.open(filePath, 'r');
      const buffer = Buffer.alloc(4);
      await fd.read(buffer, 0, 4, 0);
      await fd.close();

      return buffer.equals(CONFIG.ELF_MAGIC);
    } catch (error) {
      logger.error('ELF validation error:', error);
      return false;
    }
  }

  /**
   * Validate if a file is Il2Cpp metadata by checking signature
   * @static
   * @async
   * @param {string} filePath - Path to the file to validate
   * @returns {Promise<boolean>} True if file has valid metadata signature
   */
  static async validateMetadata(filePath) {
    try {
      const fd = await fs.open(filePath, 'r');
      const buffer = Buffer.alloc(4);
      await fd.read(buffer, 0, 4, 0);
      await fd.close();

      return CONFIG.METADATA_SIGNATURES.some(sig => buffer.equals(sig));
    } catch (error) {
      logger.error('Metadata validation error:', error);
      return false;
    }
  }

  /**
   * Validate file integrity by comparing file size
   * @static
   * @async
   * @param {string} filePath - Path to the file to validate
   * @param {number} expectedSize - Expected file size in bytes
   * @returns {Promise<boolean>} True if file size matches expected size
   */
  static async validateFileIntegrity(filePath, expectedSize) {
    try {
      const stats = await fs.stat(filePath);
      return stats.size === expectedSize && stats.size > 0;
    } catch (error) {
      logger.error('File integrity validation error:', error);
      return false;
    }
  }

  /**
   * Validate that a file exists and is not empty (fallback for chunked uploads)
   * @static
   * @async
   * @param {string} filePath - Path to the file to validate
   * @returns {Promise<boolean>} True if file exists and has content
   */
  static async validateFileExists(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return stats.size > 0;
    } catch (error) {
      logger.error('File existence validation error:', error);
      return false;
    }
  }

  /**
   * Validate ELF file header (buffer-based, doesn't read from disk)
   * @static
   * @param {Buffer} headerBuffer - First 64 bytes of ELF file
   * @returns {boolean} True if header contains valid ELF magic bytes
   */
  static validateELFHeader(headerBuffer) {
    try {
      if (headerBuffer.length < 4) return false;
      return headerBuffer.subarray(0, 4).equals(CONFIG.ELF_MAGIC);
    } catch (error) {
      logger.error('ELF header validation error:', error);
      return false;
    }
  }

  /**
   * Validate metadata file header (buffer-based, doesn't read from disk)
   * @static
   * @param {Buffer} headerBuffer - First 16 bytes of metadata file
   * @returns {boolean} True if header contains valid metadata signature
   */
  static validateMetadataHeader(headerBuffer) {
    try {
      if (headerBuffer.length < 4) return false;
      return CONFIG.METADATA_SIGNATURES.some(sig => headerBuffer.subarray(0, 4).equals(sig));
    } catch (error) {
      logger.error('Metadata header validation error:', error);
      return false;
    }
  }

  /**
   * Validate file extension against allowed extensions
   * @static
   * @param {string} filename - Name of the file to validate
   * @param {string[]} allowedExtensions - Array of allowed extensions
   * @returns {boolean} True if file extension is allowed
   */
  static validateFileExtension(filename, allowedExtensions) {
    const ext = pathModule.extname(filename).toLowerCase();
    return allowedExtensions.includes(ext) || allowedExtensions.includes(pathModule.basename(filename));
  }

  /**
   * Validate file permissions for security
   * @static
   * @async
   * @param {string} filePath - Path to the file to validate
   * @returns {Promise<boolean>} True if file permissions are secure
   */
  static async validateFilePermissions(filePath) {
    try {
      const stats = await fs.stat(filePath);

      if (stats.mode & 0o002) {
        logger.warn(`Insecure file permissions detected for ${filePath}: ${stats.mode.toString(8)}`);
        return false;
      }

      if (stats.mode & 0o020) {
        logger.warn(`Group-writable file detected for ${filePath}: ${stats.mode.toString(8)}`);
      }

      if (!(stats.mode & 0o400)) {
        logger.warn(`File not readable by owner: ${filePath}`);
        return false;
      }

      return true;
    } catch (error) {
      logger.error('File permission validation error:', error);
      return false;
    }
  }
}

module.exports = FileValidator;
