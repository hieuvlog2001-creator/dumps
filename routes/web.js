/**
 * Web Routes
 * Handles web page routes and rendering
 * @module routes/web
 */

const express = require('express');
const CONFIG = require('../config');

const router = express.Router();

/**
 * Root route - renders main application page
 * @route GET /
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
router.get('/', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const locals = {
    title: 'Il2CppDumper - Unity IL2CPP File Dumper & Decompiler Online',
    description: 'Free online Il2CppDumper tool for Unity games. Dump IL2CPP binaries, extract metadata, and decompile Unity assemblies. No installation required - works in your browser.',
    header: 'Il2CppDumper Server',
    canonical: baseUrl,
    ogImage: `${baseUrl}/images/il2cppdumper-og.jpg`,
    req: req, // Pass request object for dynamic meta tags
    config: {
      maxFileSize: CONFIG.MAX_FILE_SIZE,
      allowedExtensions: CONFIG.ALLOWED_EXTENSIONS,
      maxConcurrentJobs: CONFIG.MAX_CONCURRENT_JOBS,
      turnstileSiteKey: process.env.SITE_KEY
    }
  };
  res.render('index', locals);
});

module.exports = router;
