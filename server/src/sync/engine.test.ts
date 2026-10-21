import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gestor-sync-"));
process.env.GESTOR_DATA_DIR = tempDir;
process.env.GESTOR_ROLE = "";

const { db } = await import("../db.js");
const { applyChanges, exportLive, takePending } = await import("./engine.js");

function outboxCount(): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM sync_outbox`).get() as { n: number };
  return row.n;
}

describe("sincronização", () => {
  after(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
  });

  it("dá sync_id e registra o insert na caixa de saída", () => {
    const before = outboxCount();
    const created = db.prepare(`INSERT INTO accounts (name, opening_balance) VALUES ('Nubank', 100)`).run();
    const id = Number(created.lastInsertRowid);
    const row = db
      .prepare(`SELECT sync_id, sync_lamport, sync_device, sync_at FROM accounts WHERE id = ?`)
      .get(id) as { sync_id: string; sync_lamport: number; sync_device: string; sync_at: number };
    assert.match(row.sync_id, /^[0-9a-f-]{36}$/);
    assert.ok(row.sync_lamport >= 1);
    assert.ok(row.sync_device);
    assert.ok(row.sync_at > 0);
    assert.equal(outboxCount(), before + 1);

    const pending = takePending();
    const change = pending.changes.find((item) => item.sync_id === row.sync_id);
    assert.ok(change);
    assert.equal(change.op, "upsert");
    assert.equal(change.payload.name, "Nubank");
  });

  it("encaixa pelo sync_id, reescreve a chave estrangeira e não ecoa na caixa", () => {
    const account = exportLive(
      "accounts",
      (
        db.prepare(`SELECT sync_id FROM accounts WHERE name = 'Nubank'`).get() as { sync_id: string }
      ).sync_id,
    );
    assert.ok(account);

    const before = outboxCount();
    const expenseId = "22222222-2222-4222-8222-222222222222";
    const applied = applyChanges([
      {
        table: "expenses",
        op: "upsert",
        sync_id: expenseId,
        lamport: 4,
        device_id: "celular",
        sync_at: Date.now() + 60_000,
        payload: {
          description: "Padaria",
          kind: "single",
          amount: 1500,
          month: "2026-10",
          inclusion_date: "2026-10-20",
          due_date: "2026-10-20",
          payment_date: "2026-10-20",
          status: "paid",
          installment_number: null,
          installments_total: null,
          created_at: "2026-10-20 12:00:00",
          rule_sync_id: null,
          category_sync_id: null,
          account_sync_id: account.sync_id,
          card_sync_id: null,
          reserve_sync_id: null,
          invoice_sync_id: null,
        },
      },
    ]);

    assert.equal(applied.skipped.length, 0);
    assert.equal(applied.winners.length, 0);
    assert.equal(outboxCount(), before);

    const saved = db
      .prepare(
        `SELECT e.account_id, a.sync_id AS account_sync_id
           FROM expenses e JOIN accounts a ON a.id = e.account_id
          WHERE e.sync_id = ?`,
      )
      .get(expenseId) as { account_id: number; account_sync_id: string };
    assert.equal(saved.account_sync_id, account.sync_id);
    assert.equal(saved.account_id, 1);
  });

  it("não deixa uma alteração mais antiga ressuscitar a linha apagada", () => {
    const expenseId = "22222222-2222-4222-8222-222222222222";
    const live = exportLive("expenses", expenseId);
    assert.ok(live);

    const before = outboxCount();
    applyChanges([
      {
        ...live,
        op: "delete",
        lamport: live.lamport + 1,
        sync_at: live.sync_at + 1,
        device_id: "celular",
        payload: live.payload,
      },
    ]);
    assert.equal(
      db.prepare(`SELECT id FROM expenses WHERE sync_id = ?`).get(expenseId),
      undefined,
    );
    assert.equal(outboxCount(), before);

    applyChanges([
      {
        ...live,
        op: "upsert",
        lamport: live.lamport,
        sync_at: live.sync_at,
        device_id: "celular",
      },
    ]);
    assert.equal(
      db.prepare(`SELECT id FROM expenses WHERE sync_id = ?`).get(expenseId),
      undefined,
    );
  });

  it("mantém a alteração local quando ela é mais nova", () => {
    const created = db.prepare(`INSERT INTO accounts (name, opening_balance) VALUES ('Santander', 50)`).run();
    const id = Number(created.lastInsertRowid);
    const local = db.prepare(`SELECT sync_id, sync_at, sync_lamport FROM accounts WHERE id = ?`).get(id) as {
      sync_id: string;
      sync_at: number;
      sync_lamport: number;
    };
    const result = applyChanges([
      {
        table: "accounts",
        op: "upsert",
        sync_id: local.sync_id,
        lamport: local.sync_lamport,
        device_id: "outro",
        sync_at: local.sync_at - 10_000,
        payload: {
          name: "Nome velho",
          opening_balance: 1,
          archived: 0,
          created_at: "2026-01-01 00:00:00",
        },
      },
    ]);
    assert.equal(result.winners.length, 1);
    assert.equal(result.winners[0]!.payload.name, "Santander");
    const name = db.prepare(`SELECT name FROM accounts WHERE id = ?`).get(id) as { name: string };
    assert.equal(name.name, "Santander");
  });

  it("une o mês pela chave natural quando os sync_id diferem", () => {
    db.prepare(`INSERT INTO months (month, status) VALUES ('2026-10', 'open')`).run();
    const before = db.prepare(`SELECT COUNT(*) AS n FROM months WHERE month = '2026-10'`).get() as {
      n: number;
    };
    assert.equal(before.n, 1);

    applyChanges([
      {
        table: "months",
        op: "upsert",
        sync_id: "33333333-3333-4333-8333-333333333333",
        lamport: 9,
        device_id: "celular",
        sync_at: Date.now() + 120_000,
        payload: {
          month: "2026-10",
          status: "closed",
          closed_at: "2026-11-01 00:00:00",
          created_at: "2026-10-01 00:00:00",
        },
      },
    ]);

    const rows = db
      .prepare(`SELECT sync_id, status FROM months WHERE month = '2026-10'`)
      .all() as { sync_id: string; status: string }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.status, "closed");
    assert.equal(rows[0]!.sync_id, "33333333-3333-4333-8333-333333333333");
  });
});
