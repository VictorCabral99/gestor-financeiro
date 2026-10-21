import { db } from "../db.js";
import { addMonths, currentMonth } from "../lib/dates.js";
import { badRequest, notFound } from "../lib/http.js";
import { assertDateWritable, assertMonthWritable } from "./monthGuard.js";
import {
  invoiceClosingDate,
  invoiceDueDate,
  invoiceMonthForCard,
} from "./invoiceCycle.js";

export {
  closesInPreviousMonth,
  invoiceClosingDate,
  invoiceDueDate,
  invoiceMonthForCard,
} from "./invoiceCycle.js";

type Card = {
  id: number;
  closing_day: number | null;
  due_day: number | null;
};

export function ensureInvoiceForExpense(
  cardId: number,
  inclusionDate: string,
  _expenseDueDate?: string | null,
): number {
  const card = db.prepare(`SELECT * FROM cards WHERE id = ?`).get(cardId) as Card | undefined;
  if (!card) notFound("Cartão");

  let month = invoiceMonthForCard(card, inclusionDate);

  // Se o ciclo já foi pago/fechado, avança até achar (ou criar) uma fatura aberta
  for (let i = 0; i < 24; i++) {
    const existing = db
      .prepare(`SELECT id, status FROM card_invoices WHERE card_id = ? AND month = ?`)
      .get(cardId, month) as { id: number; status: string } | undefined;

    if (!existing || existing.status === "open") {
      return ensureInvoiceForMonth(cardId, month);
    }
    month = addMonths(month, 1);
  }

  return ensureInvoiceForMonth(cardId, month);
}

/** Garante fatura do cartão no mês de referência (mês do vencimento). */
export function ensureInvoiceForMonth(cardId: number, month: string): number {
  if (!/^\d{4}-\d{2}$/.test(month)) badRequest("Mês inválido (use YYYY-MM)");

  const card = db.prepare(`SELECT * FROM cards WHERE id = ?`).get(cardId) as Card | undefined;
  if (!card) notFound("Cartão");

  const existing = db
    .prepare(`SELECT id FROM card_invoices WHERE card_id = ? AND month = ?`)
    .get(cardId, month) as { id: number } | undefined;

  if (existing) {
    refreshInvoiceDates(existing.id, card, month);
    return existing.id;
  }

  const closingDate = invoiceClosingDate(card, month);
  const dueDate = invoiceDueDate(card, month);

  const result = db
    .prepare(
      `INSERT INTO card_invoices (card_id, month, closing_date, due_date, status)
       VALUES (?, ?, ?, ?, 'open')`,
    )
    .run(cardId, month, closingDate, dueDate);

  return Number(result.lastInsertRowid);
}

/**
 * Garante fatura aberta (mesmo zerada) do mês atual até dezembro do ano
 * para cada cartão ativo — cartões sem parcelado (ex.: Unique) passam a
 * aparecer no seletor da tela de Cartões.
 */
export function ensureCardInvoicesThroughYear(year?: number) {
  const current = currentMonth();
  const y = year ?? Number(current.slice(0, 4));
  const end = `${y}-12`;
  const cards = db
    .prepare(`SELECT id FROM cards WHERE archived = 0`)
    .all() as { id: number }[];

  let created = 0;
  if (current > end) return { created, cards: cards.length };

  let month = current;
  while (month <= end) {
    for (const card of cards) {
      const existed = db
        .prepare(`SELECT id FROM card_invoices WHERE card_id = ? AND month = ?`)
        .get(card.id, month);
      ensureInvoiceForMonth(card.id, month);
      if (!existed) created += 1;
    }
    month = addMonths(month, 1);
  }
  return { created, cards: cards.length };
}

function refreshInvoiceDates(invoiceId: number, card: Card, month: string) {
  const closing = invoiceClosingDate(card, month);
  const due = invoiceDueDate(card, month);
  const current = db
    .prepare(`SELECT closing_date, due_date FROM card_invoices WHERE id = ?`)
    .get(invoiceId) as { closing_date: string | null; due_date: string | null } | undefined;

  // Evita regravação a cada GET (inchava o WAL e parecia memory leak)
  if (
    current &&
    current.closing_date === closing &&
    current.due_date === due
  ) {
    return false;
  }

  db.prepare(
    `UPDATE card_invoices SET closing_date = ?, due_date = ? WHERE id = ?`,
  ).run(closing, due, invoiceId);
  db.prepare(
    `UPDATE expenses
     SET due_date = ?
     WHERE invoice_id = ? AND (due_date IS NULL OR due_date != ?)`,
  ).run(due, invoiceId, due);
  return true;
}

/** Recalcula fechamento/vencimento de todas as faturas (após mudar dias do cartão). */
export function refreshAllInvoiceDates() {
  const rows = db
    .prepare(
      `SELECT i.id, i.month, c.closing_day, c.due_day
       FROM card_invoices i
       JOIN cards c ON c.id = i.card_id`,
    )
    .all() as {
    id: number;
    month: string;
    closing_day: number | null;
    due_day: number | null;
  }[];

  let changed = 0;
  for (const row of rows) {
    if (refreshInvoiceDates(row.id, row, row.month)) changed += 1;
  }
  return { total: rows.length, changed };
}

export function getInvoiceByCardMonth(cardId: number, month: string) {
  return (
    db
      .prepare(`SELECT * FROM card_invoices WHERE card_id = ? AND month = ?`)
      .get(cardId, month) ?? null
  );
}

export function getInvoice(id: number) {
  return db.prepare(`SELECT * FROM card_invoices WHERE id = ?`).get(id) ?? null;
}

export function listInvoicesByCard(cardId: number) {
  // Abertas: da ciclo atual em diante (ASC). Demais: mais recentes primeiro (DESC).
  return db
    .prepare(
      `SELECT i.*,
        COALESCE((SELECT SUM(amount) FROM expenses WHERE invoice_id = i.id), 0) AS total_expenses,
        COALESCE((SELECT SUM(amount) FROM card_invoice_payments WHERE invoice_id = i.id), 0) AS total_paid
       FROM card_invoices i
       WHERE i.card_id = ?
       ORDER BY
         CASE i.status WHEN 'open' THEN 0 WHEN 'closed' THEN 1 ELSE 2 END,
         CASE WHEN i.status = 'open' THEN i.month END ASC,
         CASE WHEN i.status != 'open' THEN i.month END DESC`,
    )
    .all(cardId);
}

export function listInvoiceExpenses(invoiceId: number) {
  return db
    .prepare(
      `SELECT * FROM expenses WHERE invoice_id = ? ORDER BY inclusion_date, id`,
    )
    .all(invoiceId);
}

export function listPaymentsByInvoice(invoiceId: number) {
  return db
    .prepare(
      `SELECT
         p.id, p.invoice_id, p.account_id, p.amount, p.paid_at, p.note,
         a.name AS account_name,
         c.name AS card_name,
         i.month AS invoice_month,
         i.due_date AS invoice_due_date
       FROM card_invoice_payments p
       JOIN accounts a ON a.id = p.account_id
       JOIN card_invoices i ON i.id = p.invoice_id
       JOIN cards c ON c.id = i.card_id
       WHERE p.invoice_id = ?
       ORDER BY p.paid_at, p.id`,
    )
    .all(invoiceId);
}

export function getInvoiceDetail(id: number) {
  const invoice = getInvoice(id) as
    | {
        id: number;
        card_id: number;
        month: string;
        closing_date: string | null;
        due_date: string | null;
        status: string;
      }
    | null;
  if (!invoice) return null;

  const balance = invoiceBalance(id);
  return {
    ...invoice,
    ...balance,
    expenses: listInvoiceExpenses(id),
    payments: listPaymentsByInvoice(id),
  };
}

export function closeInvoice(invoiceId: number) {
  const invoice = getInvoice(invoiceId) as
    | { id: number; status: string; card_id: number; month: string }
    | null;
  if (!invoice) notFound("Fatura");
  if (invoice.status === "paid") badRequest("Fatura já está paga");
  if (invoice.status === "closed") badRequest("Fatura já está fechada");

  db.prepare(`UPDATE card_invoices SET status = 'closed' WHERE id = ?`).run(invoiceId);
  ensureInvoiceForMonth(invoice.card_id, addMonths(invoice.month, 1));
  return getInvoiceDetail(invoiceId);
}

export function reopenInvoice(invoiceId: number) {
  const invoice = getInvoice(invoiceId) as { id: number; status: string } | null;
  if (!invoice) notFound("Fatura");
  if (invoice.status !== "closed") badRequest("Só é possível reabrir fatura fechada");

  db.prepare(`UPDATE card_invoices SET status = 'open' WHERE id = ?`).run(invoiceId);
  return getInvoiceDetail(invoiceId);
}

export function invoiceBalance(invoiceId: number) {
  const expenses = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE invoice_id = ?`)
    .get(invoiceId) as { total: number };
  const paid = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM card_invoice_payments WHERE invoice_id = ?`,
    )
    .get(invoiceId) as { total: number };
  return {
    total_expenses: expenses.total,
    total_paid: paid.total,
    remaining: expenses.total - paid.total,
  };
}

export function payInvoice(input: {
  invoiceId: number;
  accountId: number;
  amount: number;
  paidAt: string;
  note?: string | null;
}) {
  const invoice = getInvoice(input.invoiceId) as
    | { id: number; status: string; month: string }
    | null;
  if (!invoice) notFound("Fatura");

  assertMonthWritable(invoice.month);
  assertDateWritable(input.paidAt);

  const account = db.prepare(`SELECT id FROM accounts WHERE id = ?`).get(input.accountId);
  if (!account) notFound("Conta");

  const bal = invoiceBalance(input.invoiceId);
  if (input.amount > bal.remaining) {
    badRequest(`Valor excede saldo da fatura (restante: ${bal.remaining})`);
  }

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO card_invoice_payments (invoice_id, account_id, amount, paid_at, note)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(input.invoiceId, input.accountId, input.amount, input.paidAt, input.note ?? null);

    const next = invoiceBalance(input.invoiceId);
    const status = next.remaining <= 0 ? "paid" : invoice.status === "open" ? "open" : invoice.status;
    db.prepare(`UPDATE card_invoices SET status = ? WHERE id = ?`).run(status, input.invoiceId);

    // Fatura quitada: compras do cartão passam a "pagas" (conta já foi debitada no pagamento)
    if (status === "paid") {
      db.prepare(
        `UPDATE expenses
         SET status = 'paid', payment_date = COALESCE(payment_date, ?)
         WHERE invoice_id = ? AND status = 'pending'`,
      ).run(input.paidAt, input.invoiceId);
    }
  });

  tx();
  return { invoice: getInvoice(input.invoiceId), balance: invoiceBalance(input.invoiceId) };
}

export function listInvoicePayments(month?: string) {
  const params: string[] = [];
  let where = "1=1";
  if (month) {
    where += " AND p.paid_at LIKE ?";
    params.push(`${month}-%`);
  }

  return db
    .prepare(
      `SELECT
         p.id, p.invoice_id, p.account_id, p.amount, p.paid_at, p.note,
         a.name AS account_name,
         c.name AS card_name,
         i.month AS invoice_month,
         i.due_date AS invoice_due_date
       FROM card_invoice_payments p
       JOIN accounts a ON a.id = p.account_id
       JOIN card_invoices i ON i.id = p.invoice_id
       JOIN cards c ON c.id = i.card_id
       WHERE ${where}
       ORDER BY p.paid_at, p.id`,
    )
    .all(...params);
}

export function usedLimit(cardId: number): number {
  // Limite usado = despesas em faturas não totalmente pagas (remaining por fatura)
  const invoices = db
    .prepare(`SELECT id FROM card_invoices WHERE card_id = ? AND status != 'paid'`)
    .all(cardId) as { id: number }[];

  let used = 0;
  for (const inv of invoices) {
    const bal = invoiceBalance(inv.id);
    used += Math.max(0, bal.remaining);
  }
  return used;
}
