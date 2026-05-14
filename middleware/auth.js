// middleware/auth.js — JWT verification middleware

'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'jobify_dev_secret_CHANGE_ME';
const JWT_EXPIRY = process.env.JWT_EXPIRY  || '7d';

/**
 * Express middleware — verifies Bearer token, attaches decoded payload to req.user.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const token = header.slice(7); // remove "Bearer "

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError'
      ? 'Session expired. Please log in again.'
      : 'Invalid token. Please log in again.';
    return res.status(401).json({ error: msg, expired: err.name === 'TokenExpiredError' });
  }
}

/**
 * Sign a JWT payload.
 */
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

module.exports = { authenticate, signToken, JWT_SECRET };
