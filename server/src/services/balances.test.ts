import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gestor-balances-"));
process.env.GESTOR_DATA_DIR = tempDir;

const { db } = await import("../db.js");
const { afterObligations } = await import("./balances.js");

describe("afterObligations", () => {
  before(() => {
    db.exec(`
      DELETE FROM expenses;
      DELETE FROM card_invoice_payments;
      DELETE FROM card_invoices;
      DELETE FROM incomes;
      DELETE FROM accounts;
      DELETE FROM cards;
    `);

    const acc = db
      .prepare(`INSERT INTO accounts (name, opening_balance) VALUES ('CC', 100000)`)
      .run();
    const accountId = Number(acc.lastInsertRowid);

    const unique = db
      .prepare(
        `INSERT INTO cards (name, credit_limit, closing_day, due_day) VALUES ('Unique', 500000, 11, 18)`,
      )
      .run();
    const uniqueId = Number(unique.lastInsertRowid);

    const nubank = db
      .prepare(
        `INSERT INTO cards (name, credit_limit, closing_day, due_day) VALUES ('Nubank', 500000, 29, 5)`,
      )
      .run();
    const nubankId = Number(nubank.lastInsertRowid);

    const uniqueInv = db
      .prepare(
        `INSERT INTO card_invoices (card_id, month, closing_date, due_date, status)
         VALUES (?, '2026-09', '2026-09-11', '2026-09-18', 'closed')`,
      )
      .run(uniqueId);
    const uniqueInvoiceId = Number(uniqueInv.lastInsertRowid);

    const nubankInv = db
      .prepare(
        `INSERT INTO card_invoices (card_id, month, closing_date, due_date, status)
         VALUES (?, '2026-09', '2026-08-29', '2026-09-05', 'paid')`,
      )
      .run(nubankId);
    const nubankInvoiceId = Number(nubankInv.lastInsertRowid);

    db.prepare(
      `INSERT INTO expenses
        (description, kind, amount, month, account_id, card_id, invoice_id, inclusion_date, due_date, status)
       VALUES ('Compra Unique', 'single', 20000, '2026-09', NULL, ?, ?, '2026-09-01', '2026-09-18', 'pending')`,
    ).run(uniqueId, uniqueInvoiceId);

    db.prepare(
      `INSERT INTO expenses
        (description, kind, amount, month, account_id, card_id, invoice_id, inclusion_date, due_date, status)
       VALUES ('Compra Nubank', 'single', 15000, '2026-09', NULL, ?, ?, '2026-08-20', '2026-09-05', 'paid')`,
    ).run(nubankId, nubankInvoiceId);

    db.prepare(
      `INSERT INTO card_invoice_payments (invoice_id, account_id, amount, paid_at, note)
       VALUES (?, ?, 15000, '2026-09-05', 'pago')`,
    ).run(nubankInvoiceId, accountId);

    db.prepare(
      `INSERT INTO expenses
        (description, kind, amount, month, account_id, card_id, inclusion_date, due_date, status)
       VALUES ('Internet', 'single', 10000, '2026-09', ?, NULL, '2026-09-01', '2026-09-20', 'pending')`,
    ).run(accountId);
  });

  after(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("desconta pending de conta + fatura unpaid; ignora fatura paga", () => {
    const result = afterObligations("2026-09");
    // opening 100000 − pagamento Nubank 15000 = 85000
    assert.equal(result.cash, 85000);
    assert.equal(result.pending_accounts, 10000);
    assert.equal(result.unpaid_invoices, 20000);
    assert.equal(result.available, 55000);
  });
});
