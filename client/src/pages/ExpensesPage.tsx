import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, peekCache } from "../lib/api";
import { categorySelectOptions } from "../lib/categories";
import {
  categoryName,
  formatDateBr,
  isOverdue,
} from "../lib/expenseHelpers";
import {
  money,
  moneyInput,
  monthLabel,
  parseMoneyInput,
  today,
} from "../lib/format";
import { basisHint, ledgerQuery } from "../lib/ledger";
import { useDataRefresh } from "../lib/refresh";
import { useLedgerParams } from "../lib/useLedgerParams";
import type {
  Account,
  AccountTransfer,
  Card,
  Category,
  Dashboard,
  Expense,
  InvoicePayment,
  Reserve,
  ReserveMovement,
} from "../types";
import { ModalForm } from "../components/ModalForm";
import { ExpenseModal } from "../components/ExpenseModal";
import { DeleteFixedModal } from "../components/DeleteFixedModal";
import {
  MovementDetailModal,
  type MovementDetail,
} from "../components/MovementDetailModal";
import { LensBar } from "../components/LensBar";
import { useDescriptionSuggestions } from "../lib/useDescriptionSuggestions";

type Modal =
  | null
  | "expense"
  | "transfer"
  | "reserve-move"
  | { type: "pay"; expense: Expense };

type Movement =
  | { type: "expense"; day: string; expense: Expense }
  | { type: "transfer"; day: string; transfer: AccountTransfer }
  | { type: "reserve"; day: string; reserveMove: ReserveMovement }
  | { type: "invoice-pay"; day: string; payment: InvoicePayment };

/** Dia de referência na listagem. */
function expenseDayKey(e: Expense): string {
  if (e.card_id) return e.inclusion_date || e.due_date || "";
  if (e.status === "paid" && e.payment_date) return e.payment_date;
  return e.due_date ?? e.inclusion_date ?? "";
}

export function ExpensesPage() {
  const {
    month,
    channel,
    basis,
    setMonth,
    setChannel,
    setBasis,
    monthHref,
  } = useLedgerParams();
  const { suggestions: expenseDescriptions } = useDescriptionSuggestions("expense");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [transfers, setTransfers] = useState<AccountTransfer[]>([]);
  const [reserveMoves, setReserveMoves] = useState<ReserveMovement[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "paid" | "overdue" | "transfers" | "reserves"
  >("all");
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [detail, setDetail] = useState<MovementDetail | null>(null);
  /** Dias expandidos; por padrão todos começam colapsados. */
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());
  const [invoicePayments, setInvoicePayments] = useState<InvoicePayment[]>([]);
  const [faturaHintSpent, setFaturaHintSpent] = useState<number | null>(null);

  useEffect(() => {
    setExpandedDays(new Set());
  }, [month, channel, basis, statusFilter]);

  useEffect(() => {
    // filtros secundários inválidos no canal atual
    if (channel === "cartoes" && (statusFilter === "transfers" || statusFilter === "reserves")) {
      setStatusFilter("all");
    }
  }, [channel, statusFilter]);

  function toggleDay(dayKey: string) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
  }

  const load = useCallback(async () => {
    setError(null);
    const lens = ledgerQuery({ month, channel, basis });
    const cachedExps = peekCache<Expense[]>(`/expenses?${lens}`);
    if (cachedExps) setExpenses(cachedExps);
    try {
      const [exps, trs, rms, pays, accs, cds, ress, cats] = await Promise.all([
        api.get<Expense[]>(`/expenses?${lens}`),
        api.get<AccountTransfer[]>(`/account-transfers?month=${month}`),
        api.get<ReserveMovement[]>(`/reserves/movements?month=${month}`),
        api.get<InvoicePayment[]>(`/card-invoices/payments?month=${month}`),
        api.get<Account[]>("/accounts"),
        api.get<Card[]>("/cards"),
        api.get<Reserve[]>("/reserves"),
        api.get<Category[]>("/categories"),
      ]);
      setExpenses(exps);
      setTransfers(trs);
      setReserveMoves(rms);
      setInvoicePayments(pays);
      setAccounts(accs);
      setCards(cds);
      setReserves(ress);
      setCategories(cats);

      if (channel === "cartoes" && basis === "compra" && exps.length === 0) {
        const faturaDash = await api.get<Dashboard>(
          `/dashboard?${ledgerQuery({ month, channel: "cartoes", basis: "fatura" })}`,
        );
        setFaturaHintSpent(faturaDash.totals.spent ?? faturaDash.totals.expenses ?? 0);
      } else {
        setFaturaHintSpent(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar");
    }
  }, [month, channel, basis]);

  useEffect(() => {
    void load();
  }, [load]);
  useDataRefresh(load);

  const overdue = expenses.filter(isOverdue);
  const overdueTotal = overdue.reduce((s, e) => s + e.amount, 0);

  const showCashExtras = channel === "contas" || channel === "tudo";
  /** Pagamento de fatura é saída de caixa da conta. */
  const showInvoicePays = basis === "caixa" || channel === "contas";

  const movements = useMemo(() => {
    const items: Movement[] = [];

    if (showCashExtras && (statusFilter === "all" || statusFilter === "transfers")) {
      for (const t of transfers) {
        items.push({ type: "transfer", day: t.date, transfer: t });
      }
    }

    if (showCashExtras && (statusFilter === "all" || statusFilter === "reserves")) {
      for (const r of reserveMoves) {
        items.push({ type: "reserve", day: r.date, reserveMove: r });
      }
    }

    if (
      showInvoicePays &&
      statusFilter !== "transfers" &&
      statusFilter !== "reserves" &&
      statusFilter !== "pending" &&
      statusFilter !== "overdue"
    ) {
      // pagamentos de fatura: visão caixa / contas / tudo
      if (basis === "caixa" || (channel !== "cartoes" && statusFilter === "all")) {
        for (const p of invoicePayments) {
          if (statusFilter === "paid" || statusFilter === "all") {
            items.push({ type: "invoice-pay", day: p.paid_at, payment: p });
          }
        }
      }
      if (channel === "cartoes" && basis === "caixa") {
        // já coberto acima quando basis=caixa
      }
    }

    if (statusFilter !== "transfers" && statusFilter !== "reserves") {
      for (const e of expenses) {
        if (statusFilter === "overdue" && !isOverdue(e)) continue;
        if (statusFilter === "pending" && e.status !== "pending") continue;
        if (statusFilter === "paid" && e.status !== "paid") continue;
        items.push({ type: "expense", day: expenseDayKey(e), expense: e });
      }
    }

    items.sort((a, b) => {
      const emptyA = a.day ? 0 : 1;
      const emptyB = b.day ? 0 : 1;
      if (emptyA !== emptyB) return emptyA - emptyB;
      if (a.day !== b.day) return a.day.localeCompare(b.day);
      const order = {
        transfer: 0,
        reserve: 1,
        "invoice-pay": 2,
        expense: 3,
      } as const;
      if (a.type !== b.type) return order[a.type] - order[b.type];
      if (a.type === "expense" && b.type === "expense") {
        const ao = isOverdue(a.expense) ? 0 : 1;
        const bo = isOverdue(b.expense) ? 0 : 1;
        if (ao !== bo) return ao - bo;
        return a.expense.description.localeCompare(b.expense.description, "pt-BR");
      }
      return 0;
    });

    return items;
  }, [
    expenses,
    transfers,
    reserveMoves,
    invoicePayments,
    statusFilter,
    showCashExtras,
    showInvoicePays,
    basis,
    channel,
  ]);

  const groups = useMemo(() => {
    const map = new Map<string, Movement[]>();
    for (const m of movements) {
      const list = map.get(m.day) ?? [];
      list.push(m);
      map.set(m.day, list);
    }
    return [...map.entries()].map(([day, items]) => ({
      day,
      items,
      total: items.reduce((s, x) => {
        if (x.type === "expense") return s + x.expense.amount;
        if (x.type === "transfer") return s + x.transfer.amount;
        if (x.type === "invoice-pay") return s + x.payment.amount;
        return s + x.reserveMove.amount;
      }, 0),
    }));
  }, [movements]);

  async function payExpense(
    expense: Expense,
    opts: {
      reserveId?: string;
      paymentDate?: string;
      accountId?: string;
    } = {},
  ) {
    await api.post(`/expenses/${expense.id}/pay`, {
      payment_date: opts.paymentDate ?? today(),
      reserve_id: opts.reserveId ? Number(opts.reserveId) : expense.reserve_id,
      account_id: opts.accountId
        ? Number(opts.accountId)
        : expense.account_id,
    });
    await load();
  }

  const statusTabs: Array<
    "all" | "pending" | "paid" | "overdue" | "transfers" | "reserves"
  > = ["all", "pending", "overdue", "paid"];
  if (showCashExtras) statusTabs.push("transfers", "reserves");

  return (
    <div>
      <div className="section-head" style={{ marginBottom: "1rem" }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: "var(--display)", fontSize: "1.5rem" }}>
            Movimentações — {monthLabel(month)}
          </h2>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            Mesma lente do <Link to={monthHref}>Mês</Link>
            {" · "}
            faturas em <Link to="/faturas">Cartões</Link>
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{
              border: "1px solid var(--line)",
              borderRadius: 12,
              padding: "0.45rem 0.7rem",
              background: "var(--surface-solid)",
            }}
          />
          {showCashExtras && (
            <>
              <button
                className="btn quick-launch"
                onClick={() => setModal("reserve-move")}
                disabled={reserves.length === 0 || accounts.length === 0}
              >
                Reserva
              </button>
              <button
                className="btn quick-launch"
                onClick={() => setModal("transfer")}
                disabled={accounts.length < 2}
              >
                Transferir
              </button>
            </>
          )}
          <button className="btn btn-primary quick-launch" onClick={() => setModal("expense")}>
            + Gasto
          </button>
        </div>
      </div>

      <LensBar
        channel={channel}
        basis={basis}
        onChannel={setChannel}
        onBasis={setBasis}
      />
      <p className="muted lens-hint" style={{ marginTop: "-0.5rem" }}>
        {basisHint(channel, basis)}
      </p>

      {error && <div className="error">{error}</div>}

      <div className="panel">
        <div className="section-head">
          <h2>Lista</h2>
          <div className="tabs" style={{ margin: 0 }}>
            {statusTabs.map((f) => (
              <button
                key={f}
                type="button"
                className={statusFilter === f ? "active" : ""}
                onClick={() => setStatusFilter(f)}
              >
                {f === "all"
                  ? "Todas"
                  : f === "pending"
                    ? "Pendentes"
                    : f === "overdue"
                      ? `Atrasadas${overdue.length ? ` (${overdue.length})` : ""}`
                      : f === "paid"
                        ? "Pagas"
                        : f === "transfers"
                          ? `Transferências${transfers.length ? ` (${transfers.length})` : ""}`
                          : `Reservas${reserveMoves.length ? ` (${reserveMoves.length})` : ""}`}
              </button>
            ))}
          </div>
        </div>

        {overdue.length > 0 &&
          statusFilter !== "paid" &&
          statusFilter !== "transfers" &&
          statusFilter !== "reserves" && (
          <div className="alert-overdue" role="alert">
            <strong>
              {overdue.length} pagamento{overdue.length > 1 ? "s" : ""} atrasado
              {overdue.length > 1 ? "s" : ""}
            </strong>
            <span> · total {money(overdueTotal)}</span>
          </div>
        )}

        {movements.length === 0 ? (
          channel === "cartoes" &&
          basis === "compra" &&
          faturaHintSpent != null &&
          faturaHintSpent > 0 ? (
            <p className="empty">
              Nenhuma compra com data neste mês.{" "}
              A fatura deste mês tem {money(faturaHintSpent)}
              {" — "}
              <button
                type="button"
                onClick={() => setBasis("fatura")}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  color: "var(--accent)",
                  cursor: "pointer",
                  font: "inherit",
                  textDecoration: "underline",
                }}
              >
                ver Fatura do mês
              </button>
              .
            </p>
          ) : (
            <p className="empty">Nenhuma movimentação nesta lente.</p>
          )
        ) : (
          <div className="list list-compact">
            {groups.map((g) => {
              const dayKey = g.day || "sem-data";
              const collapsed = !expandedDays.has(dayKey);
              return (
              <div className={`day-group${collapsed ? " collapsed" : ""}`} key={dayKey}>
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
                  g.items.map((m) =>
                  m.type === "transfer" ? (
                    <div
                      className="row row-clickable"
                      key={`tr-${m.transfer.transfer_id}`}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        setDetail({ type: "transfer", transfer: m.transfer })
                      }
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          setDetail({ type: "transfer", transfer: m.transfer });
                        }
                      }}
                    >
                      <div className="row-main">
                        <strong>
                          {m.transfer.from_name} → {m.transfer.to_name}
                        </strong>
                        <span className="row-meta">
                          {[
                            "Transferência entre contas",
                            m.transfer.note,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                      <div className="row-side" onClick={(ev) => ev.stopPropagation()}>
                        <span className="amount">{money(m.transfer.amount)}</span>
                        <span className="badge badge-transfer">Transferência</span>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => {
                            if (
                              !confirm(
                                `Excluir transferência ${m.transfer.from_name} → ${m.transfer.to_name}?`,
                              )
                            ) {
                              return;
                            }
                            void api
                              .delete(`/account-transfers/${m.transfer.transfer_id}`)
                              .then(() => load());
                          }}
                        >
                          Excluir
                        </button>
                      </div>
                    </div>
                  ) : m.type === "reserve" ? (
                    <div
                      className="row row-clickable"
                      key={`rm-${m.reserveMove.id}`}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        setDetail({ type: "reserve", reserveMove: m.reserveMove })
                      }
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          setDetail({
                            type: "reserve",
                            reserveMove: m.reserveMove,
                          });
                        }
                      }}
                    >
                      <div className="row-main">
                        <strong>
                          {m.reserveMove.direction === "in"
                            ? `${m.reserveMove.account_name} → ${m.reserveMove.reserve_name}`
                            : `${m.reserveMove.reserve_name} → ${m.reserveMove.account_name}`}
                        </strong>
                        <span className="row-meta">
                          {[
                            m.reserveMove.direction === "in"
                              ? "Guardar na reserva"
                              : "Resgate da reserva",
                            m.reserveMove.note,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                      <div className="row-side" onClick={(ev) => ev.stopPropagation()}>
                        <span className="amount">{money(m.reserveMove.amount)}</span>
                        <span
                          className={`badge ${m.reserveMove.direction === "in" ? "badge-reserve-in" : "badge-reserve-out"}`}
                        >
                          {m.reserveMove.direction === "in" ? "Guardar" : "Resgate"}
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => {
                            if (!confirm("Excluir este movimento de reserva?")) return;
                            void api
                              .delete(`/reserves/movements/${m.reserveMove.id}`)
                              .then(() => load());
                          }}
                        >
                          Excluir
                        </button>
                      </div>
                    </div>
                  ) : m.type === "invoice-pay" ? (
                    <div
                      className="row row-clickable"
                      key={`ip-${m.payment.id}`}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        setDetail({ type: "invoice-pay", payment: m.payment })
                      }
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          setDetail({
                            type: "invoice-pay",
                            payment: m.payment,
                          });
                        }
                      }}
                    >
                      <div className="row-main">
                        <strong>
                          Pagamento fatura {m.payment.card_name}
                        </strong>
                        <span className="row-meta">
                          {[
                            `Fatura ${m.payment.invoice_month}`,
                            `debitado de ${m.payment.account_name}`,
                            m.payment.note,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                      <div className="row-side">
                        <span className="amount">{money(m.payment.amount)}</span>
                        <span className="badge badge-invoice-pay">Fatura</span>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="row row-clickable"
                      key={`ex-${m.expense.id}`}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        setDetail({ type: "expense", expense: m.expense })
                      }
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          setDetail({ type: "expense", expense: m.expense });
                        }
                      }}
                    >
                      <div className="row-main">
                        <strong>
                          {m.expense.description}
                          {m.expense.installment_number != null &&
                          m.expense.installments_total != null
                            ? ` (${m.expense.installment_number}/${m.expense.installments_total})`
                            : ""}
                        </strong>
                        <span className="row-meta">
                          {[
                            m.expense.card_id
                              ? "Cartão"
                              : m.expense.kind === "single"
                                ? "Única"
                                : m.expense.kind === "fixed_eternal"
                                  ? "Fixo"
                                  : "Parcelado",
                            categoryName(categories, m.expense.category_id),
                            m.expense.card_id
                              ? cards.find((c) => c.id === m.expense.card_id)?.name
                              : m.expense.account_id
                                ? accounts.find((a) => a.id === m.expense.account_id)
                                    ?.name
                                : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                      <div className="row-side" onClick={(ev) => ev.stopPropagation()}>
                        <span className="amount">{money(m.expense.amount)}</span>
                        {m.expense.card_id ? (
                          <span
                            className={`badge ${m.expense.status === "paid" ? "badge-paid" : "badge-card"}`}
                          >
                            {m.expense.status === "paid" ? "Fatura paga" : "No cartão"}
                          </span>
                        ) : isOverdue(m.expense) ? (
                          <span className="badge badge-overdue">Atrasado</span>
                        ) : (
                          <span
                            className={`badge ${m.expense.status === "paid" ? "badge-paid" : "badge-pending"}`}
                          >
                            {m.expense.status === "paid" ? "Pago" : "Pendente"}
                          </span>
                        )}
                        {m.expense.status === "pending" && !m.expense.card_id && (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() =>
                              setModal({ type: "pay", expense: m.expense })
                            }
                          >
                            Pagar
                          </button>
                        )}
                        {m.expense.card_id && m.expense.status === "pending" && (
                          <Link
                            className="btn btn-sm"
                            to={
                              m.expense.invoice_id
                                ? `/faturas?invoice=${m.expense.invoice_id}&card=${m.expense.card_id}`
                                : `/faturas?card=${m.expense.card_id}`
                            }
                          >
                            Fatura
                          </Link>
                        )}
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setEditing(m.expense)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => {
                            if (m.expense.rule_id) {
                              setDeleting(m.expense);
                              return;
                            }
                            if (
                              !confirm(`Excluir despesa "${m.expense.description}"?`)
                            ) {
                              return;
                            }
                            void api
                              .delete(`/expenses/${m.expense.id}`)
                              .then(() => load());
                          }}
                        >
                          Excluir
                        </button>
                      </div>
                    </div>
                  ),
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>

      {modal === "expense" && (
        <ExpenseModal
          month={month}
          accounts={accounts}
          cards={cards}
          categories={categories}
          reserves={reserves}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}

      {modal === "transfer" && (
        <ModalForm
          title="Transferir entre contas"
          submitLabel="Transferir"
          onClose={() => setModal(null)}
          fields={[
            {
              name: "from_account_id",
              label: "De",
              type: "select",
              required: true,
              options: accounts.map((a) => ({ value: String(a.id), label: a.name })),
            },
            {
              name: "to_account_id",
              label: "Para",
              type: "select",
              required: true,
              defaultValue: accounts.length > 1 ? String(accounts[1]!.id) : "",
              options: accounts.map((a) => ({ value: String(a.id), label: a.name })),
            },
            {
              name: "amount",
              label: "Valor (R$)",
              type: "money",
              required: true,
              placeholder: "Ex: 500,00",
            },
            {
              name: "date",
              label: "Data",
              type: "date",
              required: true,
              defaultValue: today(),
            },
            { name: "note", label: "Nota (opcional)", type: "textarea" },
          ]}
          onSubmit={async (v) => {
            const amount = parseMoneyInput(v.amount);
            if (amount <= 0) throw new Error("Informe um valor positivo");
            if (v.from_account_id === v.to_account_id) {
              throw new Error("Escolha contas de origem e destino diferentes");
            }
            await api.post("/account-transfers", {
              from_account_id: Number(v.from_account_id),
              to_account_id: Number(v.to_account_id),
              amount,
              date: v.date,
              note: v.note || null,
            });
            await load();
          }}
        />
      )}

      {modal === "reserve-move" && (
        <ModalForm
          title="Guardar ou resgatar reserva"
          submitLabel="Confirmar"
          onClose={() => setModal(null)}
          fields={[
            {
              name: "direction",
              label: "Movimento",
              type: "select",
              required: true,
              defaultValue: "in",
              options: [
                { value: "in", label: "Guardar (conta → reserva)" },
                { value: "out", label: "Resgatar (reserva → conta)" },
              ],
            },
            {
              name: "reserve_id",
              label: "Reserva",
              type: "select",
              required: true,
              options: reserves.map((r) => ({
                value: String(r.id),
                label: `${r.name} (${money(r.current_amount)})`,
              })),
            },
            {
              name: "account_id",
              label: "Conta corrente",
              type: "select",
              required: true,
              options: accounts.map((a) => ({ value: String(a.id), label: a.name })),
            },
            {
              name: "amount",
              label: "Valor (R$)",
              type: "money",
              required: true,
              placeholder: "Ex: 200,00",
            },
            {
              name: "date",
              label: "Data",
              type: "date",
              required: true,
              defaultValue: today(),
            },
            { name: "note", label: "Nota (opcional)", type: "textarea" },
          ]}
          onSubmit={async (v) => {
            const amount = parseMoneyInput(v.amount);
            if (amount <= 0) throw new Error("Informe um valor positivo");
            await api.post(`/reserves/${v.reserve_id}/move`, {
              direction: v.direction,
              account_id: Number(v.account_id),
              amount,
              date: v.date,
              note: v.note || null,
            });
            await load();
          }}
        />
      )}

      {typeof modal === "object" && modal?.type === "pay" && (
        <ModalForm
          key={`pay-${modal.expense.id}`}
          title={`Pagar: ${modal.expense.description}`}
          submitLabel="Confirmar pagamento"
          onClose={() => setModal(null)}
          fields={[
            {
              name: "account_id",
              label: "Pagar com a conta",
              type: "select",
              required: true,
              defaultValue: modal.expense.account_id
                ? String(modal.expense.account_id)
                : accounts[0]
                  ? String(accounts[0].id)
                  : "",
              options: accounts.map((a) => ({
                value: String(a.id),
                label: a.name,
              })),
            },
            {
              name: "payment_date",
              label: "Data do pagamento",
              type: "date",
              required: true,
              defaultValue: today(),
            },
            {
              name: "reserve_id",
              label: "Usar reserva (opcional)",
              type: "select",
              defaultValue: modal.expense.reserve_id
                ? String(modal.expense.reserve_id)
                : "",
              options: reserves.map((r) => ({ value: String(r.id), label: r.name })),
            },
          ]}
          onSubmit={async (v) => {
            if (!v.account_id) throw new Error("Selecione a conta");
            await payExpense(modal.expense, {
              reserveId: v.reserve_id || undefined,
              paymentDate: v.payment_date || today(),
              accountId: v.account_id,
            });
          }}
        />
      )}

      {editing && (
        <ModalForm
          key={`edit-${editing.id}`}
          title="Editar lançamento"
          onClose={() => setEditing(null)}
          fields={[
            {
              name: "description",
              label: "Descrição",
              required: true,
              defaultValue: editing.description,
              suggestions: expenseDescriptions,
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
            {
              name: "due_date",
              label: "Vencimento",
              type: "date",
              defaultValue: editing.due_date ?? "",
            },
            {
              name: "status",
              label: "Status",
              type: "select",
              required: true,
              defaultValue: editing.status,
              options: [
                { value: "pending", label: "Pendente" },
                { value: "paid", label: "Pago" },
              ],
            },
            {
              name: "payment_date",
              label: "Data do pagamento (se pago)",
              type: "date",
              defaultValue: editing.payment_date ?? today(),
            },
          ]}
          onSubmit={async (v) => {
            await api.patch(`/expenses/${editing.id}`, {
              description: v.description,
              amount: parseMoneyInput(v.amount),
              category_id: v.category_id ? Number(v.category_id) : null,
              due_date: v.due_date || null,
              status: v.status as "pending" | "paid",
              payment_date: v.status === "paid" ? v.payment_date || today() : null,
              ...(editing.rule_id
                ? { amount_scope: (v.amount_scope as "one" | "forward") || "one" }
                : {}),
            });
            setEditing(null);
            await load();
          }}
        />
      )}

      {deleting && (
        <DeleteFixedModal
          description={deleting.description}
          onClose={() => setDeleting(null)}
          onConfirm={async (scope) => {
            await api.delete(`/expenses/${deleting.id}?scope=${scope}`);
            setDeleting(null);
            await load();
          }}
        />
      )}

      {detail && (
        <MovementDetailModal
          detail={detail}
          accounts={accounts}
          cards={cards}
          categories={categories}
          reserves={reserves}
          onClose={() => setDetail(null)}
          onPay={(expense) => {
            setDetail(null);
            setModal({ type: "pay", expense });
          }}
          onEdit={(expense) => {
            setDetail(null);
            setEditing(expense);
          }}
          onDeleteExpense={(expense) => {
            setDetail(null);
            if (expense.rule_id) {
              setDeleting(expense);
              return;
            }
            if (!confirm(`Excluir despesa "${expense.description}"?`)) return;
            void api.delete(`/expenses/${expense.id}`).then(() => load());
          }}
          onDeleteTransfer={(transfer) => {
            if (
              !confirm(
                `Excluir transferência ${transfer.from_name} → ${transfer.to_name}?`,
              )
            ) {
              return;
            }
            setDetail(null);
            void api
              .delete(`/account-transfers/${transfer.transfer_id}`)
              .then(() => load());
          }}
          onDeleteReserveMove={(move) => {
            if (!confirm("Excluir este movimento de reserva?")) return;
            setDetail(null);
            void api.delete(`/reserves/movements/${move.id}`).then(() => load());
          }}
        />
      )}
    </div>
  );
}
