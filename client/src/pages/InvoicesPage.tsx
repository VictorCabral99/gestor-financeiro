import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DeleteFixedModal } from "../components/DeleteFixedModal";
import { ExpenseModal } from "../components/ExpenseModal";
import { ModalForm } from "../components/ModalForm";
import { categorySelectOptions } from "../lib/categories";
import { useDataRefresh } from "../lib/refresh";
import { categoryName } from "../lib/expenseHelpers";
import { api, peekCache } from "../lib/api";
import {
  addMonths,
  currentMonth,
  formatDateBr,
  money,
  moneyInput,
  monthLabel,
  parseMoneyInput,
  today,
} from "../lib/format";
import type {
  Account,
  Card,
  CardInvoice,
  Category,
  Expense,
  InvoiceDetail,
  Reserve,
} from "../types";

function statusLabel(status: string) {
  if (status === "paid") return "Paga";
  if (status === "closed") return "Fechada";
  return "Aberta";
}

function statusBadgeClass(status: string) {
  if (status === "paid") return "badge-paid";
  if (status === "closed") return "badge-invoice-pay";
  return "badge-card";
}

/** Fatura atual: aberta mais próxima (ciclo vigente), senão fechada, senão a primeira. */
function preferredInvoiceMonth(rows: CardInvoice[], fallback: string) {
  const opens = rows
    .filter((r) => r.status === "open")
    .slice()
    .sort((a, b) => a.month.localeCompare(b.month));
  if (opens.length) {
    const current = fallback;
    return (
      opens.find((r) => r.month >= current)?.month ??
      opens[opens.length - 1]!.month
    );
  }
  const closed = rows
    .filter((r) => r.status === "closed")
    .slice()
    .sort((a, b) => a.month.localeCompare(b.month));
  if (closed.length) {
    return closed.find((r) => r.month >= fallback)?.month ?? closed[0]!.month;
  }
  return rows[0]?.month ?? fallback;
}

export function InvoicesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [cards, setCards] = useState<Card[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [invoices, setInvoices] = useState<CardInvoice[]>([]);
  const [selectedCard, setSelectedCard] = useState<number | null>(() => {
    const c = searchParams.get("card");
    return c && /^\d+$/.test(c) ? Number(c) : null;
  });
  const [month, setMonth] = useState("");
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [creatingExpense, setCreatingExpense] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [busy, setBusy] = useState(false);
  /** Dias expandidos; por padrão todos começam colapsados. */
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setExpandedDays(new Set());
  }, [detail?.id]);

  function toggleDay(dayKey: string) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
  }

  const purchaseGroups = useMemo(() => {
    if (!detail) return [];
    const sorted = [...detail.expenses].sort((a, b) => {
      const da = a.inclusion_date || "";
      const db = b.inclusion_date || "";
      const emptyA = da ? 0 : 1;
      const emptyB = db ? 0 : 1;
      if (emptyA !== emptyB) return emptyA - emptyB;
      if (da !== db) return da.localeCompare(db);
      return a.description.localeCompare(b.description, "pt-BR");
    });
    const map = new Map<string, Expense[]>();
    for (const e of sorted) {
      const day = e.inclusion_date || "";
      const list = map.get(day) ?? [];
      list.push(e);
      map.set(day, list);
    }
    return [...map.entries()].map(([day, items]) => ({
      day,
      items,
      total: items.reduce((s, x) => s + x.amount, 0),
    }));
  }, [detail]);

  const loadMeta = useCallback(async () => {
    const cachedCards = peekCache<Card[]>("/cards");
    if (cachedCards) setCards(cachedCards);
    const [cds, accs, cats, ress] = await Promise.all([
      api.get<Card[]>("/cards"),
      api.get<Account[]>("/accounts"),
      api.get<Category[]>("/categories"),
      api.get<Reserve[]>("/reserves"),
    ]);
    setCards(cds);
    setAccounts(accs);
    setCategories(cats);
    setReserves(ress);
    setSelectedCard((prev) => {
      if (prev != null && cds.some((c) => c.id === prev)) return prev;
      return cds[0]?.id ?? null;
    });
  }, []);

  const loadInvoicesList = useCallback(async (cardId: number) => {
    const rows = await api.get<CardInvoice[]>(`/cards/${cardId}/invoices`);
    setInvoices(rows);
    return rows;
  }, []);

  // Abre na fatura aberta mais atual (ou a do ?invoice= se vier de um atalho)
  const invoiceParam = searchParams.get("invoice");
  useEffect(() => {
    if (!selectedCard || month) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await loadInvoicesList(selectedCard);
        if (cancelled) return;
        if (invoiceParam && /^\d+$/.test(invoiceParam)) {
          const byId = rows.find((r) => r.id === Number(invoiceParam));
          if (byId) {
            setMonth(byId.month);
            return;
          }
        }
        setMonth(preferredInvoiceMonth(rows, currentMonth()));
      } catch {
        if (!cancelled) setMonth(currentMonth());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCard, month, loadInvoicesList, invoiceParam]);

  const loadDetail = useCallback(async () => {
    if (!selectedCard || !month) {
      setDetail(null);
      return;
    }
    setError(null);
    try {
      const row = await api.get<InvoiceDetail>(
        `/cards/${selectedCard}/invoices/${month}`,
      );
      setDetail(row);
      await loadInvoicesList(selectedCard);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar fatura");
      setDetail(null);
    }
  }, [selectedCard, month, loadInvoicesList]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);
  useDataRefresh(() => {
    void loadMeta();
    void loadDetail();
  });

  // Sincroniza URL só quando o estado da tela muda (evita loop com searchParams)
  useEffect(() => {
    const next = new URLSearchParams();
    if (selectedCard != null) next.set("card", String(selectedCard));
    if (month) next.set("month", month);
    if (detail?.id != null) next.set("invoice", String(detail.id));
    const nxt = next.toString();
    if (searchParams.toString() !== nxt) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchParams só para comparar
  }, [selectedCard, month, detail?.id, setSearchParams]);

  const remaining = detail?.remaining ?? 0;
  const selectedCardName = useMemo(
    () => cards.find((c) => c.id === selectedCard)?.name ?? "Cartão",
    [cards, selectedCard],
  );

  async function refresh(preferMonth?: string) {
    const m = preferMonth ?? month;
    if (!selectedCard) return;
    const row = await api.get<InvoiceDetail>(`/cards/${selectedCard}/invoices/${m}`);
    setDetail(row);
    setMonth(row.month);
    await loadInvoicesList(selectedCard);
  }

  async function handleClose() {
    if (!detail) return;
    if (!confirm(`Fechar a fatura de ${monthLabel(detail.month)}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/card-invoices/${detail.id}/close`, {});
      await refresh(addMonths(detail.month, 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao fechar fatura");
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen() {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/card-invoices/${detail.id}/reopen`, {});
      await refresh(detail.month);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao reabrir fatura");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="section-head" style={{ marginBottom: "1rem" }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: "var(--display)", fontSize: "1.5rem" }}>
            Cartões
          </h2>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            Operação por fatura — para ver compras do mês calendário, use{" "}
            <Link to="/despesas?canal=cartoes&base=compra">Movimentações · Cartões</Link>
            {" "}ou o{" "}
            <Link to="/?canal=cartoes&base=compra">Mês · Cartões</Link>
          </p>
        </div>
        <div className="invoice-filters">
          <label className="field-inline">
            <span>Cartão</span>
            <select
              value={selectedCard ?? ""}
              onChange={(e) => {
                setSelectedCard(e.target.value ? Number(e.target.value) : null);
                setDetail(null);
                setMonth("");
              }}
            >
              {cards.length === 0 && <option value="">Sem cartões</option>}
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-inline">
            <span>Fatura</span>
            <select
              value={month}
              onChange={(e) => {
                if (e.target.value) setMonth(e.target.value);
              }}
              disabled={invoices.length === 0 && !month}
            >
              {invoices.length === 0 && month && (
                <option value={month}>{monthLabel(month)}</option>
              )}
              {invoices.map((inv) => {
                const rem = (inv.total_expenses ?? 0) - (inv.total_paid ?? 0);
                return (
                  <option key={inv.id} value={inv.month}>
                    {monthLabel(inv.month)} · {statusLabel(inv.status)}
                    {rem > 0 ? ` · ${money(rem)}` : ""}
                  </option>
                );
              })}
            </select>
          </label>
          {selectedCard != null && detail && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setCreatingExpense(true)}
            >
              Nova compra
            </button>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {!selectedCard ? (
        <div className="panel">
          <p className="empty">Cadastre um cartão em Cadastros para começar.</p>
        </div>
      ) : !detail ? (
        <div className="panel">
          <p className="empty">Carregando fatura…</p>
        </div>
      ) : (
        <>
          <div className="panel invoice-summary">
            <div className="invoice-summary-top">
              <div>
                <strong style={{ fontFamily: "var(--display)", fontSize: "1.15rem" }}>
                  {selectedCardName} — {monthLabel(detail.month)}
                </strong>
                <div className="row-meta" style={{ marginTop: "0.35rem" }}>
                  {[
                    detail.closing_date
                      ? `fecha ${formatDateBr(detail.closing_date)}`
                      : null,
                    detail.due_date ? `vence ${formatDateBr(detail.due_date)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <span className={`badge ${statusBadgeClass(detail.status)}`}>
                {statusLabel(detail.status)}
              </span>
            </div>

            <div className="invoice-totals">
              <div>
                <span className="muted">Total</span>
                <strong className="amount">{money(detail.total_expenses)}</strong>
              </div>
              <div>
                <span className="muted">Pago</span>
                <strong className="amount">{money(detail.total_paid)}</strong>
              </div>
              <div>
                <span className="muted">Restante</span>
                <strong className="amount">{money(remaining)}</strong>
              </div>
            </div>

            <div className="invoice-actions">
              {detail.status === "open" && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void handleClose()}
                >
                  Fechar fatura
                </button>
              )}
              {detail.status === "closed" && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void handleReopen()}
                >
                  Reabrir
                </button>
              )}
              {remaining > 0 && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => setPaying(true)}
                >
                  Pagar fatura
                </button>
              )}
            </div>
          </div>

          <div className="panel" style={{ marginTop: "1rem" }}>
            <div className="section-head">
              <h2>Compras na fatura</h2>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <span className="muted">{detail.expenses.length} item(ns)</span>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => setCreatingExpense(true)}
                >
                  Nova compra
                </button>
              </div>
            </div>
            {detail.expenses.length === 0 ? (
              <p className="empty">Nenhuma compra nesta fatura.</p>
            ) : (
              <div className="list list-compact">
                {purchaseGroups.map((g) => {
                  const dayKey = g.day || "sem-data";
                  const collapsed = !expandedDays.has(dayKey);
                  return (
                    <div
                      className={`day-group${collapsed ? " collapsed" : ""}`}
                      key={dayKey}
                    >
                      <button
                        type="button"
                        className="day-group-label"
                        aria-expanded={!collapsed}
                        onClick={() => toggleDay(dayKey)}
                      >
                        <span className="day-group-title">
                          <span className="day-group-chevron" aria-hidden>
                            {collapsed ? "▸" : "▾"}
                          </span>
                          {g.day ? formatDateBr(g.day) : "Sem data"}
                          <span className="day-group-count">
                            {g.items.length} lanç.
                          </span>
                        </span>
                        <span>{money(g.total)}</span>
                      </button>
                      {!collapsed &&
                        g.items.map((e) => (
                          <div className="row" key={e.id}>
                            <div className="row-main">
                              <strong>
                                {e.description}
                                {e.installment_number != null &&
                                e.installments_total != null
                                  ? ` (${e.installment_number}/${e.installments_total})`
                                  : ""}
                              </strong>
                              <span className="row-meta">
                                {[
                                  (e.due_date || detail.due_date)
                                    ? `vence ${formatDateBr(e.due_date || detail.due_date)}`
                                    : null,
                                  categoryName(categories, e.category_id),
                                  e.kind === "fixed_installment"
                                    ? "Parcelado"
                                    : e.kind === "fixed_eternal"
                                      ? "Fixo"
                                      : "Única",
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </div>
                            <div className="row-side">
                              <span className="amount">{money(e.amount)}</span>
                              <span
                                className={`badge ${e.status === "paid" ? "badge-paid" : "badge-card"}`}
                              >
                                {e.status === "paid" ? "Paga" : "No cartão"}
                              </span>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => setEditing(e)}
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-danger"
                                onClick={() => {
                                  if (e.rule_id) {
                                    setDeleting(e);
                                    return;
                                  }
                                  if (
                                    !confirm(`Excluir compra "${e.description}"?`)
                                  ) {
                                    return;
                                  }
                                  void api
                                    .delete(`/expenses/${e.id}`)
                                    .then(() => refresh(month));
                                }}
                              >
                                Excluir
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="panel" style={{ marginTop: "1rem" }}>
            <div className="section-head">
              <h2>Pagamentos</h2>
              <span className="muted">{detail.payments.length} registro(s)</span>
            </div>
            {detail.payments.length === 0 ? (
              <p className="empty">Nenhum pagamento registrado.</p>
            ) : (
              <div className="list list-compact">
                {detail.payments.map((p) => (
                  <div className="row" key={p.id}>
                    <div className="row-main">
                      <strong>Pagamento fatura</strong>
                      <span className="row-meta">
                        {[formatDateBr(p.paid_at), p.account_name, p.note || null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    <div className="row-side">
                      <span className="amount">{money(p.amount)}</span>
                      <span className="badge badge-invoice-pay">Debitado</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {paying && detail && (
        <ModalForm
          title={`Pagar fatura ${monthLabel(detail.month)}`}
          submitLabel="Registrar pagamento"
          onClose={() => setPaying(false)}
          fields={[
            {
              name: "account_id",
              label: "Debitar da conta",
              type: "select",
              required: true,
              options: accounts.map((a) => ({ value: String(a.id), label: a.name })),
            },
            {
              name: "amount",
              label: "Valor (R$)",
              type: "money",
              required: true,
              defaultValue: moneyInput(Math.max(0, remaining)),
            },
            {
              name: "paid_at",
              label: "Data",
              type: "date",
              defaultValue: today(),
            },
            { name: "note", label: "Nota", type: "textarea" },
          ]}
          onSubmit={async (v) => {
            await api.post(`/card-invoices/${detail.id}/pay`, {
              account_id: Number(v.account_id),
              amount: parseMoneyInput(v.amount),
              paid_at: v.paid_at || today(),
              note: v.note || null,
            });
            setPaying(false);
            await refresh(detail.month);
          }}
        />
      )}

      {creatingExpense && selectedCard != null && detail && (
        <ExpenseModal
          month={month}
          accounts={accounts}
          cards={cards}
          categories={categories}
          reserves={reserves}
          defaultPayWith="card"
          defaultCardId={selectedCard}
          lockPayWith
          invoiceId={detail.id}
          invoiceDueDate={detail.due_date}
          onClose={() => setCreatingExpense(false)}
          onSaved={async () => {
            await refresh(detail.month);
          }}
        />
      )}

      {editing && (
        <ModalForm
          key={`edit-card-${editing.id}`}
          title="Editar compra"
          onClose={() => setEditing(null)}
          fields={[
            {
              name: "description",
              label: "Descrição",
              required: true,
              defaultValue: editing.description,
            },
            {
              name: "amount",
              label: "Valor (R$)",
              type: "money",
              required: true,
              defaultValue: moneyInput(editing.amount),
            },
            {
              name: "category_id",
              label: "Categoria",
              type: "select",
              defaultValue: editing.category_id ? String(editing.category_id) : "",
              options: categorySelectOptions(categories),
            },
            {
              name: "inclusion_date",
              label: "Data da compra",
              type: "date",
              required: true,
              defaultValue: editing.inclusion_date || today(),
            },
            ...(editing.rule_id
              ? [
                  {
                    name: "amount_scope",
                    label: "Aplicar novo valor em",
                    type: "select" as const,
                    required: true,
                    defaultValue: "one",
                    options: [
                      { value: "one", label: "Só esta parcela" },
                      { value: "forward", label: "Esta e as futuras" },
                    ],
                  },
                ]
              : []),
          ]}
          onSubmit={async (v) => {
            await api.patch(`/expenses/${editing.id}`, {
              description: v.description,
              amount: parseMoneyInput(v.amount),
              category_id: v.category_id ? Number(v.category_id) : null,
              inclusion_date: v.inclusion_date || editing.inclusion_date,
              // Mantém na fatura atual ao editar pela tela de Cartões
              invoice_id: detail?.id ?? editing.invoice_id,
              ...(editing.rule_id
                ? { amount_scope: (v.amount_scope as "one" | "forward") || "one" }
                : {}),
            });
            setEditing(null);
            await refresh(month);
          }}
        >
          {editing.rule_id && editing.kind === "fixed_installment" && (
            <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.85rem" }}>
              A data da compra é a mesma em todas as parcelas desta compra — ao
              salvar, as demais parcelas são atualizadas (a fatura de cada uma
              não muda).
            </p>
          )}
          {(detail?.due_date || editing.due_date) && (
            <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.9rem" }}>
              Vencimento:{" "}
              <strong>
                {formatDateBr(detail?.due_date || editing.due_date)}
              </strong>{" "}
              (mesmo da fatura)
            </p>
          )}
        </ModalForm>
      )}

      {deleting && (
        <DeleteFixedModal
          description={deleting.description}
          onClose={() => setDeleting(null)}
          onConfirm={async (scope) => {
            await api.delete(`/expenses/${deleting.id}?scope=${scope}`);
            setDeleting(null);
            await refresh(month);
          }}
        />
      )}
    </div>
  );
}
