import { db } from "../db.js";
import {
  addMonths,
  clampDayInMonth,
  currentMonth,
  monthsBetween,
  today,
  type MonthKey,
} from "../lib/dates.js";
import { ensureCardInvoicesThroughYear, ensureInvoiceForMonth } from "./invoices.js";

export type ExpenseRule = {
  id: number;
  description: string;
  type: "fixed_eternal" | "fixed_installment";
  amount: number;
  category_id: number | null;
  account_id: number | null;
  card_id: number | null;
  reserve_id: number | null;
  start_month: string;
  installments_total: number | null;
  installment_from: number;
  due_day: number;
  purchase_date: string | null;
  active: number;
};

/** Data da compra compartilhada entre parcelas (nunca o dia 1 do mês da fatura). */
function purchaseDateForRule(rule: ExpenseRule): string {
  if (rule.purchase_date) return rule.purchase_date;
  if (rule.type === "fixed_installment") {
    // Prefere data já corrigida (não sintética month-01); a mais antiga costuma ser a compra.
    const sibling = db
      .prepare(
        `SELECT inclusion_date FROM expenses
         WHERE rule_id = ?
           AND inclusion_date != (month || '-01')
         ORDER BY inclusion_date ASC, id ASC
         LIMIT 1`,
      )
      .get(rule.id) as { inclusion_date: string } | undefined;
    if (sibling?.inclusion_date) return sibling.inclusion_date;
    const any = db
      .prepare(
        `SELECT inclusion_date FROM expenses WHERE rule_id = ? ORDER BY id ASC LIMIT 1`,
      )
      .get(rule.id) as { inclusion_date: string } | undefined;
    if (any?.inclusion_date) return any.inclusion_date;
  }
  return today();
}

function closeOpenMonthsBefore(current: MonthKey) {
  db.prepare(
    `UPDATE months
     SET status = 'closed', closed_at = COALESCE(closed_at, datetime('now'))
     WHERE status = 'open' AND month < ?`,
  ).run(current);
}

function ensureMonthRow(month: MonthKey) {
  const current = currentMonth();
  const status = month < current ? "closed" : "open";
  const existing = db.prepare(`SELECT month FROM months WHERE month = ?`).get(month);
  if (!existing) {
    db.prepare(
      `INSERT INTO months (month, status, closed_at) VALUES (?, ?, ?)`,
    ).run(month, status, status === "closed" ? new Date().toISOString() : null);
    return;
  }
  if (month === current) {
    db.prepare(
      `UPDATE months SET status = 'open', closed_at = NULL WHERE month = ? AND status = 'closed'`,
    ).run(month);
  }
}

function installmentNumberFor(rule: ExpenseRule, month: MonthKey): number | null {
  if (rule.type !== "fixed_installment") return null;
  const from = rule.installment_from ?? 1;
  return monthsBetween(rule.start_month, month) + from;
}

function ruleAppliesToMonth(rule: ExpenseRule, month: MonthKey): boolean {
  if (!rule.active) return false;
  if (month < rule.start_month) return false;
  if (rule.type === "fixed_eternal") return true;
  const n = installmentNumberFor(rule, month);
  const from = rule.installment_from ?? 1;
  if (n == null || rule.installments_total == null) return false;
  return n >= from && n <= rule.installments_total;
}

function isSkipped(ruleId: number, month: MonthKey): boolean {
  return !!db
    .prepare(`SELECT 1 FROM expense_rule_skips WHERE rule_id = ? AND month = ?`)
    .get(ruleId, month);
}

function insertExpenseForRule(rule: ExpenseRule, month: MonthKey) {
  if (!ruleAppliesToMonth(rule, month)) return false;
  if (isSkipped(rule.id, month)) return false;

  const exists = db
    .prepare(`SELECT id FROM expenses WHERE rule_id = ? AND month = ?`)
    .get(rule.id, month);
  if (exists) return false;

  ensureMonthRow(month);

  const installmentNumber = installmentNumberFor(rule, month);
  const inclusionDate =
    rule.type === "fixed_installment"
      ? purchaseDateForRule(rule)
      : month > currentMonth()
        ? clampDayInMonth(month, 1)
        : today();

  let invoiceId: number | null = null;
  let dueDate = clampDayInMonth(month, rule.due_day);
  if (rule.card_id) {
    // Parcela do mês X entra na fatura do mês X; vencimento = da fatura
    invoiceId = ensureInvoiceForMonth(rule.card_id, month);
    const inv = db
      .prepare(`SELECT due_date FROM card_invoices WHERE id = ?`)
      .get(invoiceId) as { due_date: string | null } | undefined;
    if (inv?.due_date) dueDate = inv.due_date;
  }

  db.prepare(
    `INSERT INTO expenses (
      rule_id, description, kind, amount, month,
      category_id, account_id, card_id, reserve_id, invoice_id,
      inclusion_date, due_date, status,
      installment_number, installments_total
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(
    rule.id,
    rule.description,
    rule.type,
    rule.amount,
    month,
    rule.category_id,
    rule.account_id,
    rule.card_id,
    rule.reserve_id,
    invoiceId,
    inclusionDate,
    dueDate,
    installmentNumber,
    rule.installments_total,
  );

  return true;
}

/** Gera lançamentos da regra de start_month (ou jan do ano) até dezembro do ano. */
export function generateRuleThroughYear(rule: ExpenseRule, year: number) {
  const yearStart = `${year}-01` as MonthKey;
  const yearEnd = `${year}-12` as MonthKey;
  let month: MonthKey = rule.start_month > yearStart ? rule.start_month : yearStart;

  let created = 0;
  while (month <= yearEnd) {
    if (insertExpenseForRule(rule, month)) created += 1;
    month = addMonths(month, 1);
  }
  return created;
}

/** Gera horizonte do ano corrente para todas as regras ativas. */
export function generateAllRulesThroughCurrentYear() {
  const year = Number(currentMonth().slice(0, 4));
  const rules = db
    .prepare(`SELECT * FROM expense_rules WHERE active = 1`)
    .all() as ExpenseRule[];

  let created = 0;
  for (const rule of rules) {
    created += generateRuleThroughYear(rule, year);
  }
  return { year, created, rules: rules.length };
}

/** Fecha meses anteriores, abre o mês atual e gera fixos até o fim do ano. */
export function syncMonths() {
  const current = currentMonth();
  const year = Number(current.slice(0, 4));

  const tx = db.transaction(() => {
    closeOpenMonthsBefore(current);
    ensureMonthRow(current);
    // Virada de ano / cadastro: preenche o ano corrente até dezembro
    generateAllRulesThroughCurrentYear();
    ensureCardInvoicesThroughYear();
  });

  tx();

  return {
    current_month: current,
    closed_before: current,
    year,
    generated_for: (
      db
        .prepare(`SELECT month FROM months WHERE status = 'open' ORDER BY month`)
        .all() as { month: string }[]
    ).map((r) => r.month),
  };
}

export function listMonths() {
  return db.prepare(`SELECT * FROM months ORDER BY month DESC`).all();
}

export function getMonth(month: MonthKey) {
  return db.prepare(`SELECT * FROM months WHERE month = ?`).get(month) ?? null;
}

export function peekNextMonth(month: MonthKey): MonthKey {
  return addMonths(month, 1);
}
