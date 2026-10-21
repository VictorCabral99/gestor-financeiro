import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, peekCache } from "../lib/api";
import { isOverdue } from "../lib/expenseHelpers";
import { money, moneyInput, monthLabel, parseMoneyInput, today } from "../lib/format";
import { ledgerQuery } from "../lib/ledger";
import { useLedgerParams } from "../lib/useLedgerParams";
import { useDescriptionSuggestions } from "../lib/useDescriptionSuggestions";
import type {
  Account,
  Card,
  Category,
  Dashboard,
  Expense,
  Income,
  Reserve,
} from "../types";
import { ModalForm } from "../components/ModalForm";
import { ExpenseModal } from "../components/ExpenseModal";
import { MonthSpendReview } from "../components/MonthSpendReview";
import { LensBar } from "../components/LensBar";
import { TotalsStrip } from "../components/TotalsStrip";

type Modal = null | "expense" | "income";

export function MonthPage() {
  const {
    month,
    channel,
    basis,
    query,
    setMonth,
    setChannel,
    setBasis,
    movementsHref,
  } = useLedgerParams();

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [editingIncome, setEditingIncome] = useState<Income | null>(null);
  /** Total da fatura (lente fatura) quando Compras do mês está vazio. */
  const [faturaHintSpent, setFaturaHintSpent] = useState<number | null>(null);
  /** Orçamento do salário: contas + faturas do ciclo (independente da lente ativa). */
  const [salaryBudget, setSalaryBudget] = useState<{
    incomes: number;
    accounts: number;
    cards: number;
  } | null>(null);
  const { suggestions: incomeDescriptions, remember: rememberIncome } =
    useDescriptionSuggestions("income");

  const load = useCallback(async () => {
    setError(null);
    const lens = ledgerQuery({ month, channel, basis });
    const cachedDash = peekCache<Dashboard>(`/dashboard?${lens}`);
    const cachedExps = peekCache<Expense[]>(`/expenses?${lens}`);
    const cachedIncs = peekCache<Income[]>(`/incomes?month=${month}`);
    if (cachedDash) setDashboard(cachedDash);
    if (cachedExps) setExpenses(cachedExps);
    if (cachedIncs) setIncomes(cachedIncs);
    try {
      const [dash, exps, incs, accs, cds, ress, cats] = await Promise.all([
        api.get<Dashboard>(`/dashboard?${lens}`),
        api.get<Expense[]>(`/expenses?${lens}`),
        api.get<Income[]>(`/incomes?month=${month}`),
        api.get<Account[]>("/accounts"),
        api.get<Card[]>("/cards"),
        api.get<Reserve[]>("/reserves"),
        api.get<Category[]>("/categories"),
      ]);
      setDashboard(dash);
      setExpenses(exps);
      setIncomes(incs);
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

      if (channel === "tudo") {
        const budgetDash =
          basis === "fatura"
            ? dash
            : await api.get<Dashboard>(
                `/dashboard?${ledgerQuery({ month, channel: "tudo", basis: "fatura" })}`,
              );
        setSalaryBudget({
          incomes: budgetDash.totals.incomes,
          accounts: budgetDash.totals.spent_accounts ?? 0,
          cards: budgetDash.totals.spent_cards ?? 0,
        });
      } else {
        setSalaryBudget(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar");
    }
  }, [month, channel, basis]);

  useEffect(() => {
    void load();
  }, [load]);

  const overdue = expenses.filter(isOverdue);
  const overdueTotal = overdue.reduce((s, e) => s + e.amount, 0);

  const showIncomes = channel !== "cartoes";
  const showAccounts = channel === "contas" || channel === "tudo";
  const showCards = channel === "cartoes" || channel === "tudo";
  const showReserves = channel === "contas" || channel === "tudo";

  return (
    <div>
      <div className="section-head month-head" style={{ marginBottom: "1rem" }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: "var(--display)", fontSize: "1.5rem" }}>
            {monthLabel(month)}
          </h2>
          <p className="muted lede" style={{ margin: "0.25rem 0 0" }}>
            Contas, cartões ou tudo — mesma lente nas movimentações
          </p>
        </div>
        <div className="month-actions" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input className="month-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <button className="btn btn-primary" onClick={() => setModal("expense")}>
            + Gasto
          </button>
          {showIncomes && (
            <button className="btn" onClick={() => setModal("income")}>
              + Receita
            </button>
          )}
        </div>
      </div>

      <LensBar
        channel={channel}
        basis={basis}
        onChannel={setChannel}
        onBasis={setBasis}
        right={
          <Link className="btn btn-sm" to={movementsHref}>
            Ver movimentações
          </Link>
        }
      />

      {error && <div className="error">{error}</div>}

      {dashboard && (
        <TotalsStrip channel={channel} basis={basis} totals={dashboard.totals} />
      )}

      {channel === "tudo" && salaryBudget && (
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <div className="section-head">
            <div>
              <h2 style={{ margin: 0 }}>Com este salário</h2>
              <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
                Contas do mês + faturas que vencem neste ciclo
              </p>
            </div>
          </div>
          <div className="grid-stats" style={{ marginTop: "0.75rem" }}>
            <div className="stat positive">
              <label>Receitas</label>
              <strong>{money(salaryBudget.incomes)}</strong>
            </div>
            <div className="stat negative">
              <label>Contas</label>
              <strong>{money(salaryBudget.accounts)}</strong>
            </div>
            <div className="stat negative">
              <label>Faturas</label>
              <strong>{money(salaryBudget.cards)}</strong>
            </div>
            <div
              className={`stat${
                salaryBudget.incomes - salaryBudget.accounts - salaryBudget.cards >= 0
                  ? " positive"
                  : " negative"
              }`}
            >
              <label>Sobra</label>
              <strong>
                {money(
                  salaryBudget.incomes - salaryBudget.accounts - salaryBudget.cards,
                )}
              </strong>
            </div>
          </div>
        </div>
      )}

      {channel === "tudo" && dashboard?.after_obligations && (
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <div className="section-head">
            <div>
              <h2 style={{ margin: 0 }}>Após obrigações</h2>
              <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
                Saldo atual − pendentes até o fim do mês − faturas ainda em aberto
              </p>
            </div>
          </div>
          <div className="grid-stats" style={{ marginTop: "0.75rem" }}>
            <div className="stat positive">
              <label>Caixa</label>
              <strong>{money(dashboard.after_obligations.cash)}</strong>
            </div>
            <div className="stat negative">
              <label>Pendentes</label>
              <strong>{money(dashboard.after_obligations.pending_accounts)}</strong>
            </div>
            <div className="stat negative">
              <label>Faturas</label>
              <strong>{money(dashboard.after_obligations.unpaid_invoices)}</strong>
            </div>
            <div
              className={`stat${
                dashboard.after_obligations.available >= 0 ? " positive" : " negative"
              }`}
            >
              <label>Livre</label>
              <strong>{money(dashboard.after_obligations.available)}</strong>
            </div>
          </div>
        </div>
      )}

      {overdue.length > 0 && channel !== "cartoes" && (
        <div className="alert-overdue" role="alert" style={{ marginBottom: "1rem" }}>
          <strong>
            {overdue.length} pagamento{overdue.length > 1 ? "s" : ""} atrasado
            {overdue.length > 1 ? "s" : ""}
          </strong>
          <span> · total {money(overdueTotal)}</span>
          <span>
            {" · "}
            <Link to={movementsHref}>Ver movimentações</Link>
          </span>
        </div>
      )}

      <div className="layout-2">
        <div className="stack">
          <div className="panel">
            <div className="section-head">
              <h2>Por categoria</h2>
              <Link className="btn btn-sm" to={movementsHref}>
                Ver todas
              </Link>
            </div>

            {expenses.length === 0 ? (
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
                <p className="empty">Nenhuma despesa nesta lente.</p>
              )
            ) : (
              <MonthSpendReview
                expenses={expenses}
                categories={categories}
                monthLabel={monthLabel(month)}
                onChanged={load}
              />
            )}
          </div>

          {showIncomes && incomes.length > 0 && (
            <div className="panel">
              <div className="section-head">
                <h2>Receitas</h2>
              </div>
              <div className="stack">
                {incomes.map((i) => (
                  <div className="row-item" key={i.id}>
                    <div>
                      <strong>{i.description}</strong>
                      <div className="row-meta">
                        {i.received_date ? `Recebido ${i.received_date}` : "Sem data"}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <span className="money-lg" style={{ color: "var(--accent)" }}>
                        {money(i.amount)}
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setEditingIncome(i)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={async () => {
                          if (!confirm(`Excluir receita "${i.description}"?`)) return;
                          await api.delete(`/incomes/${i.id}`);
                          await load();
                        }}
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="stack">
          {showAccounts && (
            <div className="panel">
              <div className="section-head">
                <h2>Contas</h2>
              </div>
              {dashboard?.accounts.length ? (
                <div className="stack">
                  {dashboard.accounts.map((a) => (
                    <div className="mini-card" key={a.account_id}>
                      <h3>{a.name}</h3>
                      <p>
                        Disponível {money(a.available)}
                        {a.reserved > 0 ? ` · em reservas ${money(a.reserved)}` : ""}
                      </p>
                      <div className="money-lg">{money(a.balance)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty">Cadastre uma conta em Cadastros.</p>
              )}
            </div>
          )}

          {showCards && (
            <div className="panel">
              <div className="section-head">
                <h2>Cartões</h2>
                <Link
                  className="btn btn-sm"
                  to={`/faturas`}
                >
                  Faturas
                </Link>
              </div>
              {dashboard?.cards.length ? (
                <div className="stack">
                  {dashboard.cards.map((c) => (
                    <div className="mini-card" key={c.card_id}>
                      <h3>{c.name}</h3>
                      <p>
                        Disponível {money(c.available)} de {money(c.credit_limit)}
                      </p>
                      <div className="money-lg">{money(c.used)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty">Nenhum cartão.</p>
              )}
              {channel === "cartoes" && (
                <p className="muted" style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
                  <Link to={`/despesas?${query}`}>Ver compras nesta lente</Link>
                  {" · "}
                  <Link to="/faturas">Operar faturas</Link>
                </p>
              )}
            </div>
          )}

          {showReserves && (
            <div className="panel">
              <div className="section-head">
                <h2>Reservas</h2>
              </div>
              {dashboard?.reserves.length ? (
                <div className="stack">
                  {dashboard.reserves.map((r) => {
                    const pct =
                      r.target_amount > 0
                        ? Math.round((r.current_amount / r.target_amount) * 100)
                        : null;
                    return (
                      <div className="mini-card" key={r.id}>
                        <h3>{r.name}</h3>
                        <p>
                          {r.type === "investment" ? "Investimento" : "Gasto futuro"}
                          {r.target_amount > 0
                            ? ` · meta ${money(r.target_amount)}`
                            : ""}
                        </p>
                        <div className="money-lg">
                          {money(r.current_amount)}
                          {pct != null && (
                            <span
                              className="muted"
                              style={{
                                fontSize: "0.95rem",
                                fontWeight: 500,
                                marginLeft: "0.45rem",
                              }}
                            >
                              {pct}%
                            </span>
                          )}
                        </div>
                        {pct != null && (
                          <div
                            className="reserve-progress"
                            role="progressbar"
                            aria-valuenow={Math.min(pct, 100)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${pct}% da meta`}
                          >
                            <div
                              className="reserve-progress-bar"
                              style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="empty">Nenhuma reserva.</p>
              )}
            </div>
          )}
        </div>
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

      {modal === "income" && (
        <ModalForm
          title="Nova receita"
          submitLabel="Lançar"
          continueLabel="Lançar e novo"
          onClose={() => setModal(null)}
          fields={[
            {
              name: "description",
              label: "Descrição",
              required: true,
              defaultValue: "Salário",
              clearOnContinue: true,
              suggestions: incomeDescriptions,
            },
            {
              name: "amount",
              label: "Valor (R$)",
              type: "money",
              required: true,
              placeholder: "Ex: 10.000,00",
            },
            {
              name: "account_id",
              label: "Conta",
              type: "select",
              options: accounts.map((a) => ({ value: String(a.id), label: a.name })),
            },
            {
              name: "received_date",
              label: "Data recebimento",
              type: "date",
              defaultValue: today(),
            },
          ]}
          onSubmit={async (v) => {
            await api.post("/incomes", {
              description: v.description,
              amount: parseMoneyInput(v.amount),
              month,
              account_id: v.account_id ? Number(v.account_id) : null,
              received_date: v.received_date || null,
            });
            rememberIncome(v.description);
            await load();
          }}
        />
      )}

      {editingIncome && (
        <ModalForm
          title="Editar receita"
          onClose={() => setEditingIncome(null)}
          fields={[
            {
              name: "description",
              label: "Descrição",
              required: true,
              defaultValue: editingIncome.description,
              suggestions: incomeDescriptions,
            },
            {
              name: "amount",
              label: "Valor (R$)",
              type: "money",
              required: true,
              defaultValue: moneyInput(editingIncome.amount),
            },
            {
              name: "account_id",
              label: "Conta",
              type: "select",
              defaultValue: editingIncome.account_id
                ? String(editingIncome.account_id)
                : "",
              options: accounts.map((a) => ({ value: String(a.id), label: a.name })),
            },
            {
              name: "received_date",
              label: "Data recebimento",
              type: "date",
              defaultValue: editingIncome.received_date ?? "",
            },
          ]}
          onSubmit={async (v) => {
            await api.patch(`/incomes/${editingIncome.id}`, {
              description: v.description,
              amount: parseMoneyInput(v.amount),
              account_id: v.account_id ? Number(v.account_id) : null,
              received_date: v.received_date || null,
            });
            setEditingIncome(null);
            await load();
          }}
        />
      )}
    </div>
  );
}
