const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const workspaceManager = require('../workspace');

let SQL = null;

async function getSQL() {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
}

function getDatabasePath(dbFile = 'app.db') {
  return workspaceManager.resolvePath(dbFile);
}

function loadDatabase(fullPath, sqlEngine) {
  if (fs.existsSync(fullPath)) {
    const fileBuffer = fs.readFileSync(fullPath);
    return new sqlEngine.Database(fileBuffer);
  } else {
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return new sqlEngine.Database();
  }
}

function saveDatabase(db, fullPath) {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(fullPath, buffer);
}

module.exports = {
  sqlite_query: async ({ database_file = 'app.db', sql, params = [] }) => {
    if (!sql || !sql.trim()) throw new Error('SQL query cannot be empty');

    const sqlEngine = await getSQL();
    const fullPath = getDatabasePath(database_file);
    const db = loadDatabase(fullPath, sqlEngine);

    try {
      const isSelect = /^\s*SELECT/i.test(sql) || /^\s*PRAGMA/i.test(sql);

      if (isSelect) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        stmt.free();
        db.close();

        return {
          success: true,
          database: database_file,
          query_type: 'SELECT',
          count: rows.length,
          rows
        };
      } else {
        db.run(sql, params);
        const changes = db.getRowsModified();
        saveDatabase(db, fullPath);
        db.close();

        return {
          success: true,
          database: database_file,
          query_type: 'MUTATION',
          rows_modified: changes,
          message: `Query executed successfully (${changes} row(s) modified).`
        };
      }
    } catch (err) {
      db.close();
      throw new Error(`SQLite Error: ${err.message}`);
    }
  },

  sqlite_schema: async ({ database_file = 'app.db' }) => {
    const sqlEngine = await getSQL();
    const fullPath = getDatabasePath(database_file);

    if (!fs.existsSync(fullPath)) {
      return {
        database: database_file,
        exists: false,
        tables: [],
        message: 'Database file does not exist yet.'
      };
    }

    const db = loadDatabase(fullPath, sqlEngine);
    try {
      const res = db.exec("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'view', 'index') AND name NOT LIKE 'sqlite_%';");
      const tables = [];

      if (res.length > 0 && res[0].values) {
        for (const row of res[0].values) {
          tables.push({
            type: row[0],
            name: row[1],
            table: row[2],
            ddl: row[3]
          });
        }
      }

      db.close();
      return {
        database: database_file,
        exists: true,
        total_objects: tables.length,
        schema: tables
      };
    } catch (err) {
      db.close();
      throw new Error(`Failed to inspect schema: ${err.message}`);
    }
  },

  sqlite_execute_script: async ({ database_file = 'app.db', sql_script }) => {
    if (!sql_script || !sql_script.trim()) throw new Error('SQL script cannot be empty');

    const sqlEngine = await getSQL();
    const fullPath = getDatabasePath(database_file);
    const db = loadDatabase(fullPath, sqlEngine);

    try {
      db.exec(sql_script);
      saveDatabase(db, fullPath);
      db.close();

      return {
        success: true,
        database: database_file,
        message: 'SQL script executed and database saved successfully.'
      };
    } catch (err) {
      db.close();
      throw new Error(`Script Execution Error: ${err.message}`);
    }
  }
};
