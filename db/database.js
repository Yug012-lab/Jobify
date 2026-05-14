// db/database.js — sql.js (WebAssembly SQLite) with a better-sqlite3-compatible API

'use strict';

const initSqlJs = require('sql.js');
const path      = require('path');
const fs        = require('fs');

class JobifyDB {
  constructor() {
    this._db     = null;
    this._dbPath = null;
    this.stmts   = {};
  }

  async init() {
    const SQL    = await initSqlJs();
    this._dbPath = path.resolve(process.env.DB_PATH || './data/jobify.db');
    const dir    = path.dirname(this._dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this._db = fs.existsSync(this._dbPath)
      ? new SQL.Database(fs.readFileSync(this._dbPath))
      : new SQL.Database();

    this._db.run('PRAGMA foreign_keys = ON;');
    this._schema();
    this._prepareStmts();

    process.on('SIGINT',  () => { this._flush(); process.exit(0); });
    process.on('SIGTERM', () => { this._flush(); process.exit(0); });
    return this;
  }

  _schema() {
    this._db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE, password TEXT NOT NULL,
      institution TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );`);
    this._db.run(`CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      company TEXT NOT NULL, role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Applied'
        CHECK(status IN ('Applied','Interview','Offer','Rejected')),
      date_applied TEXT, location TEXT, notes TEXT, salary TEXT, job_url TEXT,
      priority TEXT DEFAULT 'Medium' CHECK(priority IN ('Low','Medium','High')),
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );`);
    this._db.run('CREATE INDEX IF NOT EXISTS idx_apps_uid    ON applications(user_id);');
    this._db.run('CREATE INDEX IF NOT EXISTS idx_apps_status ON applications(user_id,status);');
    this._db.run('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);');
    this._flush();
  }

  _prepareStmts() {
    const p = this.prepare.bind(this);
    this.stmts = {
      getUserByEmail : p('SELECT * FROM users WHERE email=? COLLATE NOCASE'),
      getUserById    : p('SELECT id,name,email,institution,created_at FROM users WHERE id=?'),
      insertUser     : p('INSERT INTO users (name,email,password,institution) VALUES (?,?,?,?)'),
      getAppByIdUser : p('SELECT * FROM applications WHERE id=? AND user_id=?'),
      deleteApp      : p('DELETE FROM applications WHERE id=? AND user_id=?'),
      patchStatus    : p(`UPDATE applications SET status=?,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=? AND user_id=?`),
      stats          : p(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN status='Applied'   THEN 1 ELSE 0 END) AS applied,
        SUM(CASE WHEN status='Interview' THEN 1 ELSE 0 END) AS interviews,
        SUM(CASE WHEN status='Offer'     THEN 1 ELSE 0 END) AS offers,
        SUM(CASE WHEN status='Rejected'  THEN 1 ELSE 0 END) AS rejected
        FROM applications WHERE user_id=?`),
    };
  }

  // Public API — mirrors better-sqlite3 so all routes work unchanged
  prepare(sql) {
    return {
      get : (...args) => this._get(sql, args),
      all : (...args) => this._all(sql, args),
      run : (...args) => this._run(sql, args),
    };
  }

  _get(sql, args) {
    const stmt = this._db.prepare(sql);
    try {
      if (args.length) stmt.bind(args);
      return stmt.step() ? stmt.getAsObject() : undefined;
    } finally { stmt.free(); }
  }

  _all(sql, args) {
    const rows = [];
    const stmt = this._db.prepare(sql);
    try {
      if (args.length) stmt.bind(args);
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally { stmt.free(); }
  }

  _run(sql, args) {
    this._db.run(sql, args.length ? args : []);
    const lastInsertRowid = this._get('SELECT last_insert_rowid() AS id', [])?.id ?? null;
    const changes         = this._get('SELECT changes() AS c', [])?.c ?? 0;
    this._flush();
    return { lastInsertRowid, changes };
  }

  _flush() {
    if (!this._db || !this._dbPath) return;
    try { fs.writeFileSync(this._dbPath, Buffer.from(this._db.export())); }
    catch (e) { console.error('[DB] flush error:', e.message); }
  }
}

const db = new JobifyDB();
module.exports = db;
