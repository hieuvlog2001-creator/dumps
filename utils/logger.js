/**
 * Winston Logger Configuration
 * Centralized logging utility with console and file output
 * @module logger
 */

const winston = require('winston');

/**
 * Winston logger instance configured for the application
 * @type {winston.Logger}
 */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.colorize({ all: true })
    }),
    new winston.transports.File({
      filename: 'logs/server.log',
      maxsize: 5242880,
      maxFiles: 5
    })
  ]
});

module.exports = logger;
