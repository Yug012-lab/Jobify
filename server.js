// server.js — Jobify Express application entry point

'use strict';

require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const db             = require('./db/database');
const authRoutes     = require('./routes/auth');
const appRoutes      = require('./routes/applications');
const errorHandler   = require('./middleware/errorHandler');

const app  = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const ENV  = process.env.NODE_ENV || 'development';

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin        : process.env.ALLOWED_ORIGIN || true,
  credentials   : true,
  methods       : ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
}));
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Try again later.' },
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

// ── HTTP logging ──────────────────────────────────────────────────────────────
if (ENV !== 'test') app.use(morgan(ENV === 'production' ? 'combined' : 'dev'));

// ── Static frontend ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',         authRoutes);
app.use('/api/applications', appRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({
  status: 'ok', app: 'Jobify', version: '1.0.0',
  env: ENV, timestamp: new Date().toISOString(),
}));

// ── SPA catch-all ─────────────────────────────────────────────────────────────
app.get('*', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// ── Global error handler (must be last middleware) ────────────────────────────
app.use(errorHandler);

// ── Bootstrap: init DB first, then start listening ───────────────────────────
async function start() {
  try {
    await db.init();
    app.listen(PORT, () => {
      console.log('');
      console.log('  🚀  Jobify is running');
      console.log(`  ➜   Local :  http://localhost:${PORT}`);
      console.log(`  ➜   Env   :  ${ENV}`);
      console.log('');
    });
  } catch (err) {
    console.error('Failed to start Jobify:', err);
    process.exit(1);
  }
}

start();

module.exports = app;
