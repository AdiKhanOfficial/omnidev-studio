/**
 * OmniDev Studio — MySQL / MariaDB tools
 *
 * Shells out to the `mysql` command-line client (ships with XAMPP, MAMP,
 * MariaDB, etc.) so no extra npm driver is required. Credentials are passed
 * per call; the agent typically reads them from the project's developer notes.
 */

const { execFile } = require('child_process');

function run(args, stdin) {
  return new Promise((resolve, reject) => {
    const child = execFile('mysql', args, { windowsHide: true, maxBuffer: 1024 * 1024 * 32 }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 'ENOENT') {
          return reject(new Error('The "mysql" command-line client was not found on PATH. For XAMPP add C:\\xampp\\mysql\\bin to PATH, then restart OmniDev Studio.'));
        }
        return reject(new Error((stderr || err.message).trim()));
      }
      resolve(stdout);
    });
    if (stdin) { child.stdin.write(stdin); child.stdin.end(); }
  });
}

function baseArgs({ host = '127.0.0.1', port = 3306, user = 'root', password = '', database }) {
  const args = ['--connect-timeout=4', '-h', String(host), '-P', String(port), '-u', String(user)];
  if (password) args.push(`-p${password}`);
  if (database) args.push(String(database));
  return args;
}

function parseTsv(out) {
  const lines = out.replace(/\s+$/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { columns: [], rows: [] };
  const columns = lines[0].split('\t');
  const rows = lines.slice(1).map(l => {
    const cells = l.split('\t');
    const obj = {};
    columns.forEach((c, i) => { obj[c] = cells[i]; });
    return obj;
  });
  return { columns, rows };
}

module.exports = {
  mysql_query: async ({ sql, host, port, user, password, database }) => {
    if (!sql || !String(sql).trim()) throw new Error('A "sql" statement is required.');
    const args = [...baseArgs({ host, port, user, password, database }), '--batch', '-e', sql];
    const out = await run(args);
    const parsed = parseTsv(out);
    return { sql, row_count: parsed.rows.length, columns: parsed.columns, rows: parsed.rows };
  },

  mysql_databases: async ({ host, port, user, password } = {}) => {
    const args = [...baseArgs({ host, port, user, password }), '--batch', '-e', 'SHOW DATABASES;'];
    const out = await run(args);
    const parsed = parseTsv(out);
    return { databases: parsed.rows.map(r => Object.values(r)[0]) };
  },

  mysql_schema: async ({ database, table, host, port, user, password }) => {
    if (!database) throw new Error('A "database" name is required.');
    if (table) {
      const out = await run([...baseArgs({ host, port, user, password, database }), '--batch', '-e', `DESCRIBE \`${table}\`;`]);
      return { database, table, schema: parseTsv(out).rows };
    }
    const out = await run([...baseArgs({ host, port, user, password, database }), '--batch', '-e', 'SHOW TABLES;']);
    return { database, tables: parseTsv(out).rows.map(r => Object.values(r)[0]) };
  }
};
