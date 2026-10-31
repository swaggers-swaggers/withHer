const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { presentMessage } = require('../chat-presentation.cjs');
const { tokens } = require('./config.cjs');
const CONVERSATION = 'maibot-internal-owner'; // Stable ID also preserves the existing local draft.
class AgentStore {
  constructor(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.file = path.join(dataDir, 'dafeyu.sqlite');
    this.db = new DatabaseSync(this.file);
    fs.chmodSync(this.file, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL,content TEXT NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'complete',
        segments_json TEXT NOT NULL DEFAULT '[]',origin TEXT NOT NULL,reply_to_seq INTEGER);
      CREATE TABLE IF NOT EXISTS facts(id TEXT PRIMARY KEY,fact_key TEXT NOT NULL,text TEXT NOT NULL,
        evidence_json TEXT NOT NULL,created_at INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1,
        superseded_by TEXT,kind TEXT NOT NULL DEFAULT 'user_statement');
      CREATE INDEX IF NOT EXISTS facts_key ON facts(fact_key,active);
      CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(text,content='facts',content_rowid='rowid',tokenize='trigram');
      CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
        INSERT INTO facts_fts(rowid,text) VALUES(new.rowid,new.text); END;
      CREATE TABLE IF NOT EXISTS study_records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,text TEXT NOT NULL,updated_at INTEGER NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS study_fts USING fts5(text,content='study_records',content_rowid='rowid',tokenize='trigram');
      CREATE TRIGGER IF NOT EXISTS study_ai AFTER INSERT ON study_records BEGIN INSERT INTO study_fts(rowid,text) VALUES(new.rowid,new.text); END;
      CREATE TRIGGER IF NOT EXISTS study_ad AFTER DELETE ON study_records BEGIN INSERT INTO study_fts(study_fts,rowid,text) VALUES('delete',old.rowid,old.text); END;
      CREATE TRIGGER IF NOT EXISTS study_au AFTER UPDATE ON study_records BEGIN
        INSERT INTO study_fts(study_fts,rowid,text) VALUES('delete',old.rowid,old.text);
        INSERT INTO study_fts(rowid,text) VALUES(new.rowid,new.text); END;
      CREATE TABLE IF NOT EXISTS relationship_versions(revision INTEGER PRIMARY KEY AUTOINCREMENT,narrative TEXT NOT NULL,
        reason TEXT NOT NULL,evidence_json TEXT NOT NULL,created_at INTEGER NOT NULL,mode TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,from_seq INTEGER NOT NULL,through_seq INTEGER NOT NULL,
        created_at INTEGER NOT NULL,facts_count INTEGER NOT NULL,relationship_revision INTEGER);
      CREATE TABLE IF NOT EXISTS news(id TEXT PRIMARY KEY,title TEXT NOT NULL,url TEXT NOT NULL,
        snippet TEXT NOT NULL,published_at INTEGER,fetched_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS life_activities(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,
        started_at INTEGER NOT NULL,due_at INTEGER NOT NULL,finished_at INTEGER,status TEXT NOT NULL,
        record TEXT NOT NULL DEFAULT '',feeling TEXT NOT NULL DEFAULT '',share_hook TEXT NOT NULL DEFAULT '',
        search_query TEXT NOT NULL DEFAULT '',sources_json TEXT NOT NULL DEFAULT '[]',shared_at INTEGER,
        origin TEXT NOT NULL DEFAULT 'simulation');
      CREATE INDEX IF NOT EXISTS life_status_time ON life_activities(status,started_at);
      CREATE TABLE IF NOT EXISTS delivery_outbox(id TEXT PRIMARY KEY,source_message_id TEXT,source_seq INTEGER,
        baseline_seq INTEGER,kind TEXT NOT NULL,plan_id TEXT,content TEXT NOT NULL,payload_json TEXT NOT NULL,
        due_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,sent_at INTEGER);
      CREATE INDEX IF NOT EXISTS delivery_pending ON delivery_outbox(status,due_at);
      CREATE TABLE IF NOT EXISTS delivery_bubbles(outbox_id TEXT NOT NULL,position INTEGER NOT NULL,content TEXT NOT NULL,
        kind TEXT NOT NULL,gap_ms INTEGER NOT NULL,due_at INTEGER NOT NULL,status TEXT NOT NULL,message_id TEXT UNIQUE,sent_at INTEGER,
        PRIMARY KEY(outbox_id,position));
      CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,detail TEXT NOT NULL,created_at INTEGER NOT NULL);`);
    if (!this.db.prepare('PRAGMA table_info(messages)').all().some(c => c.name === 'reply_to_seq')) this.db.exec('ALTER TABLE messages ADD COLUMN reply_to_seq INTEGER');
    this.db.prepare("UPDATE messages SET status='interrupted' WHERE status='pending' AND id NOT IN (SELECT source_message_id FROM delivery_outbox WHERE status='pending' AND source_message_id IS NOT NULL)").run();
    if (!this.meta('legacy_import')) this.importLegacy(dataDir);
    if (!this.relationship()) this.saveRelationship({ narrative: '我还在慢慢认识他。先听他说，也保留自己的判断。我愿意温柔地接住他的心情，偶尔调皮一下；亲近到什么程度，要看真正相处留下的感觉，不能凭空替两个人写好过去。', reason: '新引擎初始状态，无未经证实的人物标签。' }, [], 'initial', Date.now());
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  meta(key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : fallback;
  }
  setMeta(key, value) { this.db.prepare('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)').run(key, JSON.stringify(value)); }
  log(kind, detail, now = Date.now()) {
    this.db.prepare('INSERT INTO audit(kind,detail,created_at) VALUES(?,?,?)').run(kind, JSON.stringify(detail), now);
    // Bounded diagnostic log, no credentials or reasoning content.
    this.db.prepare('DELETE FROM audit WHERE seq < (SELECT MAX(seq)-2000 FROM audit)').run();
  }
  importLegacy(dataDir) {
    const source = path.join(dataDir, 'maibot-view.sqlite');
    let old;
    try {
      if (fs.existsSync(source)) old = new DatabaseSync(source, { readOnly: true });
      const rows = old ? old.prepare('SELECT * FROM messages ORDER BY seq').all() : [];
      this.transaction(() => {
        for (const row of rows) this.db.prepare(`INSERT OR IGNORE INTO messages(seq,id,role,content,created_at,status,segments_json,origin)
          VALUES(?,?,?,?,?,?,?,?)`).run(row.seq, row.id, row.role, row.content, row.created_at, row.status, row.segments_json || '[]', 'legacy-import');
        this.setMeta('legacy_import', { count: rows.length, at: Date.now() });
        this.log('migration', { messages: rows.length, facts: 'Re-extract from original user statements; do not trust legacy inferred profiles.' });
      });
    } finally { old?.close(); }
  }
  addMessage(role, content, now, { status = 'complete', origin = 'dafeyu', segments = [], replyTo = null } = {}) {
    const id = randomUUID();
    const result = this.db.prepare('INSERT INTO messages(id,role,content,created_at,status,segments_json,origin,reply_to_seq) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, role, content, now, status, JSON.stringify(segments), origin, replyTo);
    return { id, seq: Number(result.lastInsertRowid), role, content, created_at: now };
  }
  messages(before = Number.MAX_SAFE_INTEGER, limit = 100) {
    return this.db.prepare('SELECT * FROM messages WHERE seq<? ORDER BY seq DESC LIMIT ?').all(before, limit).reverse()
      .map(row => presentMessage({ ...row, conversation_id: CONVERSATION }));
  }
  recent(through = Number.MAX_SAFE_INTEGER, max = 200) {
    const rows = this.db.prepare(`SELECT seq,id,role,content,created_at,status FROM messages
      WHERE (seq<=? OR (role='assistant' AND reply_to_seq<?)) AND (status IN ('complete','pending') OR role='user')
      ORDER BY COALESCE(reply_to_seq,seq) DESC,role='assistant' DESC,seq DESC LIMIT ?`).all(through, through, max);
    // Chat context is count-bounded only. Never silently discard or shorten a
    // historical message because of a local token estimate.
    return rows.reverse();
  }
  lastEvent() { return Number(this.db.prepare('SELECT MAX(created_at) AS at FROM messages').get().at || 0); }
  latestSeq() { return Number(this.db.prepare('SELECT MAX(seq) AS seq FROM messages').get().seq || 0); }
  batch(settings) {
    const cursor = this.meta('memory_cursor', 0);
    const rows = this.db.prepare("SELECT seq,id,role,content,created_at FROM messages WHERE seq>? AND (status='complete' OR role='user') ORDER BY seq LIMIT ?").all(cursor, settings.memory_batch_max_messages);
    const selected = []; let cost = 0;
    for (const row of rows) { const n = tokens(row.content); if (selected.length && cost + n > settings.memory_batch_max_tokens) break; selected.push(row); cost += n; }
    return { cursor, rows: selected, tokens: cost, throughSeq: selected.at(-1)?.seq || cursor,
      due: cost >= settings.memory_trigger_tokens || selected.length >= settings.memory_batch_max_messages || selected.length < rows.length };
  }
  relationship() { return this.db.prepare('SELECT * FROM relationship_versions ORDER BY revision DESC LIMIT 1').get() || null; }
  saveRelationship(value, evidence, mode, now) {
    const result = this.db.prepare('INSERT INTO relationship_versions(narrative,reason,evidence_json,created_at,mode) VALUES(?,?,?,?,?)')
      .run(value.narrative, value.reason, JSON.stringify(evidence), now, mode);
    return Number(result.lastInsertRowid);
  }
  fact(id) { const row = this.db.prepare('SELECT * FROM facts WHERE id=?').get(id); return row ? { ...row, evidence: JSON.parse(row.evidence_json) } : null; }
  factContext(limit = 60) { return this.db.prepare('SELECT id,fact_key AS key,text,kind,created_at FROM facts WHERE active=1 ORDER BY created_at DESC LIMIT ?').all(limit); }
  commitFacts(facts, now) {
    for (const item of facts) {
      const id = randomUUID();
      this.db.prepare('UPDATE facts SET active=0,superseded_by=? WHERE fact_key=? AND active=1').run(id, item.key);
      for (const prior of item.replaces || []) this.db.prepare('UPDATE facts SET active=0,superseded_by=? WHERE id=? AND active=1').run(id, prior);
      this.db.prepare('INSERT INTO facts(id,fact_key,text,evidence_json,created_at) VALUES(?,?,?,?,?)')
        .run(id, item.key, item.text, JSON.stringify(item.evidence), now);
    }
  }
  wander(limit = 3, rng = Math.random) {
    // Random offsets use the persisted rowid order; no expensive ORDER BY RANDOM().
    const count = Number(this.db.prepare('SELECT COUNT(*) AS n FROM facts WHERE active=1').get().n);
    const selected = new Map();
    for (let n = 0; n < Math.min(limit * 3, count * 2); n++) {
      const row = this.db.prepare('SELECT id,text,created_at FROM facts WHERE active=1 ORDER BY rowid LIMIT 1 OFFSET ?').get(Math.min(count - 1, Math.floor(rng() * count)));
      if (row) selected.set(row.id, row); if (selected.size >= limit) break;
    }
    return [...selected.values()];
  }
  search({ query = '', scope = 'facts', offset = 0, limit = 10, include_inactive = false, after, before } = {}) {
    if (!['facts', 'messages', 'study'].includes(scope)) throw new Error('查找范围无效');
    if (typeof query !== 'string' || query.length > 200 || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 30) throw new Error('查找参数无效');
    const table = { facts: 'facts', messages: 'messages', study: 'study_records' }[scope];
    const field = scope === 'messages' ? 'content' : 'text';
    const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 8);
    const clauses = [], params = [];
    const timeField = scope === 'study' ? 'updated_at' : 'created_at';
    for (const [value, operator] of [[after, '>='], [before, '<=']]) {
      if (value === undefined) continue;
      if (!Number.isFinite(value) || value < 0) throw new Error('查找时间无效');
      clauses.push(`${timeField}${operator}?`); params.push(value);
    }
    if (scope === 'facts' && !include_inactive) clauses.push('active=1');
    if (scope === 'messages') clauses.push("status IN ('complete','pending')");
    // Trigram index for longer terms, escaped LIKE fallback for short Chinese words.
    if (terms.length) {
      const fts = scope === 'facts' ? 'facts_fts' : scope === 'study' ? 'study_fts' : null;
      if (fts && terms.every(t => Array.from(t).length >= 3)) {
        clauses.push(`rowid IN (SELECT rowid FROM ${fts} WHERE ${fts} MATCH ?)`);
        params.push(terms.map(t => '"' + t.replaceAll('"', '""') + '"').join(' OR '));
      } else {
        clauses.push('(' + terms.map(() => `${field} LIKE ? ESCAPE '\\'`).join(' OR ') + ')');
        params.push(...terms.map(t => '%' + t.replace(/[\\%_]/g, '\\$&') + '%'));
      }
    }
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
    const rows = this.db.prepare(`SELECT * FROM ${table}${where} ORDER BY ${scope === 'study' ? 'updated_at' : 'created_at'} DESC,rowid DESC LIMIT ? OFFSET ?`).all(...params, limit + 1, offset);
    return { scope, query, items: rows.slice(0, limit).map(r => scope === 'facts' ? { ...r, evidence: JSON.parse(r.evidence_json) } : r),
      next_offset: rows.length > limit ? offset + limit : null };
  }
  read(id, scope = 'facts') {
    if (typeof id !== 'string' || id.length > 300) throw new Error('记录编号无效');
    if (scope === 'facts') return this.fact(id);
    if (scope === 'messages') return this.db.prepare('SELECT * FROM messages WHERE id=?').get(id) || null;
    if (scope === 'study') return this.db.prepare('SELECT * FROM study_records WHERE id=?').get(id) || null;
    throw new Error('查找范围无效');
  }
  exportData() {
    const tables = ['messages', 'facts', 'study_records', 'relationship_versions', 'batches', 'news', 'metadata', 'life_activities', 'delivery_outbox', 'delivery_bubbles'];
    return { engine: 'Dafeyu', schema: 3, ...Object.fromEntries(tables.map(t => [t, this.db.prepare(`SELECT * FROM ${t}`).all()])) };
  }
  close() { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); this.db.close(); }
}
module.exports = { AgentStore, CONVERSATION };
