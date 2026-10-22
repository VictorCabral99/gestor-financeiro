import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { categorySelectOptions } from "../lib/categories";
import {
  compositionCaption,
  expenseDisplayDate,
  expensesByParentCategory,
  expensesInParentCategory,
  subcategoryBreakdown,
  type SubcategorySlice,
} from "../lib/expenseHelpers";
import { formatDateBr, money, share } from "../lib/format";
import type { Category, Expense } from "../types";

type Props = {
  expenses: Expense[];
  categories: Category[];
  monthLabel: string;
  onChanged: () => Promise<void> | void;
};

function expenseMatchesSub(e: Expense, sub: SubcategorySlice, cats: Category[]): boolean {
  if (sub.key === "none") return !e.category_id;
  if (sub.key.startsWith("direct-")) {
    const c = cats.find((x) => x.id === e.category_id);
    return !!c && !c.parent_id;
  }
  return e.category_id === sub.categoryId;
}

export function MonthSpendReview({
  expenses,
  categories,
  monthLabel,
  onChanged,
}: Props) {
  const [selectedParent, setSelectedParent] = useState<string | null>(null);
  const [selectedSubKey, setSelectedSubKey] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const catOptions = useMemo(
    () => categorySelectOptions(categories),
    [categories],
  );

  const byCategory = useMemo(
    () => expensesByParentCategory(expenses, categories),
    [expenses, categories],
  );
  const grandTotal = byCategory.reduce((s, x) => s + x.total, 0);

  const uncategorized = useMemo(
    () => expenses.filter((e) => e.category_id == null),
    [expenses],
  );
  const uncategorizedTotal = uncategorized.reduce((s, e) => s + e.amount, 0);

  const parentCompositions = useMemo(() => {
    const list = byCategory.map((node) => {
      const slices = subcategoryBreakdown(expenses, categories, node.name);
      return {
        ...node,
        slices,
        caption: compositionCaption(slices, node.total),
      };
    });
    // Sem categoria no topo
    return list.sort((a, b) => {
      if (a.name === "Sem categoria") return -1;
      if (b.name === "Sem categoria") return 1;
      return b.total - a.total;
    });
  }, [byCategory, expenses, categories]);

  const selectedMeta = byCategory.find((c) => c.name === selectedParent);
  const selectedSlices = useMemo(() => {
    if (!selectedParent) return [];
    return subcategoryBreakdown(expenses, categories, selectedParent);
  }, [selectedParent, expenses, categories]);

  const selectedExpenses = useMemo(() => {
    if (!selectedParent) return [];
    const all = expensesInParentCategory(expenses, categories, selectedParent);
    if (!selectedSubKey) return all;
    const sub = selectedSlices.find((s) => s.key === selectedSubKey);
    if (!sub) return all;
    return all.filter((e) => expenseMatchesSub(e, sub, categories));
  }, [selectedParent, selectedSubKey, selectedSlices, expenses, categories]);

  const selectedCaption = selectedMeta
    ? compositionCaption(selectedSlices, selectedMeta.total)
    : "";
  const selectedAllCount = useMemo(() => {
    if (!selectedParent) return 0;
    return expensesInParentCategory(expenses, categories, selectedParent).length;
  }, [selectedParent, expenses, categories]);

  const viewingUncategorized = selectedParent === "Sem categoria";

  function openParent(name: string) {
    setSelectedParent(name);
    setSelectedSubKey(null);
    setError(null);
  }

  async function categorize(expenseId: number, categoryId: number) {
    setSavingId(expenseId);
    setError(null);
    try {
      await api.patch(`/expenses/${expenseId}`, { category_id: categoryId });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao categorizar");
    } finally {
      setSavingId(null);
    }
  }

  if (expenses.length === 0) {
    return <p className="empty">Nenhuma despesa nesta lente.</p>;
  }

  if (selectedParent && selectedMeta) {
    return (
      <div className="spend-review">
        <div className="spend-drill">
          <button
            type="button"
            className="btn btn-sm btn-ghost spend-back"
            onClick={() => {
              setSelectedParent(null);
              setSelectedSubKey(null);
              setError(null);
            }}
          >
            ← Por categoria
          </button>
          <div className="spend-drill-head">
            <span
              className="cat-dot"
              style={{ background: selectedMeta.color }}
              aria-hidden
            />
            <div>
              <strong>{selectedMeta.name}</strong>
              <p className="muted" style={{ margin: "0.15rem 0 0", fontSize: "0.85rem" }}>
                {money(selectedMeta.total)}
                {grandTotal > 0
                  ? ` · ${share(Math.round((selectedMeta.total / grandTotal) * 100))} do mês`
                  : ""}
                {" · "}
                {selectedAllCount} lançamento{selectedAllCount === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          {viewingUncategorized && (
            <p className="spend-story">
              Escolha a categoria de cada lançamento para dar sentido aos gastos.
            </p>
          )}

          {selectedCaption && !viewingUncategorized && (
            <p className="spend-story">
              Desse total: <strong>{selectedCaption}</strong>
            </p>
          )}

          {error && <div className="error">{error}</div>}

          {!viewingUncategorized &&
          (selectedSlices.length > 1 ||
            (selectedSlices.length === 1 &&
              selectedSlices[0]!.name !== "Sem subcategoria")) ? (
            <div className="spend-subs">
              <button
                type="button"
                className={`spend-sub-chip${selectedSubKey == null ? " active" : ""}`}
                onClick={() => setSelectedSubKey(null)}
              >
                Tudo · {money(selectedMeta.total)}
              </button>
              {selectedSlices.map((s) => {
                const pct =
                  selectedMeta.total > 0
                    ? Math.round((s.total / selectedMeta.total) * 100)
                    : 0;
                return (
                  <button
                    type="button"
                    key={s.key}
                    className={`spend-sub-chip${selectedSubKey === s.key ? " active" : ""}`}
                    onClick={() =>
                      setSelectedSubKey((cur) => (cur === s.key ? null : s.key))
                    }
                  >
                    <span
                      className="cat-dot cat-dot-sm"
                      style={{ background: s.color }}
                      aria-hidden
                    />
                    {s.name} · {share(pct)} · {s.count}x
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="list list-compact" style={{ marginTop: "0.85rem" }}>
            {selectedExpenses.length === 0 ? (
              <p className="empty">Nenhum lançamento aqui.</p>
            ) : (
              selectedExpenses.map((e) => {
                const day = expenseDisplayDate(e);
                const leaf = categories.find((c) => c.id === e.category_id);
                const subLabel = leaf?.parent_id != null ? leaf.name : null;
                const needsCategory = e.category_id == null;
                return (
                  <div className="row spend-expense-row" key={e.id}>
                    <div className="row-main">
                      <strong>{e.description}</strong>
                      <span className="row-meta">
                        {day ? formatDateBr(day) : "Sem data"}
                        {subLabel ? ` · ${subLabel}` : ""}
                        {e.installment_number && e.installments_total
                          ? ` · ${e.installment_number}/${e.installments_total}`
                          : ""}
                      </span>
                      {needsCategory && (
                        <label className="spend-cat-assign">
                          <span className="muted">Categorizar</span>
                          <select
                            value=""
                            disabled={savingId === e.id}
                            onChange={(ev) => {
                              const id = Number(ev.target.value);
                              if (!id) return;
                              void categorize(e.id, id);
                            }}
                          >
                            <option value="">
                              {savingId === e.id ? "Salvando…" : "Escolher…"}
                            </option>
                            {catOptions.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                    <div className="row-side">
                      <span className="amount">{money(e.amount)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="spend-review">
      <div className="spend-caneta">
        <p className="spend-caneta-lead">
          Em <strong>{monthLabel}</strong> você gastou{" "}
          <strong className="spend-caneta-total">{money(grandTotal)}</strong> em{" "}
          {expenses.length} lançamento{expenses.length === 1 ? "" : "s"}.
        </p>

        {uncategorized.length > 0 && (
          <button
            type="button"
            className="spend-uncat-banner"
            onClick={() => openParent("Sem categoria")}
          >
            <strong>
              {uncategorized.length} sem categoria
            </strong>
            <span className="muted">
              {money(uncategorizedTotal)} — toque para categorizar
            </span>
          </button>
        )}

        {error && <div className="error">{error}</div>}

        <div className="spend-stories">
          {parentCompositions.map((node) => {
            const pct =
              grandTotal > 0 ? Math.round((node.total / grandTotal) * 100) : 0;
            const top = node.slices[0];
            let story = node.caption;
            if (!story && top) {
              story = `${top.count} lançamento${top.count === 1 ? "" : "s"}`;
            }
            const isUncat = node.name === "Sem categoria";
            return (
              <button
                type="button"
                key={node.name}
                className={`spend-story-card${isUncat ? " spend-story-card-uncat" : ""}`}
                onClick={() => openParent(node.name)}
              >
                <div className="spend-story-card-top">
                  <span className="spend-story-card-title">
                    <span
                      className="cat-dot"
                      style={{ background: node.color }}
                      aria-hidden
                    />
                    <strong>{node.name}</strong>
                    <span className="muted">{share(pct)}</span>
                  </span>
                  <span className="amount">{money(node.total)}</span>
                </div>
                {isUncat ? (
                  <p className="spend-story-card-body">
                    Toque para escolher a categoria de cada gasto
                  </p>
                ) : story ? (
                  <p className="spend-story-card-body">{story}</p>
                ) : (
                  <p className="spend-story-card-body muted">
                    Sem subcategorias — toque para ver os lançamentos
                  </p>
                )}
                {!isUncat && node.slices.length > 1 && (
                  <div className="spend-mini-bars" aria-hidden>
                    {node.slices.map((s) => (
                      <div
                        key={s.key}
                        className="spend-mini-seg"
                        title={`${s.name}: ${money(s.total)}`}
                        style={{
                          flexGrow: Math.max(s.total, 1),
                          background: s.color,
                        }}
                      />
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
