import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { SYNC_TABLES, matchSql, type SyncTable } from "./catalog.js";

const SYNC_COLUMNS: { name: string; ddl: string }[] = [
  { name: "sync_id", ddl: "sync_id TEXT" },
  { name: "sync_lamport", ddl: "sync_lamport INTEGER NOT NULL DEFAULT 0" },
  { name: "sync_device", ddl: "sync_device TEXT" },
  { name: "sync_at", ddl: "sync_at INTEGER NOT NULL DEFAULT 0" },
];

function columnNames(database: DatabaseSync, table: string): Set<string> {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(cols.map((col) => col.name));
}

function ensureColumn(database: DatabaseSync, table: string, column: string, ddl: string) {
  if (!columnNames(database, table).has(column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

/** uuid() e now_ms() para os triggers. Uma vez por conexão. */
export function registerSyncFunctions(database: DatabaseSync) {
  database.function("uuid", () => randomUUID());
  database.function("now_ms", () => Date.now());
}

function deletePayloadSql(table: SyncTable): string {
  if (table.natural === "month") return `json_object('month', OLD.month)`;
  if (table.natural === "card_month") {
    return `json_object('month', OLD.month, 'card_sync_id', (SELECT sync_id FROM cards WHERE id = OLD.card_id))`;
  }
  if (table.natural === "rule_month") {
    return `json_object('month', OLD.month, 'rule_sync_id', (SELECT sync_id FROM expense_rules WHERE id = OLD.rule_id))`;
  }
  return "NULL";
}

function naturalKeySql(table: SyncTable): string {
  if (table.natural === "month") return "OLD.month";
  if (table.natural === "card_month") {
    return `(SELECT sync_id FROM cards WHERE id = OLD.card_id) || '|' || OLD.month`;
  }
  if (table.natural === "rule_month") {
    return `(SELECT sync_id FROM expense_rules WHERE id = OLD.rule_id) || '|' || OLD.month`;
  }
  return "NULL";
}

function businessChanged(table: SyncTable): string {
  const columns = [...table.columns, ...table.fks.map((fk) => fk.column)];
  return columns.map((column) => `OLD.${column} IS NOT NEW.${column}`).join(" OR ");
}

function installTriggers(database: DatabaseSync) {
  const bump = `
    UPDATE sync_meta
       SET value = CAST(max(CAST(value AS INTEGER), COALESCE(NEW.sync_lamport, 0)) + 1 AS TEXT)
     WHERE key = 'lamport';
  `;
  const when = `WHEN COALESCE((SELECT value FROM sync_meta WHERE key = 'apply'), '0') = '0'`;

  for (const table of SYNC_TABLES) {
    const whereNew = matchSql(table, "NEW");
    const ai = `sync_${table.name}_ai`;
    const au = `sync_${table.name}_au`;
    const ad = `sync_${table.name}_ad`;
    database.exec(`DROP TRIGGER IF EXISTS ${ai}`);
    database.exec(`DROP TRIGGER IF EXISTS ${au}`);
    database.exec(`DROP TRIGGER IF EXISTS ${ad}`);

    database.exec(`
      CREATE TRIGGER ${ai}
      AFTER INSERT ON ${table.name}
      ${when}
      BEGIN
        UPDATE ${table.name}
           SET sync_id = uuid()
         WHERE ${whereNew} AND (sync_id IS NULL OR sync_id = '');
        ${bump}
        UPDATE ${table.name}
           SET sync_lamport = (SELECT CAST(value AS INTEGER) FROM sync_meta WHERE key = 'lamport'),
               sync_device = (SELECT value FROM sync_meta WHERE key = 'device'),
               sync_at = now_ms()
         WHERE ${whereNew};
        INSERT INTO sync_outbox (table_name, sync_id, op, lamport, device_id, sync_at, payload)
        VALUES (
          '${table.name}',
          (SELECT sync_id FROM ${table.name} WHERE ${whereNew}),
          'upsert',
          (SELECT CAST(value AS INTEGER) FROM sync_meta WHERE key = 'lamport'),
          (SELECT value FROM sync_meta WHERE key = 'device'),
          (SELECT sync_at FROM ${table.name} WHERE ${whereNew}),
          NULL
        );
      END;
    `);

    database.exec(`
      CREATE TRIGGER ${au}
      AFTER UPDATE ON ${table.name}
      ${when}
       AND (${businessChanged(table)})
      BEGIN
        ${bump}
        UPDATE ${table.name}
           SET sync_lamport = (SELECT CAST(value AS INTEGER) FROM sync_meta WHERE key = 'lamport'),
               sync_device = (SELECT value FROM sync_meta WHERE key = 'device'),
               sync_at = now_ms()
         WHERE ${whereNew};
        INSERT INTO sync_outbox (table_name, sync_id, op, lamport, device_id, sync_at, payload)
        VALUES (
          '${table.name}',
          (SELECT sync_id FROM ${table.name} WHERE ${whereNew}),
          'upsert',
          (SELECT CAST(value AS INTEGER) FROM sync_meta WHERE key = 'lamport'),
          (SELECT value FROM sync_meta WHERE key = 'device'),
          (SELECT sync_at FROM ${table.name} WHERE ${whereNew}),
          NULL
        );
      END;
    `);

    database.exec(`
      CREATE TRIGGER ${ad}
      AFTER DELETE ON ${table.name}
      WHEN COALESCE((SELECT value FROM sync_meta WHERE key = 'apply'), '0') = '0'
       AND OLD.sync_id IS NOT NULL
      BEGIN
        UPDATE sync_meta
           SET value = CAST(max(CAST(value AS INTEGER), COALESCE(OLD.sync_lamport, 0)) + 1 AS TEXT)
         WHERE key = 'lamport';
        INSERT INTO sync_tombstones (table_name, sync_id, lamport, device_id, sync_at, natural_key)
        VALUES (
          '${table.name}',
          OLD.sync_id,
          (SELECT CAST(value AS INTEGER) FROM sync_meta WHERE key = 'lamport'),
          (SELECT value FROM sync_meta WHERE key = 'device'),
          now_ms(),
          ${naturalKeySql(table)}
        )
        ON CONFLICT(table_name, sync_id) DO UPDATE SET
          lamport = excluded.lamport,
          device_id = excluded.device_id,
          sync_at = excluded.sync_at,
          natural_key = excluded.natural_key
        WHERE excluded.sync_at >= sync_tombstones.sync_at;
        INSERT INTO sync_outbox (table_name, sync_id, op, lamport, device_id, sync_at, payload)
        VALUES (
          '${table.name}',
          OLD.sync_id,
          'delete',
          (SELECT CAST(value AS INTEGER) FROM sync_meta WHERE key = 'lamport'),
          (SELECT value FROM sync_meta WHERE key = 'device'),
          now_ms(),
          ${deletePayloadSql(table)}
        );
      END;
    `);
  }
}

function meta(database: DatabaseSync, key: string): string | undefined {
  const row = database.prepare(`SELECT value FROM sync_meta WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

/**
 * Colunas de identidade, caixa de saída e triggers.
 * O preenchimento dos sync_id antigos acontece antes dos triggers,
 * para a cópia inicial não ir parar na caixa de saída.
 */
export function migrateSync(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sync_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_outbox (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      sync_id    TEXT NOT NULL,
      op         TEXT NOT NULL,
      lamport    INTEGER NOT NULL,
      device_id  TEXT NOT NULL,
      sync_at    INTEGER NOT NULL,
      payload    TEXT
    );
    CREATE TABLE IF NOT EXISTS sync_tombstones (
      table_name  TEXT NOT NULL,
      sync_id     TEXT NOT NULL,
      lamport     INTEGER NOT NULL,
      device_id   TEXT NOT NULL,
      sync_at     INTEGER NOT NULL,
      natural_key TEXT,
      PRIMARY KEY (table_name, sync_id)
    );
  `);

  database.exec(`INSERT OR IGNORE INTO sync_meta (key, value) VALUES
    ('lamport', '0'),
    ('apply', '0'),
    ('device', '${randomUUID()}'),
    ('bridge_cursor', '0'),
    ('baseline_pushed', '0')`);

  if (process.env.GESTOR_ROLE === "bridge" && meta(database, "role") !== "bridge") {
    database.prepare(`UPDATE sync_meta SET value = ? WHERE key = 'device'`).run(randomUUID());
    database.prepare(
      `INSERT INTO sync_meta (key, value) VALUES ('role', 'bridge')
       ON CONFLICT(key) DO UPDATE SET value = 'bridge'`,
    ).run();
  }

  for (const table of SYNC_TABLES) {
    for (const column of SYNC_COLUMNS) {
      ensureColumn(database, table.name, column.name, column.ddl);
    }
    database.exec(`UPDATE ${table.name} SET sync_id = uuid() WHERE sync_id IS NULL OR sync_id = ''`);
    database.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_${table.name}_sync_id ON ${table.name}(sync_id)`,
    );
  }

  installTriggers(database);
}
