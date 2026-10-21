import { db } from "../db.js";
import { today } from "../lib/dates.js";
import { badRequest, notFound } from "../lib/http.js";
import { ensureInvoiceForExpense, getInvoice } from "./invoices.js";
import { assertDateWritable, assertMonthWritable } from "./monthGuard.js";

type ExpenseRow = {
  id: number;
  description: string;
  kind: string;
  amount: number;
  status: "pending" | "paid";
  reserve_id: number | null;
  card_id: number | null;
  account_id: number | null;
  category_id: number | null;
  inclusion_date: string;
  due_date: string | null;
  payment_date: string | null;
  invoice_id: number | null;
  rule_id: number | null;
  month: string;
};

function getReserve(id: number) {
  return db.prepare(`SELECT * FROM reserves WHERE id = ?`).get(id) as
    | { id: number; current_amount: number; archived: number }
    | undefined;
}

export function applyReserveDelta(reserveId: number, delta: number) {
  const reserve = getReserve(reserveId);
  if (!reserve || reserve.archived) notFound("Reserva");
  const next = reserve.current_amount + delta;
  if (next < 0) badRequest("Saldo insuficiente na reserva");
  db.prepare(`UPDATE reserves SET current_amount = ? WHERE id = ?`).run(next, reserveId);
}

function getExpense(id: number): ExpenseRow {
  const expense = db.prepare(`SELECT * FROM expenses WHERE id = ?`).get(id) as ExpenseRow | undefined;
  if (!expense) notFound("Despesa");
  return expense;
}

/** Fatura explícita (tela de Cartões) ou ciclo automático pela data da compra. */
function resolveCardInvoiceId(
  cardId: number,
  inclusionDate: string,
  explicitInvoiceId?: number | null,
): number {
  if (explicitInvoiceId != null) {
    const inv = getInvoice(explicitInvoiceId) as
      | { id: number; card_id: number; month: string }
      | null;
    if (!inv) notFound("Fatura");
    if (inv.card_id !== cardId) badRequest("Fatura não pertence ao cartão");
    return inv.id;
  }
  return ensureInvoiceForExpense(cardId, inclusionDate);
}

export function payExpense(
  expenseId: number,
  opts: {
    payment_date?: string;
    reserve_id?: number | null;
    account_id?: number | null;
  } = {},
) {
  const expense = getExpense(expenseId);
  if (expense.status === "paid") badRequest("Despesa já está paga");
  assertMonthWritable(expense.month);

  const paymentDate = opts.payment_date ?? today();
  assertDateWritable(paymentDate);
  const reserveId = opts.reserve_id !== undefined ? opts.reserve_id : expense.reserve_id;
  const accountId =
    opts.account_id !== undefined ? opts.account_id : expense.account_id;

  if (accountId != null) {
    const account = db
      .prepare(`SELECT id FROM accounts WHERE id = ? AND archived = 0`)
      .get(accountId);
    if (!account) notFound("Conta");
  }

  const tx = db.transaction(() => {
    if (reserveId) applyReserveDelta(reserveId, -expense.amount);
    db.prepare(
      `UPDATE expenses SET status = 'paid', payment_date = ?, reserve_id = ?, account_id = ?
       WHERE id = ?`,
    ).run(paymentDate, reserveId, accountId, expenseId);
  });

  tx();
  return getExpense(expenseId);
}

export function unpayExpense(expenseId: number) {
  const expense = getExpense(expenseId);
  if (expense.status !== "paid") badRequest("Despesa não está paga");
  assertMonthWritable(expense.month);

  const tx = db.transaction(() => {
    if (expense.reserve_id) applyReserveDelta(expense.reserve_id, expense.amount);
    db.prepare(
      `UPDATE expenses SET status = 'pending', payment_date = NULL WHERE id = ?`,
    ).run(expenseId);
  });

  tx();
  return getExpense(expenseId);
}

export function createExpense(input: {
  description: string;
  amount: number;
  month: string;
  category_id?: number | null;
  account_id?: number | null;
  card_id?: number | null;
  reserve_id?: number | null;
  inclusion_date?: string;
  due_date?: string | null;
  payment_date?: string | null;
  status?: "pending" | "paid";
  invoice_id?: number | null;
}) {
  const inclusionDate = input.inclusion_date ?? today();
  const status = input.status ?? (input.payment_date ? "paid" : "pending");
  let invoiceId: number | null = null;
  let month = input.month;

  if (input.card_id) {
    invoiceId = resolveCardInvoiceId(input.card_id, inclusionDate, input.invoice_id);
    const inv = getInvoice(invoiceId) as { month: string; due_date: string | null } | null;
    if (inv) month = inv.month;
  }

  assertMonthWritable(month);

  // Cartão: conta só entra no pagamento da fatura; vencimento = vencimento da fatura
  const accountId = input.card_id ? null : (input.account_id ?? null);
  const dueDate = input.card_id
    ? ((getInvoice(invoiceId!) as { due_date: string | null } | null)?.due_date ?? null)
    : (input.due_date ?? null);

  const tx = db.transaction(() => {
    if (status === "paid" && input.reserve_id) {
      applyReserveDelta(input.reserve_id, -input.amount);
    }

    const result = db
      .prepare(
        `INSERT INTO expenses (
          description, kind, amount, month,
          category_id, account_id, card_id, reserve_id, invoice_id,
          inclusion_date, due_date, payment_date, status
        ) VALUES (?, 'single', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.description,
        input.amount,
        month,
        input.category_id ?? null,
        accountId,
        input.card_id ?? null,
        input.reserve_id ?? null,
        invoiceId,
        inclusionDate,
        dueDate,
        status === "paid" ? (input.payment_date ?? inclusionDate) : null,
        status,
      );

    return Number(result.lastInsertRowid);
  });

  return getExpense(tx());
}

export function updateExpense(
  id: number,
  patch: Partial<{
    description: string;
    amount: number;
    category_id: number | null;
    account_id: number | null;
    card_id: number | null;
    reserve_id: number | null;
    inclusion_date: string;
    due_date: string | null;
    payment_date: string | null;
    status: "pending" | "paid";
    amount_scope: "one" | "forward";
    invoice_id: number | null;
  }>,
) {
  const current = getExpense(id);
  assertMonthWritable(current.month);

  const nextAmount = patch.amount ?? current.amount;
  const nextStatus = patch.status ?? current.status;
  const nextReserve = patch.reserve_id !== undefined ? patch.reserve_id : current.reserve_id;
  const nextCard = patch.card_id !== undefined ? patch.card_id : current.card_id;
  const inclusionDate = patch.inclusion_date ?? current.inclusion_date;
  const inclusionDateChanged =
    patch.inclusion_date !== undefined &&
    patch.inclusion_date !== current.inclusion_date;
  const categoryId = patch.category_id !== undefined ? patch.category_id : current.category_id;
  const accountId = patch.account_id !== undefined ? patch.account_id : current.account_id;
  const description = patch.description ?? current.description;
  const amountScope = patch.amount_scope ?? "one";
  const amountChanged = patch.amount !== undefined && patch.amount !== current.amount;

  const tx = db.transaction(() => {
    if (current.status === "paid" && current.reserve_id) {
      applyReserveDelta(current.reserve_id, current.amount);
    }

    let invoiceId = current.invoice_id;
    let month = current.month;
    if (!nextCard) {
      invoiceId = null;
    } else if (patch.invoice_id !== undefined && patch.invoice_id != null) {
      invoiceId = resolveCardInvoiceId(nextCard, inclusionDate, patch.invoice_id);
    } else if (patch.invoice_id === null) {
      invoiceId = ensureInvoiceForExpense(nextCard, inclusionDate);
    } else if (nextCard !== current.card_id || current.invoice_id == null) {
      // Cartão novo ou sem fatura: calcula pelo ciclo. Data da compra sozinha não troca fatura.
      invoiceId = ensureInvoiceForExpense(nextCard, inclusionDate);
    }

    if (invoiceId != null) {
      const inv = getInvoice(invoiceId) as { month: string } | null;
      if (inv) month = inv.month;
    }
    if (month !== current.month) assertMonthWritable(month);

    // Cartão: vencimento sempre = vencimento da fatura. Conta: usa o patch ou mantém.
    const dueDate = nextCard
      ? ((invoiceId != null
          ? (getInvoice(invoiceId) as { due_date: string | null } | null)?.due_date
          : null) ?? null)
      : patch.due_date !== undefined
        ? patch.due_date
        : current.due_date;

    if (nextStatus === "paid" && nextReserve) {
      applyReserveDelta(nextReserve, -nextAmount);
    }

    const paymentDate =
      nextStatus === "paid"
        ? (patch.payment_date ?? current.payment_date ?? today())
        : null;

    db.prepare(
      `UPDATE expenses SET
        description = ?, amount = ?, month = ?, category_id = ?, account_id = ?,
        card_id = ?, reserve_id = ?, invoice_id = ?,
        inclusion_date = ?, due_date = ?, payment_date = ?, status = ?
       WHERE id = ?`,
    ).run(
      description,
      nextAmount,
      month,
      categoryId,
      accountId,
      nextCard,
      nextReserve,
      invoiceId,
      inclusionDate,
      dueDate,
      paymentDate,
      nextStatus,
      id,
    );

    // Parcelado: data da compra é a mesma em todas as parcelas (não mexe fatura/mês).
    if (
      inclusionDateChanged &&
      current.rule_id &&
      current.kind === "fixed_installment"
    ) {
      db.prepare(
        `UPDATE expenses SET inclusion_date = ? WHERE rule_id = ? AND id != ?`,
      ).run(inclusionDate, current.rule_id, id);
      db.prepare(`UPDATE expense_rules SET purchase_date = ? WHERE id = ?`).run(
        inclusionDate,
        current.rule_id,
      );
    }

    // Valor desta + futuras parcelas da mesma regra
    if (
      amountChanged &&
      amountScope === "forward" &&
      current.rule_id
    ) {
      const futures = db
        .prepare(
          `SELECT id, amount, status, reserve_id FROM expenses
           WHERE rule_id = ? AND month > ?`,
        )
        .all(current.rule_id, current.month) as {
        id: number;
        amount: number;
        status: "pending" | "paid";
        reserve_id: number | null;
      }[];

      for (const row of futures) {
        if (row.status === "paid" && row.reserve_id) {
          // Estorna valor antigo e aplica o novo na reserva
          applyReserveDelta(row.reserve_id, row.amount - nextAmount);
        }
        db.prepare(`UPDATE expenses SET amount = ? WHERE id = ?`).run(nextAmount, row.id);
      }

      // Próximas gerações usam o novo valor padrão
      db.prepare(`UPDATE expense_rules SET amount = ? WHERE id = ?`).run(
        nextAmount,
        current.rule_id,
      );
    }
  });

  tx();
  return getExpense(id);
}

export function deleteExpense(id: number) {
  const expense = getExpense(id);
  assertMonthWritable(expense.month);
  const tx = db.transaction(() => {
    if (expense.status === "paid" && expense.reserve_id) {
      applyReserveDelta(expense.reserve_id, expense.amount);
    }
    db.prepare(`DELETE FROM expenses WHERE id = ?`).run(id);
  });
  tx();
}

export type DeleteScope = "one" | "forward" | "all";

type ExpenseFull = ExpenseRow & {
  rule_id: number | null;
  month: string;
  kind: string;
};

/**
 * one — só este lançamento (e marca skip na regra para não regenerar)
 * forward — este e todos os meses seguintes da mesma regra; desativa a regra
 * all — todos os lançamentos da regra (passados e futuros); desativa a regra
 */
export function deleteExpenseScoped(id: number, scope: DeleteScope = "one") {
  const expense = db.prepare(`SELECT * FROM expenses WHERE id = ?`).get(id) as
    | ExpenseFull
    | undefined;
  if (!expense) notFound("Despesa");

  // Gasto único: sempre só este
  if (!expense.rule_id || scope === "one") {
    assertMonthWritable(expense.month);
    const tx = db.transaction(() => {
      if (expense.status === "paid" && expense.reserve_id) {
        applyReserveDelta(expense.reserve_id, expense.amount);
      }
      db.prepare(`DELETE FROM expenses WHERE id = ?`).run(id);
      if (expense.rule_id) {
        db.prepare(
          `INSERT OR IGNORE INTO expense_rule_skips (rule_id, month) VALUES (?, ?)`,
        ).run(expense.rule_id, expense.month);
      }
    });
    tx();
    return { deleted: 1, scope: "one" as const };
  }

  const tx = db.transaction(() => {
    let rows: ExpenseFull[];

    if (scope === "forward") {
      rows = db
        .prepare(
          `SELECT * FROM expenses WHERE rule_id = ? AND month >= ? ORDER BY month`,
        )
        .all(expense.rule_id, expense.month) as ExpenseFull[];
    } else {
      rows = db
        .prepare(`SELECT * FROM expenses WHERE rule_id = ? ORDER BY month`)
        .all(expense.rule_id) as ExpenseFull[];
    }

    for (const row of rows) assertMonthWritable(row.month);

    for (const row of rows) {
      if (row.status === "paid" && row.reserve_id) {
        applyReserveDelta(row.reserve_id, row.amount);
      }
      db.prepare(`DELETE FROM expenses WHERE id = ?`).run(row.id);
    }

    // Impede regeneração
    db.prepare(`UPDATE expense_rules SET active = 0 WHERE id = ?`).run(expense.rule_id);

    if (scope === "all") {
      db.prepare(`DELETE FROM expense_rule_skips WHERE rule_id = ?`).run(expense.rule_id);
    }

    return rows.length;
  });

  const deleted = tx();
  return { deleted, scope };
}
