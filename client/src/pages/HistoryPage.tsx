import { useCallback, useEffect, useState } from "react";
import { api, peekCache } from "../lib/api";
import { formatDateBr, monthLabel } from "../lib/format";
import { useDataRefresh } from "../lib/refresh";

type MonthRow = {
  month: string;
  status: "open" | "closed";
  closed_at: string | null;
};

export function HistoryPage() {
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const cached = peekCache<MonthRow[]>("/months");
    if (cached) setMonths(cached);
    try {
      const rows = await api.get<MonthRow[]>("/months");
      setMonths(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useDataRefresh(load);

  return (
    <div>
      <div className="section-head" style={{ marginBottom: "1rem" }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: "var(--display)", fontSize: "1.5rem" }}>
            Histórico
          </h2>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            Meses abertos e fechados automaticamente no dia 01
          </p>
        </div>
        <button type="button" className="btn" onClick={() => void load()}>
          Atualizar
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="panel">
        {months.length === 0 ? (
          <p className="empty">Nenhum mês registrado ainda.</p>
        ) : (
          <div className="list">
            {months.map((m) => (
              <div className="row" key={m.month}>
                <div className="row-main">
                  <strong>{monthLabel(m.month)}</strong>
                  <span className="row-meta">
                    {m.month}
                    {m.closed_at ? ` · fechado em ${formatDateBr(m.closed_at)}` : ""}
                  </span>
                </div>
                <div className="row-side">
                  <span
                    className={`badge ${m.status === "open" ? "badge-paid" : "badge-pending"}`}
                  >
                    {m.status === "open" ? "Aberto" : "Fechado"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
