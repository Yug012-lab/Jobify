// routes/applications.js — /api/applications/*

'use strict';

const express = require('express');
const { body, query, param, validationResult } = require('express-validator');

const db            = require('../db/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// All application routes require a valid JWT
router.use(authenticate);

// ─── Constants ───────────────────────────────────────────────────────────────
const VALID_STATUSES   = ['Applied', 'Interview', 'Offer', 'Rejected'];
const VALID_PRIORITIES = ['Low', 'Medium', 'High'];
const SORT_WHITELIST   = ['date_applied', 'created_at', 'company', 'role', 'status', 'priority'];

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

// ─── Shared body validators (create + update) ────────────────────────────────
const appBodyRules = [
  body('company').trim().isLength({ min: 1, max: 100 }).withMessage('Company name is required (max 100 chars).'),
  body('role')   .trim().isLength({ min: 1, max: 100 }).withMessage('Role is required (max 100 chars).'),
  body('status')
    .optional()
    .isIn(VALID_STATUSES)
    .withMessage(`Status must be one of: ${VALID_STATUSES.join(', ')}.`),
  body('date_applied')
    .optional({ checkFalsy: true })
    .isDate({ format: 'YYYY-MM-DD' })
    .withMessage('Date must be in YYYY-MM-DD format.'),
  body('location').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('notes')  .optional({ checkFalsy: true }).trim().isLength({ max: 2000 }).withMessage('Notes max 2000 characters.'),
  body('salary') .optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
  body('job_url')
    .optional({ checkFalsy: true })
    .isURL({ protocols: ['http', 'https'] })
    .withMessage('Job URL must be a valid http/https URL.'),
  body('priority')
    .optional()
    .isIn(VALID_PRIORITIES)
    .withMessage(`Priority must be one of: ${VALID_PRIORITIES.join(', ')}.`),
];

// ─── GET /api/applications ────────────────────────────────────────────────────
router.get('/', [
  query('status').optional().isIn([...VALID_STATUSES, 'All']),
  query('q')     .optional().trim().isLength({ max: 100 }),
  query('sort')  .optional().isIn(SORT_WHITELIST),
  query('dir')   .optional().toLowerCase().isIn(['asc', 'desc']),
  query('page')  .optional().isInt({ min: 1 }),
  query('limit') .optional().isInt({ min: 1, max: 100 }),
], (req, res, next) => {
  if (firstError(req, res)) return;

  try {
    const uid    = req.user.id;
    const status = req.query.status || 'All';
    const q      = (req.query.q || '').trim();
    const sort   = SORT_WHITELIST.includes(req.query.sort) ? req.query.sort : 'created_at';
    const dir    = (req.query.dir || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const page   = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const offset = (page - 1) * limit;

    // Build WHERE dynamically (no ORM, but fully parameterised — no SQL injection risk)
    const conditions = ['user_id = ?'];
    const params     = [uid];

    if (status !== 'All') {
      conditions.push('status = ?');
      params.push(status);
    }

    if (q) {
      conditions.push('(company LIKE ? OR role LIKE ? OR location LIKE ? OR notes LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }

    const where = 'WHERE ' + conditions.join(' AND ');

    const total = db.prepare(`SELECT COUNT(*) AS n FROM applications ${where}`).get(...params).n;
    const rows  = db.prepare(
      `SELECT * FROM applications ${where} ORDER BY ${sort} ${dir} LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    const stats = db.stmts.stats.get(uid);

    res.json({
      applications: rows,
      stats,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/applications/stats ─────────────────────────────────────────────
router.get('/stats', (req, res, next) => {
  try {
    const uid     = req.user.id;
    const summary = db.stmts.stats.get(uid);

    // Last-12-months monthly breakdown
    const monthly = db.prepare(`
      SELECT strftime('%Y-%m', created_at) AS month, status, COUNT(*) AS count
      FROM   applications
      WHERE  user_id = ? AND created_at >= date('now','-12 months')
      GROUP  BY month, status
      ORDER  BY month ASC
    `).all(uid);

    // Top companies by application count
    const topCompanies = db.prepare(`
      SELECT company, COUNT(*) AS count,
             SUM(CASE WHEN status='Offer' THEN 1 ELSE 0 END) AS offers
      FROM   applications
      WHERE  user_id = ?
      GROUP  BY company
      ORDER  BY count DESC
      LIMIT  10
    `).all(uid);

    res.json({ stats: summary, monthly, topCompanies });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/applications ───────────────────────────────────────────────────
router.post('/', appBodyRules, (req, res, next) => {
  if (firstError(req, res)) return;

  try {
    const uid = req.user.id;
    const { company, role, status = 'Applied', date_applied, location,
            notes, salary, job_url, priority = 'Medium' } = req.body;

    const result = db.prepare(`
      INSERT INTO applications
        (user_id, company, role, status, date_applied, location, notes, salary, job_url, priority)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(uid, company, role, status,
           date_applied || null, location || null, notes || null,
           salary || null, job_url || null, priority);

    const app = db.stmts.getAppByIdUser.get(result.lastInsertRowid, uid);
    res.status(201).json({ message: 'Application added!', application: app });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/applications/:id ────────────────────────────────────────────────
router.get('/:id', param('id').isInt({ min: 1 }), (req, res, next) => {
  if (firstError(req, res)) return;

  try {
    const app = db.stmts.getAppByIdUser.get(+req.params.id, req.user.id);
    if (!app) return res.status(404).json({ error: 'Application not found.' });
    res.json({ application: app });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/applications/:id ────────────────────────────────────────────────
router.put('/:id', [param('id').isInt({ min: 1 }), ...appBodyRules], (req, res, next) => {
  if (firstError(req, res)) return;

  try {
    const id  = +req.params.id;
    const uid = req.user.id;

    const existing = db.stmts.getAppByIdUser.get(id, uid);
    if (!existing) return res.status(404).json({ error: 'Application not found.' });

    const { company, role, status = 'Applied', date_applied, location,
            notes, salary, job_url, priority = 'Medium' } = req.body;

    db.prepare(`
      UPDATE applications SET
        company=?, role=?, status=?, date_applied=?, location=?,
        notes=?, salary=?, job_url=?, priority=?,
        updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE id=? AND user_id=?
    `).run(company, role, status,
           date_applied || null, location || null, notes || null,
           salary || null, job_url || null, priority, id, uid);

    const updated = db.stmts.getAppByIdUser.get(id, uid);
    res.json({ message: 'Application updated!', application: updated });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/applications/:id/status — quick status change ─────────────────
router.patch('/:id/status', [
  param('id').isInt({ min: 1 }),
  body('status').isIn(VALID_STATUSES).withMessage('Invalid status.'),
], (req, res, next) => {
  if (firstError(req, res)) return;

  try {
    const result = db.stmts.patchStatus.run(req.body.status, +req.params.id, req.user.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Application not found.' });
    const updated = db.stmts.getAppByIdUser.get(+req.params.id, req.user.id);
    res.json({ message: 'Status updated!', application: updated });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/applications/:id ─────────────────────────────────────────────
router.delete('/:id', param('id').isInt({ min: 1 }), (req, res, next) => {
  if (firstError(req, res)) return;

  try {
    const result = db.stmts.deleteApp.run(+req.params.id, req.user.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Application not found.' });
    res.json({ message: 'Application deleted.' });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/applications — bulk delete ───────────────────────────────────
router.delete('/', [
  body('ids').isArray({ min: 1 }).withMessage('ids must be a non-empty array.'),
  body('ids.*').isInt({ min: 1 }).withMessage('Each id must be a positive integer.'),
], (req, res, next) => {
  if (firstError(req, res)) return;

  try {
    const { ids } = req.body;
    const placeholders = ids.map(() => '?').join(',');
    const result = db.prepare(
      `DELETE FROM applications WHERE id IN (${placeholders}) AND user_id = ?`
    ).run(...ids, req.user.id);

    res.json({ message: `${result.changes} application(s) deleted.`, deleted: result.changes });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
