import { db } from "../db.js";
import { parseMonth, type MonthKey } from "../lib/dates.js";
import { notFound } from "../lib/http.js";
import { invoiceBalance, usedLimit } from "./invoices.js";

export function accountBalance(accountId: number) {
  const account = db
    .prepare(`SELECT * FROM accounts WHERE id = ?`)
    .get(accountId) as { id: number; opening_balance: number; name: string } | undefined;
  if (!account) notFound("Conta");

  const incomes = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM incomes WHERE account_id = ?`,
    )
    .get(accountId) as { total: number };

  // Despesas pagas na conta (não cartão e sem reserva): debitam a conta.
  // Se usou reserva, o valor já saiu da conta ao guardar na reserva.
  const expenses = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM expenses
       WHERE account_id = ? AND card_id IS NULL AND status = 'paid'
         AND reserve_id IS NULL`,
    )
    .get(accountId) as { total: number };

  const invoicePayments = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM card_invoice_payments WHERE account_id = ?`,
    )
    .get(accountId) as { total: number };

  const adjustments = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM account_adjustments WHERE account_id = ?`,
    )
    .get(accountId) as { total: number };

  const reserved = db
    .prepare(
      `SELECT COALESCE(SUM(current_amount), 0) AS total
       FROM reserves WHERE account_id = ? AND archived = 0`,
    )
    .get(accountId) as { total: number };

  const balance =
    account.opening_balance +
    incomes.total -
    expenses.total -
    invoicePayments.total +
    adjustments.total;

  // Dinheiro nas reservas já saiu da conta via movimentos (ajustes).
  // "available" = o que ainda está livre na conta.
  return {
    account_id: accountId,
    name: account.name,
    opening_balance: account.opening_balance,
    incomes: incomes.total,
    expenses_paid: expenses.total,
    invoice_payments: invoicePayments.total,
    adjustments: adjustments.total,
    balance,
    reserved: reserved.total,
    available: balance,
  };
}

export function cardSummary(cardId: number) {
  const card = db.prepare(`SELECT * FROM cards WHERE id = ?`).get(cardId) as
    | {
        id: number;
        name: string;
        credit_limit: number;
      }
    | undefined;
  if (!card) notFound("Cartão");

  const used = usedLimit(cardId);
  return {
    card_id: cardId,
    name: card.name,
    credit_limit: card.credit_limit,
    used,
    available: card.credit_limit - used,
  };
}

/** Saldo atual das contas − pendentes de conta até EOM − faturas do mês ainda em aberto. */
export function afterObligations(month: MonthKey) {
  const cash = (
    db.prepare(`SELECT id FROM accounts WHERE archived = 0`).all() as { id: number }[]
  ).reduce((sum, a) => sum + accountBalance(a.id).balance, 0);

  const endOfMonth = parseMonth(month).endOf("month").format("YYYY-MM-DD");

  const pendingRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM expenses
       WHERE card_id IS NULL
         AND status = 'pending'
         AND reserve_id IS NULL
         AND (
           (due_date IS NOT NULL AND due_date <= ?)
           OR (due_date IS NULL AND month <= ?)
         )`,
    )
    .get(endOfMonth, month) as { total: number };
  const pending_accounts = pendingRow.total;

  const invoices = db
    .prepare(`SELECT id FROM card_invoices WHERE month = ?`)
    .all(month) as { id: number }[];
  let unpaid_invoices = 0;
  for (const inv of invoices) {
    const remaining = invoiceBalance(inv.id).remaining;
    if (remaining > 0) unpaid_invoices += remaining;
  }

  return {
    cash,
    pending_accounts,
    unpaid_invoices,
    available: cash - pending_accounts - unpaid_invoices,
  };
}
