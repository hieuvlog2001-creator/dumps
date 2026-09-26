/**
 * Turnstile Middleware
 * Validates Cloudflare Turnstile tokens for API protection
 * @module middleware/turnstile
 */

const { verifyTurnstile } = require('../utils/turnstile');

/**
 * Middleware to verify Turnstile token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */
const verifyTurnstileToken = async (req, res, next) => {
  try {
    const token = req.body['cf-turnstile-response'] || req.headers['x-turnstile-token'];

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Security verification required. Please complete the CAPTCHA.'
      });
    }

    const isValid = await verifyTurnstile(token, req.ip);

    if (!isValid) {
      return res.status(400).json({
        success: false,
        error: 'Security verification failed. Please try again.'
      });
    }

    // Token is valid, proceed
    next();
  } catch (error) {
    console.error('Turnstile verification error:', error);
    return res.status(500).json({
      success: false,
      error: 'Security verification error. Please try again.'
    });
  }
};

module.exports = { verifyTurnstileToken };
