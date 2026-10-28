// Náhrada expo-sqlite pro testy datové vrstvy (node:sqlite). Jen to, co lib/db.ts používá.
const { DatabaseSync } = require('node:sqlite');
const dir = process.env.TEST_DB_DIR;

function wrap(db, path) {
  const api = {
    databasePath: path,
    async execAsync(sql) { db.exec(sql); },
    async runAsync(sql, params = []) {
      const r = db.prepare(sql).run(...params);
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    async getFirstAsync(sql, params = []) { return db.prepare(sql).get(...params) ?? null; },
    async getAllAsync(sql, params = []) { return db.prepare(sql).all(...params); },
    async withExclusiveTransactionAsync(task) {
      db.exec('BEGIN');
      try { await task(api); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
  return api;
}

exports.openDatabaseAsync = async (name) => {
  const path = `${dir}/${name}`;
  return wrap(new DatabaseSync(path), path);
};
