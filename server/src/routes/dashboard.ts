import { Router } from "express";
import { db } from "../db.js";
import { currentMonth } from "../lib/dates.js";
import { accountBalance, afterObligations, cardSummary } from "../services/balances.js";
import {
  listExpensesForYearLens,
  monthLedgerTotals,
  parseBasis,
  parseChannel,
  yearLedgerTotals,
  type ExpenseRow,
} from "../services/ledger.js";
import { syncMonths } from "../services/months.js";

export const dashboardRouter = Router();

dashboardRouter.get("/", (req, res) => {
  const sync = syncMonths();
  const month = (req.query.month as string | undefined) ?? sync.current_month ?? currentMonth();
  const channel = parseChannel(req.query.channel ?? req.query.canal);
  const basis = parseBasis(req.query.basis ?? req.query.base, channel);
  const totals = monthLedgerTotals(month, channel, basis);

  const accounts = (
    db.prepare(`SELECT id FROM accounts WHERE archived = 0`).all() as { id: number }[]
  ).map((a) => accountBalance(a.id));

  const cards = (
    db.prepare(`SELECT id FROM cards WHERE archived = 0`).all() as { id: number }[]
  ).map((c) => cardSummary(c.id));

  const reserves = db
    .prepare(`SELECT * FROM reserves WHERE archived = 0 ORDER BY name`)
    .all();

  const after_obligations = afterObligations(month);

  res.json({
    month,
    channel,
    basis,
    sync,
    totals: {
      incomes: totals.incomes,
      expenses: totals.spent,
      expenses_paid: totals.paid,
      expenses_pending: totals.pending,
      spent: totals.spent,
      spent_accounts: totals.spent_accounts,
      spent_cards: totals.spent_cards,
      cash_out: totals.cash_out,
      pending: totals.pending,
      paid: totals.paid,
      balance_month: totals.balance,
      balance: totals.balance,
    },
    after_obligations,
    accounts,
    cards,
    reserves,
  });
});

function buildCategoryTree(expenses: ExpenseRow[]) {
  const leafRows = new Map<
    number | null,
    {
      category_id: number | null;
      cat_name: string | null;
      cat_color: string | null;
      parent_id: number | null;
      parent_name: string | null;
      parent_color: string | null;
      total: number;
    }
  >();

  for (const e of expenses) {
    const key = e.category_id;
    const existing = leafRows.get(key);
    if (existing) {
      existing.total += e.amount;
      continue;
    }

    if (key == null) {
      leafRows.set(null, {
        category_id: null,
        cat_name: null,
        cat_color: null,
        parent_id: null,
        parent_name: null,
        parent_color: null,
        total: e.amount,
      });
      continue;
    }

    const cat = db
      .prepare(`SELECT id, name, color, parent_id FROM categories WHERE id = ?`)
      .get(key) as
      | { id: number; name: string; color: string; parent_id: number | null }
      | undefined;
    if (!cat) {
      leafRows.set(key, {
        category_id: key,
        cat_name: null,
        cat_color: null,
        parent_id: null,
        parent_name: null,
        parent_color: null,
        total: e.amount,
      });
      continue;
    }

    let parent_name: string | null = null;
    let parent_color: string | null = null;
    if (cat.parent_id != null) {
      const parent = db
        .prepare(`SELECT name, color FROM categories WHERE id = ?`)
        .get(cat.parent_id) as { name: string; color: string } | undefined;
      parent_name = parent?.name ?? null;
      parent_color = parent?.color ?? null;
    }

    leafRows.set(key, {
      category_id: cat.id,
      cat_name: cat.name,
      cat_color: cat.color,
      parent_id: cat.parent_id,
      parent_name,
      parent_color,
      total: e.amount,
    });
  }

  type Child = {
    key: string;
    name: string;
    color: string;
    total: number;
    direct?: boolean;
  };
  type Node = {
    key: string;
    name: string;
    color: string;
    total: number;
    children: Map<string, Child>;
  };
  const treeMap = new Map<string, Node>();

  for (const row of leafRows.values()) {
    if (row.category_id == null) {
      const key = "none";
      const node = treeMap.get(key) ?? {
        key,
        name: "Sem categoria",
        color: "#64748b",
        total: 0,
        children: new Map(),
      };
      node.total += row.total;
      const ck = "none";
      const child = node.children.get(ck) ?? {
        key: ck,
        name: "Sem categoria",
        color: "#64748b",
        total: 0,
      };
      child.total += row.total;
      node.children.set(ck, child);
      treeMap.set(key, node);
      continue;
    }

    if (row.parent_id != null) {
      const key = `p-${row.parent_id}`;
      const node = treeMap.get(key) ?? {
        key,
        name: row.parent_name ?? row.cat_name ?? "Categoria",
        color: row.parent_color ?? row.cat_color ?? "#64748b",
        total: 0,
        children: new Map(),
      };
      node.total += row.total;
      const ck = `c-${row.category_id}`;
      const child = node.children.get(ck) ?? {
        key: ck,
        name: row.cat_name ?? "Subcategoria",
        color: row.cat_color ?? "#64748b",
        total: 0,
      };
      child.total += row.total;
      node.children.set(ck, child);
      treeMap.set(key, node);
    } else {
      const key = `p-${row.category_id}`;
      const node = treeMap.get(key) ?? {
        key,
        name: row.cat_name ?? "Categoria",
        color: row.cat_color ?? "#64748b",
        total: 0,
        children: new Map(),
      };
      node.total += row.total;
      const ck = `direct-${row.category_id}`;
      const child = node.children.get(ck) ?? {
        key: ck,
        name: "Direto (sem subcategoria)",
        color: row.cat_color ?? "#64748b",
        total: 0,
        direct: true,
      };
      child.total += row.total;
      node.children.set(ck, child);
      treeMap.set(key, node);
    }
  }

  const byCategoryTree = [...treeMap.values()]
    .map((n) => ({
      key: n.key,
      name: n.name,
      color: n.color,
      total: n.total,
      children: [...n.children.values()].sort((a, b) => b.total - a.total),
    }))
    .sort((a, b) => b.total - a.total);

  const byCategory = byCategoryTree.map(({ name, color, total }) => ({
    name,
    color,
    total,
  }));

  return { byCategoryTree, byCategory };
}

dashboardRouter.get("/year", (req, res) => {
  const sync = syncMonths();
  const year = Number(
    (req.query.year as string | undefined) ?? sync.current_month.slice(0, 4),
  );
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    res.status(400).json({ error: "Ano inválido" });
    return;
  }

  const channel = parseChannel(req.query.channel ?? req.query.canal);
  const basis = parseBasis(req.query.basis ?? req.query.base, channel);
  const totals = yearLedgerTotals(year, channel, basis);
  const expenses = listExpensesForYearLens(year, channel, basis);

  const months: {
    month: string;
    incomes: number;
    expenses: number;
    expenses_paid: number;
    expenses_pending: number;
    balance: number;
  }[] = [];

  for (let m = 1; m <= 12; m++) {
    const month = `${year}-${String(m).padStart(2, "0")}`;
    const monthTotals = monthLedgerTotals(month, channel, basis);
    months.push({
      month,
      incomes: monthTotals.incomes,
      expenses: monthTotals.spent,
      expenses_paid: monthTotals.paid,
      expenses_pending: monthTotals.pending,
      balance: monthTotals.balance,
    });
  }

  const { byCategory, byCategoryTree } = buildCategoryTree(expenses);

  res.json({
    year,
    channel,
    basis,
    sync,
    totals: {
      incomes: totals.incomes,
      expenses: totals.spent,
      expenses_paid: totals.paid,
      expenses_pending: totals.pending,
      spent: totals.spent,
      spent_accounts: totals.spent_accounts,
      spent_cards: totals.spent_cards,
      cash_out: totals.cash_out,
      balance: totals.balance,
    },
    months,
    by_category: byCategory,
    by_category_tree: byCategoryTree,
  });
});
