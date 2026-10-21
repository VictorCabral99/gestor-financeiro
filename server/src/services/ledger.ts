import { db } from "../db.js";
import { isValidMonth } from "../lib/dates.js";
import { badRequest } from "../lib/http.js";

export type Channel = "contas" | "cartoes" | "tudo";
export type Basis = "compra" | "caixa" | "fatura";

export type ExpenseRow = {
  id: number;
  amount: number;
  status: "pending" | "paid";
  card_id: number | null;
  month: string;
  inclusion_date: string;
  payment_date: string | null;
  category_id: number | null;
  [key: string]: unknown;
};

export function parseChannel(value: unknown): Channel {
  if (value === "contas" || value === "cartoes" || value === "tudo") return value;
  return "tudo";
}

/** Defaults inteligentes por canal. */
export function parseBasis(value: unknown, channel: Channel): Basis {
  if (channel === "contas") {
    return value === "caixa" ? "caixa" : "compra";
  }
  if (channel === "cartoes") {
    if (value === "compra" || value === "caixa") return value;
    return "fatura";
  }
  if (value === "caixa" || value === "fatura") return value;
  return "compra";
}

function assertMonth(month: string) {
  if (!isValidMonth(month)) badRequest("Mês inválido (use YYYY-MM)");
}

function monthPrefix(month: string) {
  return `${month}-%`;
}

function sumAmount(rows: { amount: number }[]) {
  return rows.reduce((s, r) => s + r.amount, 0);
}

/** Lista despesas na lente período × canal × base. */
export function listExpensesForLens(
  month: string,
  channel: Channel,
  basis: Basis,
): ExpenseRow[] {
  assertMonth(month);
  const prefix = monthPrefix(month);

  if (channel === "contas") {
    if (basis === "caixa") {
      return db
        .prepare(
          `SELECT * FROM expenses
           WHERE card_id IS NULL AND status = 'paid' AND payment_date LIKE ?
           ORDER BY payment_date, id`,
        )
        .all(prefix) as ExpenseRow[];
    }
    return db
      .prepare(
        `SELECT * FROM expenses
         WHERE card_id IS NULL AND month = ?
         ORDER BY due_date, id`,
      )
      .all(month) as ExpenseRow[];
  }

  if (channel === "cartoes") {
    if (basis === "caixa") return [];
    if (basis === "fatura") {
      return db
        .prepare(
          `SELECT * FROM expenses
           WHERE card_id IS NOT NULL AND month = ?
           ORDER BY inclusion_date, id`,
        )
        .all(month) as ExpenseRow[];
    }
    return db
      .prepare(
        `SELECT * FROM expenses
         WHERE card_id IS NOT NULL AND inclusion_date LIKE ?
         ORDER BY inclusion_date, id`,
      )
      .all(prefix) as ExpenseRow[];
  }

  // tudo
  if (basis === "caixa") {
    return db
      .prepare(
        `SELECT * FROM expenses
         WHERE card_id IS NULL AND status = 'paid' AND payment_date LIKE ?
         ORDER BY payment_date, id`,
      )
      .all(prefix) as ExpenseRow[];
  }
  if (basis === "fatura") {
    return db
      .prepare(`SELECT * FROM expenses WHERE month = ? ORDER BY due_date, id`)
      .all(month) as ExpenseRow[];
  }
  // compra: conta pelo month + cartão pela data da compra
  return db
    .prepare(
      `SELECT * FROM expenses
       WHERE (card_id IS NULL AND month = ?)
          OR (card_id IS NOT NULL AND inclusion_date LIKE ?)
       ORDER BY inclusion_date, id`,
    )
    .all(month, prefix) as ExpenseRow[];
}

export function listExpensesForYearLens(
  year: number,
  channel: Channel,
  basis: Basis,
): ExpenseRow[] {
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    badRequest("Ano inválido");
  }
  const prefix = `${year}-%`;

  if (channel === "contas") {
    if (basis === "caixa") {
      return db
        .prepare(
          `SELECT * FROM expenses
           WHERE card_id IS NULL AND status = 'paid' AND payment_date LIKE ?
           ORDER BY payment_date, id`,
        )
        .all(prefix) as ExpenseRow[];
    }
    return db
      .prepare(
        `SELECT * FROM expenses
         WHERE card_id IS NULL AND month LIKE ?
         ORDER BY month, id`,
      )
      .all(prefix) as ExpenseRow[];
  }

  if (channel === "cartoes") {
    if (basis === "caixa") return [];
    if (basis === "fatura") {
      return db
        .prepare(
          `SELECT * FROM expenses
           WHERE card_id IS NOT NULL AND month LIKE ?
           ORDER BY month, id`,
        )
        .all(prefix) as ExpenseRow[];
    }
    return db
      .prepare(
        `SELECT * FROM expenses
         WHERE card_id IS NOT NULL AND inclusion_date LIKE ?
         ORDER BY inclusion_date, id`,
      )
      .all(prefix) as ExpenseRow[];
  }

  if (basis === "caixa") {
    return db
      .prepare(
        `SELECT * FROM expenses
         WHERE card_id IS NULL AND status = 'paid' AND payment_date LIKE ?
         ORDER BY payment_date, id`,
      )
      .all(prefix) as ExpenseRow[];
  }
  if (basis === "fatura") {
    return db
      .prepare(`SELECT * FROM expenses WHERE month LIKE ? ORDER BY month, id`)
      .all(prefix) as ExpenseRow[];
  }
  return db
    .prepare(
      `SELECT * FROM expenses
       WHERE (card_id IS NULL AND month LIKE ?)
          OR (card_id IS NOT NULL AND inclusion_date LIKE ?)
       ORDER BY inclusion_date, id`,
    )
    .all(prefix, prefix) as ExpenseRow[];
}

function invoicePaymentsTotal(monthOrPrefix: string, mode: "month" | "prefix") {
  if (mode === "month") {
    return (
      db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) AS total
           FROM card_invoice_payments WHERE paid_at LIKE ?`,
        )
        .get(`${monthOrPrefix}-%`) as { total: number }
    ).total;
  }
  return (
    db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM card_invoice_payments WHERE paid_at LIKE ?`,
      )
      .get(monthOrPrefix) as { total: number }
  ).total;
}

function incomesTotal(month: string) {
  return (
    db
      .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM incomes WHERE month = ?`)
      .get(month) as { total: number }
  ).total;
}

function incomesYearTotal(year: number) {
  return (
    db
      .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM incomes WHERE month LIKE ?`)
      .get(`${year}-%`) as { total: number }
  ).total;
}

export type LedgerTotals = {
  incomes: number;
  spent: number;
  spent_accounts: number;
  spent_cards: number;
  cash_out: number;
  pending: number;
  paid: number;
  balance: number;
};

function totalsFromExpenses(
  expenses: ExpenseRow[],
  opts: { incomes: number; cashOut: number; useCashAsSpent: boolean },
): LedgerTotals {
  const accountRows = expenses.filter((e) => !e.card_id);
  const cardRows = expenses.filter((e) => !!e.card_id);
  const spent_accounts = sumAmount(accountRows);
  const spent_cards = sumAmount(cardRows);
  const spentLens = spent_accounts + spent_cards;
  const pending = sumAmount(expenses.filter((e) => e.status === "pending"));
  const paid = sumAmount(expenses.filter((e) => e.status === "paid"));
  const spent = opts.useCashAsSpent ? opts.cashOut : spentLens;
  return {
    incomes: opts.incomes,
    spent,
    spent_accounts,
    spent_cards,
    cash_out: opts.cashOut,
    pending,
    paid,
    balance: opts.incomes - spent,
  };
}

export function monthLedgerTotals(
  month: string,
  channel: Channel,
  basis: Basis,
): LedgerTotals {
  assertMonth(month);
  const expenses = listExpensesForLens(month, channel, basis);
  const cashOut =
    sumAmount(
      listExpensesForLens(month, "contas", "caixa"),
    ) + invoicePaymentsTotal(month, "month");

  const incomes =
    channel === "cartoes" ? 0 : incomesTotal(month);

  const useCashAsSpent = basis === "caixa";
  const base = totalsFromExpenses(expenses, {
    incomes,
    cashOut: channel === "cartoes" && basis === "caixa" ? invoicePaymentsTotal(month, "month") : cashOut,
    useCashAsSpent,
  });

  if (channel === "cartoes" && basis === "caixa") {
    const inv = invoicePaymentsTotal(month, "month");
    return {
      incomes: 0,
      spent: inv,
      spent_accounts: 0,
      spent_cards: 0,
      cash_out: inv,
      pending: 0,
      paid: inv,
      balance: -inv,
    };
  }

  if (channel === "contas") {
    return {
      ...base,
      spent_cards: 0,
      cash_out: cashOut,
    };
  }

  return base;
}

export function yearLedgerTotals(
  year: number,
  channel: Channel,
  basis: Basis,
): LedgerTotals {
  const expenses = listExpensesForYearLens(year, channel, basis);
  const prefix = `${year}-%`;
  const cashAccount = sumAmount(listExpensesForYearLens(year, "contas", "caixa"));
  const inv = invoicePaymentsTotal(prefix, "prefix");
  const cashOut = cashAccount + inv;
  const incomes = channel === "cartoes" ? 0 : incomesYearTotal(year);

  if (channel === "cartoes" && basis === "caixa") {
    return {
      incomes: 0,
      spent: inv,
      spent_accounts: 0,
      spent_cards: 0,
      cash_out: inv,
      pending: 0,
      paid: inv,
      balance: -inv,
    };
  }

  return totalsFromExpenses(expenses, {
    incomes,
    cashOut,
    useCashAsSpent: basis === "caixa",
  });
}

/** Mês de agrupamento na visão anual, conforme a base. */
export function expensePeriodKey(e: ExpenseRow, basis: Basis): string {
  if (basis === "caixa") {
    return (e.payment_date ?? e.inclusion_date).slice(0, 7);
  }
  if (basis === "compra" && e.card_id) {
    return e.inclusion_date.slice(0, 7);
  }
  return e.month;
}
