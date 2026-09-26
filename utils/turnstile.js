/**
 * Cloudflare Turnstile Verification Utility
 * Handles server-side verification of Turnstile CAPTCHA tokens
 * @module turnstile
 */

const axios = require('axios');
const logger = require('./logger');

/**
 * Verify Cloudflare Turnstile token
 * @param {string} token - The Turnstile token from the frontend
 * @param {string} [ip=''] - The client's IP address for additional validation
 * @returns {Promise<boolean>} Whether the token is valid
 */
async function verifyTurnstile(token, ip = '') {
  try {
    const secretKey = process.env.SECRET_KEY;

    if (!secretKey) {
      logger.error('Turnstile SECRET_KEY not configured');
      return false;
    }

    if (!token) {
      logger.warn('Turnstile token is missing');
      return false;
    }

    const response = await axios.post('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      secret: secretKey,
      response: token,
      remoteip: ip
    }, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 10000 // 10 second timeout
    });

    const result = response.data;

    if (!result.success) {
      logger.warn('Turnstile verification failed:', result['error-codes']);
      return false;
    }

    logger.info('Turnstile verification successful');
    return true;

  } catch (error) {
    logger.error('Turnstile verification error:', error.message);
    return false;
  }
}

module.exports = {
  verifyTurnstile
};
