/**
 * Multer Upload Middleware
 * Configures file upload handling with validation and security
 * @module middleware/upload
 */

const multer = require('multer');
const CONFIG = require('../config');
const FileValidator = require('../utils/FileValidator');

/**
 * File filter function for multer
 * @param {Object} req - Express request object
 * @param {Object} file - Multer file object
 * @param {Function} cb - Callback function
 */
const fileFilter = (req, file, cb) => {
  const allowedExts = CONFIG.ALLOWED_EXTENSIONS[file.fieldname];
  if (!allowedExts) {
    return cb(new Error(`Unexpected field: ${file.fieldname}`), false);
  }

  if (!FileValidator.validateFileExtension(file.originalname, allowedExts)) {
    return cb(new Error(`Invalid file type for ${file.fieldname}. Allowed: ${allowedExts.join(', ')}`), false);
  }

  cb(null, true);
};

/**
 * Configured multer instance for file uploads
 * @type {multer.Multer}
 */
const upload = multer({
  dest: CONFIG.OUTPUT_BASE + '/temp/',
  limits: {
    fileSize: CONFIG.MAX_FILE_SIZE,
    files: 2,
    fieldSize: 1024 * 1024
  },
  fileFilter
});

/**
 * Chunk upload multer instance (no file extension validation)
 * @type {multer.Multer}
 */
const chunkUpload = multer({
  dest: CONFIG.OUTPUT_BASE + '/temp/',
  limits: {
    fileSize: CONFIG.MAX_FILE_SIZE,
    files: 1,
    fieldSize: 1024 * 1024
  }
});

module.exports = upload;
module.exports.chunkUpload = chunkUpload;
