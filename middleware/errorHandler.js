// middleware/errorHandler.js — centralised error handler

'use strict';

/**
 * Express 4-argument error handler.
 * Catches any error forwarded via next(err) and returns a clean JSON response.
 */
function errorHandler(err, req, res, _next) {
  // Log with context (never expose stack in production)
  const isDev = process.env.NODE_ENV === 'development';
  console.error(`[${new Date().toISOString()}] ERROR ${req.method} ${req.url} →`, err.message);
  if (isDev) console.error(err.stack);

  // SQLite constraint violations
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ error: 'This email is already registered.' });
  }
  if (err.code && err.code.startsWith('SQLITE_')) {
    return res.status(500).json({ error: 'Database error. Please try again.' });
  }

  // express body-parser size limit
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large.' });
  }

  // express-validator (should be caught in routes, this is a safety net)
  if (err.status === 400) {
    return res.status(400).json({ error: err.message });
  }

  const status  = err.status || err.statusCode || 500;
  const message = status < 500
    ? err.message
    : isDev
      ? err.message
      : 'Internal server error. Please try again.';

  res.status(status).json({ error: message });
}

module.exports = errorHandler;
