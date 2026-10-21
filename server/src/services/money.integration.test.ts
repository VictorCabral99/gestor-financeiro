import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gestor-test-"));
process.env.GESTOR_DATA_DIR = tempDir;

const { db } = await import("../db.js");
const { accountBalance } = await import("./balances.js");
const { createExpense, payExpense, deleteExpenseScoped } = await import("./expenses.js");
const { createReserveMovement } = await import("./reserveMovements.js");
const { assertMonthWritable } = await import("./monthGuard.js");
const { currentMonth } = await import("../lib/dates.js");
const { HttpError } = await import("../lib/http.js");

function seedAccount(name = "Conta teste", opening = 100_000) {
  const result = db
    .prepare(`INSERT INTO accounts (name, opening_balance) VALUES (?, ?)`)
    .run(name, opening);
  return Number(result.lastInsertRowid);
}

function seedReserve(accountId: number, name = "Reserva") {
  const result = db
    .prepare(
      `INSERT INTO reserves (name, type, target_amount, current_amount, account_id)
       VALUES (?, 'future_expense', 0, 0, ?)`,
    )
    .run(name, accountId);
  return Number(result.lastInsertRowid);
}

describe("núcleo financeiro (integração)", () => {
  before(() => {
    db.exec(`
      DELETE FROM expenses;
      DELETE FROM incomes;
      DELETE FROM account_adjustments;
      DELETE FROM reserve_movements;
      DELETE FROM reserves;
      DELETE FROM accounts;
      DELETE FROM months;
    `);
  });

  after(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("saldo = opening + receitas − despesas pagas − faturas + ajustes", () => {
    const accountId = seedAccount("Corrente", 100_000);
    const month = currentMonth();

    db.prepare(
      `INSERT INTO incomes (month, description, amount, account_id, received_date)
       VALUES (?, 'Salário', ?, ?, ?)`,
    ).run(month, 50_000, accountId, `${month}-05`);

    const expense = createExpense({
      description: "Mercado",
      amount: 12_000,
      month,
      account_id: accountId,
      status: "pending",
    });
    payExpense(expense.id);

    db.prepare(
      `INSERT INTO account_adjustments (account_id, amount, date, note)
       VALUES (?, ?, ?, ?)`,
    ).run(accountId, -3_000, `${month}-10`, "Ajuste");

    const bal = accountBalance(accountId);
    assert.equal(bal.balance, 100_000 + 50_000 - 12_000 - 3_000);
    assert.equal(bal.available, bal.balance);
  });

  it("guardar na reserva debita a conta via ajuste e aumenta a reserva", () => {
    const accountId = seedAccount("Poupança", 80_000);
    const reserveId = seedReserve(accountId);
    const month = currentMonth();

    createReserveMovement({
      reserve_id: reserveId,
      account_id: accountId,
      direction: "in",
      amount: 20_000,
      date: `${month}-12`,
      note: "Guardar",
    });

    const reserve = db
      .prepare(`SELECT current_amount FROM reserves WHERE id = ?`)
      .get(reserveId) as { current_amount: number };
    assert.equal(reserve.current_amount, 20_000);

    const bal = accountBalance(accountId);
    assert.equal(bal.balance, 60_000);
    assert.equal(bal.reserved, 20_000);
  });

  it("excluir despesa com scope one marca skip da regra", () => {
    const accountId = seedAccount("Cartão conta", 10_000);
    const month = currentMonth();
    const rule = db
      .prepare(
        `INSERT INTO expense_rules
          (description, type, amount, account_id, start_month, due_day, active, installments_total, installment_from)
         VALUES ('Netflix', 'fixed_eternal', 5000, ?, ?, 10, 1, NULL, 1)`,
      )
      .run(accountId, month);
    const ruleId = Number(rule.lastInsertRowid);

    const exp = db
      .prepare(
        `INSERT INTO expenses
          (rule_id, description, kind, amount, month, account_id, inclusion_date, due_date, status)
         VALUES (?, 'Netflix', 'fixed_eternal', 5000, ?, ?, ?, ?, 'pending')`,
      )
      .run(ruleId, month, accountId, `${month}-01`, `${month}-10`);
    const expenseId = Number(exp.lastInsertRowid);

    const result = deleteExpenseScoped(expenseId, "one");
    assert.equal(result.deleted, 1);

    const skip = db
      .prepare(`SELECT 1 AS ok FROM expense_rule_skips WHERE rule_id = ? AND month = ?`)
      .get(ruleId, month);
    assert.ok(skip);
  });

  it("bloqueia escrita em mês fechado", () => {
    db.prepare(
      `INSERT OR REPLACE INTO months (month, status, closed_at) VALUES (?, 'closed', datetime('now'))`,
    ).run("2020-01");

    assert.throws(
      () => assertMonthWritable("2020-01"),
      (err: unknown) => err instanceof HttpError && err.status === 400,
    );

    assert.doesNotThrow(() => assertMonthWritable(currentMonth()));
  });
});
