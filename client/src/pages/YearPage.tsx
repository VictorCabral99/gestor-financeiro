import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CategoryBreakdown } from "../components/CategoryBreakdown";
import { LensBar } from "../components/LensBar";
import { TotalsStrip } from "../components/TotalsStrip";
import { api, peekCache } from "../lib/api";
import type { CategoryTreeNode } from "../lib/expenseHelpers";
import { money, monthLabel } from "../lib/format";
import { ledgerQuery, type LedgerTotals } from "../lib/ledger";
import { useDataRefresh } from "../lib/refresh";
import { useLedgerParams } from "../lib/useLedgerParams";

type YearMonth = {
  month: string;
  incomes: number;
  expenses: number;
  expenses_paid: number;
  expenses_pending: number;
  balance: number;
};

type YearDashboard = {
  year: number;
  channel?: string;
  basis?: string;
  totals: LedgerTotals & {
    expenses: number;
    expenses_paid: number;
    expenses_pending: number;
    balance: number;
  };
  months: YearMonth[];
  by_category: { name: string; color: string; total: number }[];
  by_category_tree?: CategoryTreeNode[];
};

function shortMonth(month: string): string {
  const label = monthLabel(month);
  return label.split(" ")[0] ?? month;
}

export function YearPage() {
  const { year, channel, basis, setYear, setChannel, setBasis } = useLedgerParams({
    withMonth: false,
    withYear: true,
  });
  const [data, setData] = useState<YearDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const q = ledgerQuery({ year, channel, basis });
    const cached = peekCache<YearDashboard>(`/dashboard/year?${q}`);
    if (cached) setData(cached);
    try {
      const dash = await api.get<YearDashboard>(`/dashboard/year?${q}`);
      setData(dash);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar");
    }
  }, [year, channel, basis]);

  useEffect(() => {
    void load();
  }, [load]);
  useDataRefresh(load);

  const maxExpense = Math.max(1, ...(data?.months.map((m) => m.expenses) ?? [1]));
  const current = `${year}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

  return (
    <div>
      <div className="section-head" style={{ marginBottom: "1rem" }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: "var(--display)", fontSize: "1.5rem" }}>
            Ano {year}
          </h2>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            Mesma lente do mês — totais por canal e base
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button
            type="button"
            className="btn"
            onClick={() => setYear(year - 1)}
            aria-label="Ano anterior"
          >
            ←
          </button>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value) || year)}
            style={{
              width: 88,
              border: "1px solid var(--line)",
              borderRadius: 12,
              padding: "0.45rem 0.7rem",
              background: "var(--surface-solid)",
              textAlign: "center",
            }}
          />
          <button
            type="button"
            className="btn"
            onClick={() => setYear(year + 1)}
            aria-label="Próximo ano"
          >
            →
          </button>
        </div>
      </div>

      <LensBar
        channel={channel}
        basis={basis}
        onChannel={setChannel}
        onBasis={setBasis}
      />

      {error && <div className="error">{error}</div>}

      {data && (
        <>
          <TotalsStrip channel={channel} basis={basis} totals={data.totals} />

          <div className="panel" style={{ marginBottom: "1rem" }}>
            <div className="section-head">
              <h2>Meses</h2>
            </div>
            <div className="year-grid">
              {data.months.map((m) => {
                const bar = Math.round((m.expenses / maxExpense) * 100);
                const isCurrent = m.month === current;
                const href = `/?${ledgerQuery({ month: m.month, channel, basis })}`;
                return (
                  <Link
                    key={m.month}
                    to={href}
                    className={`year-month${isCurrent ? " current" : ""}`}
                  >
                    <div className="year-month-head">
                      <strong>{shortMonth(m.month)}</strong>
                      {isCurrent && <span className="badge badge-paid">Atual</span>}
                    </div>
                    <div className="year-bar-track" aria-hidden>
                      <div className="year-bar-fill" style={{ width: `${bar}%` }} />
                    </div>
                    {channel !== "cartoes" && (
                      <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.8rem" }}>
                        + {money(m.incomes)}
                      </p>
                    )}
                    <p className="muted" style={{ margin: "0.1rem 0 0", fontSize: "0.8rem" }}>
                      − {money(m.expenses)}
                    </p>
                    <div
                      className="money-lg"
                      style={{
                        fontSize: "1.05rem",
                        color: m.balance >= 0 ? "var(--accent)" : "var(--danger)",
                      }}
                    >
                      {money(m.balance)}
                    </div>
                    {m.expenses_pending > 0 && (
                      <span className="row-meta" style={{ color: "var(--pending)" }}>
                        pend. {money(m.expenses_pending)}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="panel">
            <div className="section-head">
              <h2>Despesas por categoria</h2>
            </div>
            <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.85rem" }}>
              Toque numa categoria para ver as subcategorias
            </p>
            <CategoryBreakdown
              nodes={data.by_category_tree ?? []}
              grandTotal={data.totals.expenses}
            />
          </div>
        </>
      )}
    </div>
  );
}
