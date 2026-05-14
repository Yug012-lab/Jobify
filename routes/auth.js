// routes/auth.js — /api/auth/*

'use strict';

const express   = require('express');
const bcrypt    = require('bcryptjs');
const { body, validationResult } = require('express-validator');

const db                    = require('../db/database');
const { authenticate, signToken } = require('../middleware/auth');

const router      = express.Router();
const SALT_ROUNDS = 12; // ~250ms on modern hardware — good balance of security/speed

// ─── Validation rule sets ─────────────────────────────────────────────────────
const registerRules = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be 2–50 characters.'),
  body('email')
    .isEmail().withMessage('A valid email is required.')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter.')
    .matches(/[0-9]/).withMessage('Password must contain at least one number.'),
  body('institution')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 100 })
    .withMessage('Institution name too long.'),
];

const loginRules = [
  body('email').isEmail().withMessage('Valid email required.').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required.'),
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function firstError(req, res) {
  const errs = validationResult(req);
  if (errs.isEmpty()) return false;
  res.status(400).json({
    error: errs.array()[0].msg,
    fields: errs.array().map(e => ({ field: e.path, message: e.msg })),
  });
  return true;
}

function userPayload(user) {
  return { id: user.id, name: user.name, email: user.email, institution: user.institution || null };
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', registerRules, async (req, res, next) => {
  if (firstError(req, res)) return;

  try {
    const { name, email, password, institution } = req.body;

    // Duplicate check (also caught by UNIQUE constraint, but friendlier message here)
    const existing = db.stmts.getUserByEmail.get(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const hash   = await bcrypt.hash(password, SALT_ROUNDS);
    const result = db.stmts.insertUser.run(name, email, hash, institution || null);
    const uid    = result.lastInsertRowid;

    const token = signToken({ id: uid, name, email });

    res.status(201).json({
      message : 'Account created successfully!',
      token,
      user    : userPayload({ id: uid, name, email, institution }),
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', loginRules, async (req, res, next) => {
  if (firstError(req, res)) return;

  try {
    const { email, password } = req.body;

    const user = db.stmts.getUserByEmail.get(email);
    // Use constant-time compare even if user not found (timing attack mitigation)
    const hash = user ? user.password : '$2a$12$invalidhashfortimingprotection000000000000000000000';
    const match = await bcrypt.compare(password, hash);

    if (!user || !match) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = signToken({ id: user.id, name: user.name, email: user.email });

    res.json({
      message : 'Login successful!',
      token,
      user    : userPayload(user),
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticate, (req, res, next) => {
  try {
    const user = db.stmts.getUserById.get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
