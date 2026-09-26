/**
 * Il2CppDumper Web Server
 * Main entry point for the application
 * @module server
 */

require('dotenv').config();

const { initializeApp } = require('./app');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 5555;

/**
 * Graceful shutdown handler for SIGTERM
 */
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');

  if (global.server) {
    global.server.close(async () => {
      try {
      logger.info('Server shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  });
  } else {
    process.exit(0);
  }

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
});

/**
 * Graceful shutdown handler for SIGINT (Ctrl+C)
 */
process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.emit('SIGTERM');
});

/**
 * Start the HTTP server
 * @async
 * @returns {import('http').Server} The HTTP server instance
 */
async function start() {
  try {
    const app = await initializeApp();

    const server = app.listen(PORT, () => {
      logger.info(`🚀 Enhanced Il2CppDumper Server running at http://localhost:${PORT}`);
      logger.info(`📁 Output directory: ${require('./config').OUTPUT_BASE}`);
    });

    global.server = server;
    return server;

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = { start };