import type { Category, Expense } from "../types";
import { today } from "./format";

export function categoryName(cats: Category[], id: number | null) {
  if (!id) return null;
  const c = cats.find((x) => x.id === id);
  if (!c) return null;
  if (!c.parent_id) return c.name;
  const parent = cats.find((x) => x.id === c.parent_id);
  return parent ? `${parent.name} · ${c.name}` : c.name;
}

/** Agrupa no pai (subcategoria soma na categoria raiz). */
export function parentCategory(
  cats: Category[],
  id: number | null,
): { name: string; color: string } {
  if (!id) return { name: "Sem categoria", color: "#64748b" };
  const c = cats.find((x) => x.id === id);
  if (!c) return { name: "Sem categoria", color: "#64748b" };
  if (!c.parent_id) return { name: c.name, color: c.color };
  const parent = cats.find((x) => x.id === c.parent_id);
  return parent
    ? { name: parent.name, color: parent.color }
    : { name: c.name, color: c.color };
}

export function expensesByParentCategory(expenses: Expense[], cats: Category[]) {
  const map = new Map<string, { name: string; color: string; total: number }>();
  for (const e of expenses) {
    const p = parentCategory(cats, e.category_id);
    const cur = map.get(p.name) ?? { name: p.name, color: p.color, total: 0 };
    cur.total += e.amount;
    map.set(p.name, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export type CategoryChildSlice = {
  key: string;
  name: string;
  color: string;
  total: number;
  /** Lançamento direto na categoria pai (sem subcategoria). */
  direct?: boolean;
};

export type CategoryTreeNode = {
  key: string;
  name: string;
  color: string;
  total: number;
  children: CategoryChildSlice[];
};

/**
 * Árvore pai → subcategorias.
 * Gasto na categoria pai (sem sub) aparece como filho "Direto".
 */
export function expensesByCategoryTree(
  expenses: Expense[],
  cats: Category[],
): CategoryTreeNode[] {
  type Acc = {
    key: string;
    name: string;
    color: string;
    total: number;
    children: Map<string, CategoryChildSlice>;
  };
  const map = new Map<string, Acc>();

  function ensureParent(key: string, name: string, color: string): Acc {
    const cur = map.get(key);
    if (cur) return cur;
    const created: Acc = { key, name, color, total: 0, children: new Map() };
    map.set(key, created);
    return created;
  }

  for (const e of expenses) {
    if (!e.category_id) {
      const p = ensureParent("none", "Sem categoria", "#64748b");
      p.total += e.amount;
      const child = p.children.get("none") ?? {
        key: "none",
        name: "Sem categoria",
        color: "#64748b",
        total: 0,
      };
      child.total += e.amount;
      p.children.set("none", child);
      continue;
    }

    const c = cats.find((x) => x.id === e.category_id);
    if (!c) {
      const p = ensureParent("none", "Sem categoria", "#64748b");
      p.total += e.amount;
      continue;
    }

    if (c.parent_id) {
      const parent = cats.find((x) => x.id === c.parent_id);
      const pKey = parent ? `p-${parent.id}` : `c-${c.id}`;
      const pName = parent?.name ?? c.name;
      const pColor = parent?.color ?? c.color;
      const p = ensureParent(pKey, pName, pColor);
      p.total += e.amount;
      const childKey = `c-${c.id}`;
      const child = p.children.get(childKey) ?? {
        key: childKey,
        name: c.name,
        color: c.color,
        total: 0,
      };
      child.total += e.amount;
      p.children.set(childKey, child);
    } else {
      const p = ensureParent(`p-${c.id}`, c.name, c.color);
      p.total += e.amount;
      const childKey = `direct-${c.id}`;
      const child = p.children.get(childKey) ?? {
        key: childKey,
        name: "Direto (sem subcategoria)",
        color: c.color,
        total: 0,
        direct: true,
      };
      child.total += e.amount;
      p.children.set(childKey, child);
    }
  }

  return [...map.values()]
    .map((p) => ({
      key: p.key,
      name: p.name,
      color: p.color,
      total: p.total,
      children: [...p.children.values()].sort((a, b) => b.total - a.total),
    }))
    .sort((a, b) => b.total - a.total);
}

export function isOverdue(e: Expense): boolean {
  // Cartão: a cobrança é no pagamento da fatura, não no vencimento da compra
  if (e.card_id) return false;
  return e.status === "pending" && !!e.due_date && e.due_date < today();
}

/** Despesas cuja categoria raiz (pai) tem este nome. */
export function expensesInParentCategory(
  expenses: Expense[],
  cats: Category[],
  parentName: string,
): Expense[] {
  return expenses
    .filter((e) => parentCategory(cats, e.category_id).name === parentName)
    .sort((a, b) => b.amount - a.amount || a.description.localeCompare(b.description));
}

/** Data de referência para exibir um gasto na revisão do mês. */
export function expenseDisplayDate(e: Expense): string {
  if (e.card_id) return e.inclusion_date || e.due_date || "";
  return e.payment_date || e.due_date || e.inclusion_date || "";
}

export type SubcategorySlice = {
  key: string;
  name: string;
  color: string;
  total: number;
  count: number;
  /** Id da subcategoria; null = direto no pai / sem categoria. */
  categoryId: number | null;
};

/** Quebra um pai em subcategorias (com contagem de lançamentos). */
export function subcategoryBreakdown(
  expenses: Expense[],
  cats: Category[],
  parentName: string,
): SubcategorySlice[] {
  const map = new Map<string, SubcategorySlice>();

  for (const e of expensesInParentCategory(expenses, cats, parentName)) {
    let key: string;
    let name: string;
    let color: string;
    let categoryId: number | null;

    if (!e.category_id) {
      key = "none";
      name = "Sem subcategoria";
      color = "#64748b";
      categoryId = null;
    } else {
      const c = cats.find((x) => x.id === e.category_id);
      if (!c) {
        key = "none";
        name = "Sem subcategoria";
        color = "#64748b";
        categoryId = null;
      } else if (c.parent_id) {
        key = `c-${c.id}`;
        name = c.name;
        color = c.color;
        categoryId = c.id;
      } else {
        key = `direct-${c.id}`;
        name = "Sem subcategoria";
        color = c.color;
        categoryId = c.id;
      }
    }

    const cur = map.get(key) ?? {
      key,
      name,
      color,
      total: 0,
      count: 0,
      categoryId,
    };
    cur.total += e.amount;
    cur.count += 1;
    map.set(key, cur);
  }

  return [...map.values()].sort((a, b) => b.total - a.total);
}

/**
 * Frase curta sobre a composição (ex.: "55% almoço (12x) · 21% lanches · 21% snacks").
 */
export function compositionCaption(
  slices: SubcategorySlice[],
  parentTotal: number,
  maxParts = 4,
): string {
  if (parentTotal <= 0 || slices.length === 0) return "";
  if (slices.length === 1 && slices[0]!.name === "Sem subcategoria") return "";

  return slices
    .slice(0, maxParts)
    .map((s) => {
      const pct = Math.round((s.total / parentTotal) * 100);
      const times = s.count > 1 ? ` (${s.count}x)` : "";
      return `${pct}% ${s.name.toLowerCase()}${times}`;
    })
    .join(" · ");
}

export { formatDateBr } from "./format";
