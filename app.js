/**
 * Il2CppDumper Express Application
 * Main application setup with security, middleware, and routing
 * @module app
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const expressLayouts = require('express-ejs-layouts');
const CONFIG = require('./config');
const logger = require('./utils/logger');
const { ensureDirectories, loadHashStore } = require('./utils/helpers');
const JobManager = require('./services/JobManager');

const webRoutes = require('./routes/web');
const apiRoutes = require('./routes/api');

const app = express();
const jobManager = new JobManager();

// Trust proxy for accurate IP detection (important for rate limiting)
app.set('trust proxy', 1);
/**
 * Security headers and CSP configuration
 */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://static.cloudflareinsights.com",
        "https://challenges.cloudflare.com",
        "https://cdn.jsdelivr.net"
      ],
      scriptSrcElem: [
        "'self'",
        "'unsafe-inline'",
        "https://static.cloudflareinsights.com",
        "https://challenges.cloudflare.com",
        "https://cdn.jsdelivr.net"
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://cdnjs.cloudflare.com",
        "https://fonts.googleapis.com",
        "https://challenges.cloudflare.com",
        "https://cdn.jsdelivr.net"
      ],
      styleSrcElem: [
        "'self'",
        "'unsafe-inline'",
        "https://cdnjs.cloudflare.com",
        "https://fonts.googleapis.com",
        "https://challenges.cloudflare.com",
        "https://cdn.jsdelivr.net"
      ],
      fontSrc: [
        "'self'",
        "https://cdnjs.cloudflare.com",
        "https://fonts.gstatic.com",
        "https://cdn.jsdelivr.net"
      ],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: [
        "'self'",
        "https://challenges.cloudflare.com",
        "https://cdn.jsdelivr.net"
      ],
      frameSrc: [
        "'self'",
        "https://challenges.cloudflare.com"
      ],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: []
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));
/**
 * CORS configuration for cross-origin requests
 */
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    const allowedOrigins = process.env.CORS_ORIGIN ?
      process.env.CORS_ORIGIN.split(',').map(o => o.trim()) :
      [];

    if (process.env.NODE_ENV !== 'production') {
      if (origin.match(/^https?:\/\/localhost(:\d+)?$/)) {
        return callback(null, true);
      }
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/**
 * Rate limiting configuration
 * @param {number} windowMs - Time window in milliseconds
 * @param {number} max - Maximum requests per window
 * @param {string} message - Error message for rate limit exceeded
 */
const createRateLimit = (windowMs, max, message) => rateLimit({
  windowMs,
  max,
  message: { error: message },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiting configuration
app.use('/api/dump', createRateLimit(15 * 60 * 1000, 5, 'Too many dump requests'));

// Aggressive bypass for upload operations
app.use('/api/upload/', (req, res, next) => {
  console.log(`🔄 Bypassing rate limit for: ${req.method} ${req.path} from ${req.ip}`);

  // Set headers to try to bypass Cloudflare rate limiting
  res.set({
    'X-Rate-Limit-Bypassed': 'true',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'X-Requested-With': 'XMLHttpRequest'
  });

  return next();
});

// General API rate limiting
app.use('/api/', createRateLimit(1 * 60 * 1000, 60, 'Too many API requests'));

/**
 * View engine and static file configuration
 */
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layouts/layout');
app.use('/static', express.static('public', { maxAge: '1d' }));

/**
 * Route configuration
 */
app.use('/', webRoutes);
app.use('/api', apiRoutes);

/**
 * Global error handling middleware
 */
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  if (error instanceof require('multer').MulterError) {
    const errorMessages = {
      'LIMIT_FILE_SIZE': 'File too large',
      'LIMIT_FILE_COUNT': 'Too many files',
      'LIMIT_FIELD_COUNT': 'Too many fields',
      'LIMIT_UNEXPECTED_FILE': 'Unexpected file field'
    };

    return res.status(400).json({
      success: false,
      error: errorMessages[error.code] || 'File upload error'
    });
  }

  if (error.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      error: 'CORS policy violation'
    });
  }

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

/**
 * 404 handler for unmatched routes
 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path,
    method: req.method
  });
});

/**
 * Clean up expired cache entries
 * @async
 */
async function cleanupCache() {
  const now = Date.now();
  const toDelete = [];

  const { hashStore, saveHashStore } = require('./utils/helpers');

  for (const [hash, entry] of Object.entries(hashStore)) {
    if (now - entry.timestamp > CONFIG.MAX_CACHE_AGE) {
      try {
        const fs = require('fs').promises;
        if (require('fs').existsSync(entry.zipPath)) {
          await fs.unlink(entry.zipPath);
        }
        toDelete.push(hash);
      } catch (error) {
        logger.error('Error cleaning up cache entry:', error);
      }
    }
  }

  toDelete.forEach(hash => delete hashStore[hash]);
  if (toDelete.length > 0) {
    await saveHashStore();
    logger.info(`Cleaned up ${toDelete.length} cache entries`);
  }
}

/**
 * Initialize the application with required setup
 * @async
 * @returns {import('express').Application} The configured Express app
 */
async function initializeApp() {
  try {
    await ensureDirectories();
    await loadHashStore();

    setInterval(async () => {
      try {
        await cleanupCache();
        jobManager.cleanupOldJobs();
      } catch (error) {
        logger.error('Cleanup task error:', error);
      }
    }, CONFIG.CACHE_CLEANUP_INTERVAL);

    logger.info('Application initialized successfully');
    return app;

  } catch (error) {
    logger.error('Failed to initialize app:', error);
    throw error;
  }
}

module.exports = { app, initializeApp, jobManager };
