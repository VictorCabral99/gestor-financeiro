import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { dedupeCategoryColors } from "./lib/categoryColors.js";
import { dataDir, schemaPath } from "./paths.js";
import { migrateSync, registerSyncFunctions } from "./sync/migrate.js";
import {
  ensureProfiles,
  getProfile,
  profileDbPath,
  resolveProfileId,
  type Profile,
} from "./profiles.js";

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Migração: DB antigo em <repo>/data → server/data
const legacyDb = path.resolve(dataDir, "../../data/gestor.db");
const defaultDbFile = path.join(dataDir, "gestor.db");
if (!fs.existsSync(defaultDbFile) && fs.existsSync(legacyDb)) {
  fs.renameSync(legacyDb, defaultDbFile);
  for (const suffix of ["-shm", "-wal"] as const) {
    const src = legacyDb + suffix;
    if (fs.existsSync(src)) fs.renameSync(src, defaultDbFile + suffix);
  }
}

type SqlParam = string | number | bigint | null | Uint8Array;

type Statement = {
  run: (...params: SqlParam[]) => { lastInsertRowid: number | bigint; changes: number };
  get: (...params: SqlParam[]) => Record<string, unknown> | undefined;
  all: (...params: SqlParam[]) => Record<string, unknown>[];
};

type Conn = {
  profileId: string;
  filePath: string;
  raw: DatabaseSync;
};

const als = new AsyncLocalStorage<Conn>();
const pool = new Map<string, Conn>();
let fallbackProfileId = resolveProfileId(null);

function openRaw(filePath: string): DatabaseSync {
  const database = new DatabaseSync(filePath);
  registerSyncFunctions(database);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");

  const schema = fs.readFileSync(schemaPath, "utf8");
  database.exec(schema);
  runLightMigrations(database);
  migrateSync(database);
  return database;
}

function ensureColumn(database: DatabaseSync, table: string, column: string, ddl: string) {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function isSyntheticPurchaseDate(date: string, expenseMonth: string): boolean {
  return date === `${expenseMonth}-01`;
}

function backfillInstallmentPurchaseDates(database: DatabaseSync) {
  /**
   * Datas corrigidas na fatura Nubank 2026-09 (antes de um backfill
   * incorreto que propagou month-01). Recuperação pontual por descrição.
   */
  const knownNubankPurchaseDates: Record<string, string> = {
    "Fonte 850W": "2026-01-05",
    "SSD 2TB Kingston": "2026-01-09",
    "Peça PC": "2026-05-19",
    "Parque da Mônica": "2026-06-27",
  };

  const rules = database
    .prepare(
      `SELECT r.id, r.description, r.purchase_date, r.card_id
       FROM expense_rules r
       WHERE r.type = 'fixed_installment'
         AND EXISTS (SELECT 1 FROM expenses e WHERE e.rule_id = r.id)`,
    )
    .all() as {
    id: number;
    description: string;
    purchase_date: string | null;
    card_id: number | null;
  }[];
  if (rules.length === 0) return;

  // Fatura Nubank aberta com datas de compra reais (não month-01 da fatura).
  const refInvoice = database
    .prepare(
      `SELECT i.id FROM card_invoices i
       JOIN cards c ON c.id = i.card_id
       WHERE c.name LIKE '%Nubank%' AND c.archived = 0 AND i.status = 'open'
         AND EXISTS (
           SELECT 1 FROM expenses e
           WHERE e.invoice_id = i.id AND e.rule_id IS NOT NULL
             AND e.kind = 'fixed_installment'
             AND e.inclusion_date != (e.month || '-01')
         )
       ORDER BY i.month ASC
       LIMIT 1`,
    )
    .get() as { id: number } | undefined;

  const fromRef = new Map<number, string>();
  if (refInvoice) {
    const rows = database
      .prepare(
        `SELECT rule_id, inclusion_date, month FROM expenses
         WHERE invoice_id = ? AND rule_id IS NOT NULL AND kind = 'fixed_installment'`,
      )
      .all(refInvoice.id) as {
      rule_id: number;
      inclusion_date: string;
      month: string;
    }[];
    for (const r of rows) {
      if (!isSyntheticPurchaseDate(r.inclusion_date, r.month)) {
        fromRef.set(r.rule_id, r.inclusion_date);
      }
    }
  }

  const setRule = database.prepare(
    `UPDATE expense_rules SET purchase_date = ? WHERE id = ?`,
  );
  const setExpenses = database.prepare(
    `UPDATE expenses SET inclusion_date = ? WHERE rule_id = ?`,
  );
  const siblingMonths = database.prepare(
    `SELECT DISTINCT month FROM expenses WHERE rule_id = ?`,
  );

  database.exec("BEGIN");
  try {
    for (const rule of rules) {
      const months = siblingMonths.all(rule.id) as { month: string }[];
      const purchaseLooksSynthetic =
        !!rule.purchase_date &&
        months.some((m) =>
          isSyntheticPurchaseDate(rule.purchase_date!, m.month),
        );
      const known = knownNubankPurchaseDates[rule.description];

      let canonical: string | null = null;
      if (known && (rule.purchase_date == null || purchaseLooksSynthetic)) {
        canonical = known;
      } else if (fromRef.has(rule.id)) {
        const refDate = fromRef.get(rule.id)!;
        if (rule.purchase_date == null || purchaseLooksSynthetic) {
          canonical = refDate;
        }
      } else if (rule.purchase_date == null || purchaseLooksSynthetic) {
        const picked = database
          .prepare(
            `SELECT inclusion_date FROM expenses
             WHERE rule_id = ? AND inclusion_date != (month || '-01')
             ORDER BY inclusion_date ASC, id ASC
             LIMIT 1`,
          )
          .get(rule.id) as { inclusion_date: string } | undefined;
        canonical =
          picked?.inclusion_date ??
          (
            database
              .prepare(
                `SELECT inclusion_date FROM expenses WHERE rule_id = ? ORDER BY id ASC LIMIT 1`,
              )
              .get(rule.id) as { inclusion_date: string } | undefined
          )?.inclusion_date ??
          null;
      }

      if (!canonical) continue;
      if (rule.purchase_date === canonical) {
        // Ainda pode haver irmãs desalinhadas
        const divergent = database
          .prepare(
            `SELECT 1 FROM expenses WHERE rule_id = ? AND inclusion_date != ? LIMIT 1`,
          )
          .get(rule.id, canonical);
        if (!divergent) continue;
      }
      setRule.run(canonical, rule.id);
      setExpenses.run(canonical, rule.id);
    }
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
}

function runLightMigrations(database: DatabaseSync) {
  ensureColumn(database, "expense_rules", "installment_from", "installment_from INTEGER NOT NULL DEFAULT 1");
  ensureColumn(database, "expense_rules", "purchase_date", "purchase_date TEXT");
  ensureColumn(database, "account_adjustments", "transfer_id", "transfer_id INTEGER");
  ensureColumn(database, "account_adjustments", "reserve_move_id", "reserve_move_id INTEGER");
  backfillInstallmentPurchaseDates(database);

  // Reservas com saldo antigo (sem movimentos): debita a conta vinculada uma vez
  {
    const moveCount = database
      .prepare(`SELECT COUNT(*) AS n FROM reserve_movements`)
      .get() as { n: number };
    if (moveCount.n === 0) {
      const legacy = database
        .prepare(
          `SELECT id, name, current_amount, account_id FROM reserves
           WHERE archived = 0 AND current_amount > 0 AND account_id IS NOT NULL`,
        )
        .all() as {
        id: number;
        name: string;
        current_amount: number;
        account_id: number;
      }[];
      if (legacy.length > 0) {
        const today = new Date().toISOString().slice(0, 10);
        const insertMov = database.prepare(
          `INSERT INTO reserve_movements (reserve_id, account_id, direction, amount, date, note)
           VALUES (?, ?, 'in', ?, ?, ?)`,
        );
        const insertAdj = database.prepare(
          `INSERT INTO account_adjustments (account_id, amount, date, note, reserve_move_id)
           VALUES (?, ?, ?, ?, ?)`,
        );
        database.exec("BEGIN");
        try {
          for (const r of legacy) {
            const mov = insertMov.run(
              r.id,
              r.account_id,
              r.current_amount,
              today,
              "Migração: saldo já guardado na reserva",
            );
            const moveId = Number(mov.lastInsertRowid);
            insertAdj.run(
              r.account_id,
              -r.current_amount,
              today,
              `Guardar em ${r.name} — Migração: saldo já guardado na reserva`,
              moveId,
            );
          }
          database.exec("COMMIT");
        } catch (err) {
          database.exec("ROLLBACK");
          throw err;
        }
      }
    }
  }

  // Categorias com a mesma cor recebem cores distintas da paleta
  {
    const rows = database
      .prepare(`SELECT id, color FROM categories ORDER BY id`)
      .all() as { id: number; color: string }[];
    const updates = dedupeCategoryColors(rows);
    if (updates.length > 0) {
      const upd = database.prepare(`UPDATE categories SET color = ? WHERE id = ?`);
      database.exec("BEGIN");
      try {
        for (const u of updates) upd.run(u.color, u.id);
        database.exec("COMMIT");
      } catch (err) {
        database.exec("ROLLBACK");
        throw err;
      }
    }
  }
}

function openProfile(profile: Profile): Conn {
  const existing = pool.get(profile.id);
  if (existing) return existing;

  const filePath = profileDbPath(profile);
  const raw = openRaw(filePath);
  const conn: Conn = { profileId: profile.id, filePath, raw };
  pool.set(profile.id, conn);
  return conn;
}

function currentConn(): Conn {
  return als.getStore() ?? openProfile(getProfile(fallbackProfileId));
}

function wrapStatement(sql: string): Statement {
  return {
    run(...params: SqlParam[]) {
      const result = currentConn().raw.prepare(sql).run(...params);
      return {
        lastInsertRowid: result.lastInsertRowid as number | bigint,
        changes: Number(result.changes),
      };
    },
    get(...params: SqlParam[]) {
      return currentConn().raw.prepare(sql).get(...params) as
        | Record<string, unknown>
        | undefined;
    },
    all(...params: SqlParam[]) {
      return currentConn().raw.prepare(sql).all(...params) as Record<string, unknown>[];
    },
  };
}

function removeSidecars(filePath: string) {
  for (const suffix of ["-wal", "-shm"] as const) {
    const side = filePath + suffix;
    if (fs.existsSync(side)) fs.unlinkSync(side);
  }
}

function closeConn(conn: Conn) {
  try {
    conn.raw.exec("PRAGMA wal_checkpoint(FULL)");
  } catch {
    // ignore
  }
  conn.raw.close();
  pool.delete(conn.profileId);
}

/** Abre (se preciso) e executa fn no contexto do perfil. */
export function runWithProfile<T>(profileId: string, fn: () => T): T {
  const id = resolveProfileId(profileId);
  const conn = openProfile(getProfile(id));
  return als.run(conn, fn);
}

/** Garante conexões abertas para todos os perfis (sync no boot). */
export function forEachProfile(fn: (profile: Profile) => void) {
  for (const profile of ensureProfiles()) {
    runWithProfile(profile.id, () => fn(profile));
  }
}

export function evictProfile(profileId: string) {
  const conn = pool.get(profileId);
  if (conn) closeConn(conn);
}

export function setFallbackProfile(profileId: string) {
  fallbackProfileId = resolveProfileId(profileId);
}

ensureProfiles();
openProfile(getProfile(fallbackProfileId));

export const db = {
  prepare(sql: string) {
    return wrapStatement(sql);
  },
  exec(sql: string) {
    currentConn().raw.exec(sql);
  },
  /** Compacta o WAL para não crescer sem necessidade. */
  checkpointWal() {
    try {
      currentConn().raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // ignore
    }
  },
  /** Caminho do arquivo SQLite do perfil atual. */
  filePath() {
    return currentConn().filePath;
  },
  profileId() {
    return currentConn().profileId;
  },
  close() {
    const conn = currentConn();
    try {
      conn.raw.exec("PRAGMA wal_checkpoint(FULL)");
    } catch {
      // ignore
    }
    try {
      conn.raw.close();
    } catch {
      // ignore
    }
    pool.delete(conn.profileId);
  },
  /** Reabre o arquivo do perfil atual (após restore/cópia). */
  reopen() {
    const prev = currentConn();
    const profileId = prev.profileId;
    const filePath = prev.filePath;
    const store = als.getStore();

    const pooled = pool.get(profileId);
    if (pooled) {
      try {
        pooled.raw.close();
      } catch {
        // ignore
      }
      pool.delete(profileId);
    }

    removeSidecars(filePath);
    const raw = openRaw(filePath);
    if (store && store.profileId === profileId) {
      store.raw = raw;
      store.filePath = filePath;
      pool.set(profileId, store);
    } else {
      pool.set(profileId, { profileId, filePath, raw });
    }
  },
  transaction<T>(fn: () => T): () => T {
    return () => {
      const raw = currentConn().raw;
      raw.exec("BEGIN");
      try {
        const result = fn();
        raw.exec("COMMIT");
        return result;
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
    };
  },
};

export type Db = typeof db;
