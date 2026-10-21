import { db } from "../db.js";
import { SYNC_TABLES, syncTable, type SyncTable } from "./catalog.js";

type SqlParam = string | number | bigint | null | Uint8Array;

export type SyncChange = {
  table: string;
  op: "upsert" | "delete";
  sync_id: string;
  lamport: number;
  device_id: string;
  sync_at: number;
  payload: Record<string, unknown>;
};

export type ApplyResult = {
  /** Entraram, já estavam iguais ou perderam para uma versão mais nova. */
  settled: { table: string; sync_id: string }[];
  /** A cópia local era mais nova. O outro aparelho deve adotá-la. */
  winners: SyncChange[];
  /** Não deu para encaixar (pai obrigatório ausente). Fica para a próxima. */
  skipped: { table: string; sync_id: string; reason: string }[];
};

type LocalRow = {
  pk: string | number;
  sync_id: string;
  sync_lamport: number;
  sync_device: string;
  sync_at: number;
};

function asParam(value: unknown): SqlParam {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  return null;
}

/** 1 se o remoto é mais novo, -1 se o local é mais novo, 0 se é a mesma alteração. */
export function compareVersions(
  local: { sync_at: number; sync_lamport: number; sync_device: string },
  remote: { sync_at: number; lamport: number; device_id: string },
): number {
  if (remote.sync_at !== local.sync_at) return remote.sync_at > local.sync_at ? 1 : -1;
  if (remote.lamport !== local.sync_lamport) return remote.lamport > local.sync_lamport ? 1 : -1;
  if (remote.device_id === local.sync_device) return 0;
  return remote.device_id > local.sync_device ? 1 : -1;
}

function naturalKey(table: SyncTable, payload: Record<string, unknown>): string | null {
  if (table.natural === "month") return payload.month == null ? null : String(payload.month);
  if (table.natural === "card_month") {
    if (payload.card_sync_id == null || payload.month == null) return null;
    return `${payload.card_sync_id}|${payload.month}`;
  }
  if (table.natural === "rule_month") {
    if (payload.rule_sync_id == null || payload.month == null) return null;
    return `${payload.rule_sync_id}|${payload.month}`;
  }
  return null;
}

export function meta(key: string): string | undefined {
  const row = db.prepare(`SELECT value FROM sync_meta WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setMeta(key: string, value: string) {
  db.prepare(
    `INSERT INTO sync_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

/** Gravações feitas aqui não voltam para a caixa de saída. */
export function withApply<T>(fn: () => T): T {
  setMeta("apply", "1");
  try {
    return fn();
  } finally {
    setMeta("apply", "0");
  }
}

function noteClock(change: SyncChange) {
  db.prepare(
    `UPDATE sync_meta
        SET value = CAST(max(CAST(value AS INTEGER), ?) AS TEXT)
      WHERE key = 'lamport'`,
  ).run(change.lamport);
}

function parentId(parent: string, syncId: string): number | null {
  const row = db.prepare(`SELECT id FROM ${parent} WHERE sync_id = ?`).get(syncId) as
    | { id: number }
    | undefined;
  return row?.id ?? null;
}

function findLocal(table: SyncTable, change: SyncChange): LocalRow | null {
  const bySync = db
    .prepare(
      `SELECT ${table.match === "id" ? "id" : table.match === "month" ? "month" : "sync_id"} AS pk,
              sync_id, sync_lamport, sync_device, sync_at
         FROM ${table.name} WHERE sync_id = ?`,
    )
    .get(change.sync_id) as LocalRow | undefined;
  if (bySync) return bySync;

  if (table.natural === "month") {
    return (
      (db
        .prepare(
          `SELECT month AS pk, sync_id, sync_lamport, sync_device, sync_at
             FROM months WHERE month = ?`,
        )
        .get(asParam(change.payload.month)) as LocalRow | undefined) ?? null
    );
  }
  if (table.natural === "card_month") {
    return (
      (db
        .prepare(
          `SELECT i.id AS pk, i.sync_id, i.sync_lamport, i.sync_device, i.sync_at
             FROM card_invoices i
             JOIN cards c ON c.id = i.card_id
            WHERE c.sync_id = ? AND i.month = ?`,
        )
        .get(asParam(change.payload.card_sync_id), asParam(change.payload.month)) as
        | LocalRow
        | undefined) ?? null
    );
  }
  if (table.natural === "rule_month") {
    return (
      (db
        .prepare(
          `SELECT s.sync_id AS pk, s.sync_id, s.sync_lamport, s.sync_device, s.sync_at
             FROM expense_rule_skips s
             JOIN expense_rules r ON r.id = s.rule_id
            WHERE r.sync_id = ? AND s.month = ?`,
        )
        .get(asParam(change.payload.rule_sync_id), asParam(change.payload.month)) as
        | LocalRow
        | undefined) ?? null
    );
  }
  return null;
}

function tombstoneWins(table: SyncTable, change: SyncChange): boolean {
  const key = naturalKey(table, change.payload);
  const rows = db
    .prepare(
      `SELECT lamport, device_id, sync_at FROM sync_tombstones
        WHERE table_name = ? AND (sync_id = ? OR (? IS NOT NULL AND natural_key = ?))`,
    )
    .all(table.name, change.sync_id, key, key) as {
    lamport: number;
    device_id: string;
    sync_at: number;
  }[];
  return rows.some(
    (row) =>
      compareVersions(
        { sync_at: row.sync_at, sync_lamport: row.lamport, sync_device: row.device_id },
        change,
      ) <= 0,
  );
}

function writeTombstone(table: SyncTable, change: SyncChange) {
  const key = naturalKey(table, change.payload);
  db.prepare(
    `INSERT INTO sync_tombstones (table_name, sync_id, lamport, device_id, sync_at, natural_key)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(table_name, sync_id) DO UPDATE SET
       lamport = excluded.lamport,
       device_id = excluded.device_id,
       sync_at = excluded.sync_at,
       natural_key = excluded.natural_key
     WHERE excluded.sync_at >= sync_tombstones.sync_at`,
  ).run(table.name, change.sync_id, change.lamport, change.device_id, change.sync_at, key);
}

function clearTombstone(table: SyncTable, change: SyncChange) {
  const key = naturalKey(table, change.payload);
  db.prepare(
    `DELETE FROM sync_tombstones
      WHERE table_name = ? AND (sync_id = ? OR (? IS NOT NULL AND natural_key = ?))`,
  ).run(table.name, change.sync_id, key, key);
}

function whereOf(table: SyncTable, local: LocalRow): { sql: string; param: SqlParam } {
  if (table.match === "month") return { sql: "month = ?", param: local.pk as string };
  if (table.match === "rule_month") return { sql: "sync_id = ?", param: local.sync_id };
  return { sql: "id = ?", param: local.pk as number };
}

export function exportLive(tableName: string, syncId: string): SyncChange | null {
  const table = syncTable(tableName);
  const fkSql = table.fks
    .map(
      (fk) =>
        `(SELECT p.sync_id FROM ${fk.parent} p WHERE p.id = t.${fk.column}) AS ${fk.payloadKey}`,
    )
    .join(", ");
  const cols = ["t.sync_id", "t.sync_lamport", "t.sync_device", "t.sync_at", ...table.columns.map((c) => `t.${c}`)];
  if (fkSql) cols.push(fkSql);
  const row = db
    .prepare(`SELECT ${cols.join(", ")} FROM ${table.name} t WHERE t.sync_id = ?`)
    .get(syncId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const payload: Record<string, unknown> = {};
  for (const column of table.columns) payload[column] = row[column] ?? null;
  for (const fk of table.fks) payload[fk.payloadKey] = row[fk.payloadKey] ?? null;
  return {
    table: table.name,
    op: "upsert",
    sync_id: String(row.sync_id),
    lamport: Number(row.sync_lamport),
    device_id: String(row.sync_device ?? ""),
    sync_at: Number(row.sync_at ?? 0),
    payload,
  };
}

export function exportAll(): SyncChange[] {
  const changes: SyncChange[] = [];
  for (const table of SYNC_TABLES) {
    const ids = db.prepare(`SELECT sync_id FROM ${table.name} WHERE sync_id IS NOT NULL`).all() as {
      sync_id: string;
    }[];
    for (const row of ids) {
      const change = exportLive(table.name, row.sync_id);
      if (change) changes.push(change);
    }
  }
  return changes;
}

type OutboxRow = {
  id: number;
  table_name: string;
  sync_id: string;
  op: string;
  lamport: number;
  device_id: string;
  sync_at: number;
  payload: string | null;
};

function collapse(rows: OutboxRow[]): { maxId: number; changes: SyncChange[] } {
  const maxId = rows.length ? rows[rows.length - 1]!.id : 0;
  const last = new Map<string, OutboxRow>();
  for (const row of rows) last.set(`${row.table_name}\0${row.sync_id}`, row);
  const changes: SyncChange[] = [];
  for (const row of last.values()) {
    if (row.op === "delete") {
      let payload: Record<string, unknown> = {};
      if (row.payload) {
        try {
          payload = JSON.parse(row.payload) as Record<string, unknown>;
        } catch {
          payload = {};
        }
      }
      changes.push({
        table: row.table_name,
        op: "delete",
        sync_id: row.sync_id,
        lamport: row.lamport,
        device_id: row.device_id,
        sync_at: row.sync_at,
        payload,
      });
      continue;
    }
    const live = exportLive(row.table_name, row.sync_id);
    if (live) changes.push(live);
  }
  return { maxId, changes };
}

/** O que este aparelho ainda não entregou. Upsert sai do estado atual da linha. */
export function takePending(): { maxId: number; changes: SyncChange[] } {
  const rows = db
    .prepare(
      `SELECT id, table_name, sync_id, op, lamport, device_id, sync_at, payload
         FROM sync_outbox ORDER BY id`,
    )
    .all() as OutboxRow[];
  return collapse(rows);
}

/** Log da ponte a partir do cursor do outro aparelho. */
export function readLog(after: number): { upTo: number; changes: SyncChange[] } {
  const rows = db
    .prepare(
      `SELECT id, table_name, sync_id, op, lamport, device_id, sync_at, payload
         FROM sync_outbox WHERE id > ? ORDER BY id`,
    )
    .all(after) as OutboxRow[];
  const { maxId, changes } = collapse(rows);
  return { upTo: rows.length ? maxId : after, changes };
}

export function discardOutbox(maxId: number, keys: { table: string; sync_id: string }[]) {
  const stmt = db.prepare(
    `DELETE FROM sync_outbox WHERE id <= ? AND table_name = ? AND sync_id = ?`,
  );
  for (const key of keys) stmt.run(maxId, key.table, key.sync_id);
}

function sortChanges(changes: SyncChange[]): SyncChange[] {
  const rank = new Map(SYNC_TABLES.map((table, index) => [table.name, index]));
  return [...changes].sort((a, b) => {
    const delta = (rank.get(a.table) ?? 99) - (rank.get(b.table) ?? 99);
    if (delta !== 0) return delta;
    if (a.table === "categories") {
      const ap = a.payload.parent_sync_id ? 1 : 0;
      const bp = b.payload.parent_sync_id ? 1 : 0;
      if (ap !== bp) return ap - bp;
    }
    if (a.table === "account_adjustments") {
      const self = (change: SyncChange) =>
        !change.payload.transfer_sync_id || change.payload.transfer_sync_id === change.sync_id
          ? 0
          : 1;
      const d = self(a) - self(b);
      if (d !== 0) return d;
    }
    return 0;
  });
}

function resolveFks(
  table: SyncTable,
  change: SyncChange,
): { ids: Map<string, number | null>; selfTransfer: boolean; missing: string | null } {
  const ids = new Map<string, number | null>();
  let selfTransfer = false;
  for (const fk of table.fks) {
    const syncId = change.payload[fk.payloadKey];
    if (syncId == null || syncId === "") {
      ids.set(fk.payloadKey, null);
      continue;
    }
    if (fk.payloadKey === "transfer_sync_id" && syncId === change.sync_id) {
      selfTransfer = true;
      ids.set(fk.payloadKey, null);
      continue;
    }
    const id = parentId(fk.parent, String(syncId));
    if (id == null && fk.required) {
      return { ids, selfTransfer, missing: fk.parent };
    }
    ids.set(fk.payloadKey, id);
  }
  return { ids, selfTransfer, missing: null };
}

function columnValues(
  table: SyncTable,
  change: SyncChange,
  ids: Map<string, number | null>,
): { cols: string[]; vals: SqlParam[] } {
  const cols = ["sync_id", "sync_lamport", "sync_device", "sync_at"];
  const vals: SqlParam[] = [change.sync_id, change.lamport, change.device_id, change.sync_at];
  for (const column of table.columns) {
    cols.push(column);
    vals.push(asParam(change.payload[column]));
  }
  for (const fk of table.fks) {
    cols.push(fk.column);
    vals.push(ids.get(fk.payloadKey) ?? null);
  }
  return { cols, vals };
}

function applyUpsert(table: SyncTable, change: SyncChange, result: ApplyResult) {
  if (tombstoneWins(table, change)) {
    result.settled.push({ table: table.name, sync_id: change.sync_id });
    return;
  }
  const local = findLocal(table, change);
  if (local) {
    const cmp = compareVersions(local, change);
    if (cmp < 0) {
      const winner = exportLive(table.name, local.sync_id);
      if (winner) result.winners.push(winner);
      result.settled.push({ table: table.name, sync_id: change.sync_id });
      return;
    }
    if (cmp === 0) {
      result.settled.push({ table: table.name, sync_id: change.sync_id });
      return;
    }
  }

  const resolved = resolveFks(table, change);
  if (resolved.missing) {
    result.skipped.push({
      table: table.name,
      sync_id: change.sync_id,
      reason: `Sem ${resolved.missing} para encaixar`,
    });
    return;
  }
  const { cols, vals } = columnValues(table, change, resolved.ids);
  if (local) {
    const where = whereOf(table, local);
    const assigns = cols.map((col) => `${col} = ?`).join(", ");
    db.prepare(`UPDATE ${table.name} SET ${assigns} WHERE ${where.sql}`).run(...vals, where.param);
  } else {
    const placeholders = cols.map(() => "?").join(", ");
    db.prepare(`INSERT INTO ${table.name} (${cols.join(", ")}) VALUES (${placeholders})`).run(...vals);
  }
  if (resolved.selfTransfer) {
    db.prepare(`UPDATE ${table.name} SET transfer_id = id WHERE sync_id = ?`).run(change.sync_id);
  }
  clearTombstone(table, change);
  noteClock(change);
  result.settled.push({ table: table.name, sync_id: change.sync_id });
}

function applyDelete(table: SyncTable, change: SyncChange, result: ApplyResult) {
  const local = findLocal(table, change);
  if (local) {
    const cmp = compareVersions(local, change);
    if (cmp <= 0) {
      if (cmp < 0) {
        const winner = exportLive(table.name, local.sync_id);
        if (winner) result.winners.push(winner);
      }
      result.settled.push({ table: table.name, sync_id: change.sync_id });
      return;
    }
    const where = whereOf(table, local);
    db.prepare(`DELETE FROM ${table.name} WHERE ${where.sql}`).run(where.param);
  }
  writeTombstone(table, change);
  noteClock(change);
  result.settled.push({ table: table.name, sync_id: change.sync_id });
}

export function applyChanges(changes: SyncChange[]): ApplyResult {
  const result: ApplyResult = { settled: [], winners: [], skipped: [] };
  const run = db.transaction(() => {
    withApply(() => {
      for (const change of sortChanges(changes)) {
        const table = syncTable(change.table);
        if (change.op === "delete") applyDelete(table, change, result);
        else applyUpsert(table, change, result);
      }
    });
  });
  run();
  return result;
}
