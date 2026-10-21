import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gestor-ledger-"));
process.env.GESTOR_DATA_DIR = tempDir;

const { db } = await import("../db.js");
const {
  listExpensesForLens,
  monthLedgerTotals,
  parseBasis,
  parseChannel,
} = await import("./ledger.js");

describe("ledger lens", () => {
  before(() => {
    db.exec(`
      DELETE FROM expenses;
      DELETE FROM card_invoice_payments;
      DELETE FROM card_invoices;
      DELETE FROM incomes;
      DELETE FROM accounts;
      DELETE FROM cards;
    `);

    const acc = db.prepare(`INSERT INTO accounts (name, opening_balance) VALUES ('CC', 0)`).run();
    const accountId = Number(acc.lastInsertRowid);
    const card = db
      .prepare(
        `INSERT INTO cards (name, credit_limit, closing_day, due_day) VALUES ('Nubank', 500000, 29, 5)`,
      )
      .run();
    const cardId = Number(card.lastInsertRowid);

    const inv = db
      .prepare(
        `INSERT INTO card_invoices (card_id, month, closing_date, due_date, status)
         VALUES (?, '2026-08', '2026-07-29', '2026-08-05', 'open')`,
      )
      .run(cardId);
    const invoiceId = Number(inv.lastInsertRowid);

    // Compra em julho que cai na fatura de agosto
    db.prepare(
      `INSERT INTO expenses
        (description, kind, amount, month, account_id, card_id, invoice_id, inclusion_date, due_date, status)
       VALUES ('Mercado cartão', 'single', 10000, '2026-08', NULL, ?, ?, '2026-07-15', '2026-08-05', 'pending')`,
    ).run(cardId, invoiceId);

    // Despesa de conta em julho
    db.prepare(
      `INSERT INTO expenses
        (description, kind, amount, month, account_id, card_id, inclusion_date, due_date, status)
       VALUES ('Luz', 'single', 5000, '2026-07', ?, NULL, '2026-07-10', '2026-07-20', 'pending')`,
    ).run(accountId);

    db.prepare(
      `INSERT INTO incomes (month, description, amount, account_id, received_date)
       VALUES ('2026-07', 'Salário', 50000, ?, '2026-07-05')`,
    ).run(accountId);
  });

  after(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("parse defaults", () => {
    assert.equal(parseChannel("cartoes"), "cartoes");
    assert.equal(parseBasis(null, "cartoes"), "fatura");
    assert.equal(parseBasis("compra", "cartoes"), "compra");
    assert.equal(parseBasis("fatura", "cartoes"), "fatura");
    assert.equal(parseBasis("caixa", "contas"), "caixa");
  });

  it("cartões/compra usa inclusion_date (gasto de julho na fatura de agosto)", () => {
    const rows = listExpensesForLens("2026-07", "cartoes", "compra");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.description, "Mercado cartão");

    const faturaJul = listExpensesForLens("2026-07", "cartoes", "fatura");
    assert.equal(faturaJul.length, 0);

    const faturaAgo = listExpensesForLens("2026-08", "cartoes", "fatura");
    assert.equal(faturaAgo.length, 1);
  });

  it("tudo/compra soma conta do mês + compras no cartão", () => {
    const totals = monthLedgerTotals("2026-07", "tudo", "compra");
    assert.equal(totals.spent_accounts, 5000);
    assert.equal(totals.spent_cards, 10000);
    assert.equal(totals.spent, 15000);
    assert.equal(totals.incomes, 50000);
    assert.equal(totals.balance, 35000);
  });

  it("contas ignora cartão", () => {
    const totals = monthLedgerTotals("2026-07", "contas", "compra");
    assert.equal(totals.spent, 5000);
    assert.equal(totals.spent_cards, 0);
  });
});
