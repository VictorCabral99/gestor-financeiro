import { money } from "../lib/format";
import { basisHint, type Basis, type Channel, type LedgerTotals } from "../lib/ledger";

type Props = {
  channel: Channel;
  basis: Basis;
  totals: LedgerTotals;
};

export function TotalsStrip({ channel, basis, totals }: Props) {
  const spent = totals.spent ?? totals.expenses;
  const pending = totals.pending ?? totals.expenses_pending;
  const balance = totals.balance_month ?? totals.balance ?? totals.incomes - spent;
  const cashOut = totals.cash_out ?? 0;
  const spentAccounts = totals.spent_accounts ?? 0;
  const spentCards = totals.spent_cards ?? 0;

  const stats: { label: string; value: number; tone?: "positive" | "negative" }[] = [];

  if (channel !== "cartoes") {
    stats.push({ label: "Receitas", value: totals.incomes, tone: "positive" });
  }

  if (basis === "caixa") {
    stats.push({ label: "Saída de caixa", value: spent, tone: "negative" });
  } else {
    stats.push({ label: "Gasto", value: spent, tone: "negative" });
    if (channel === "tudo" && (spentAccounts > 0 || spentCards > 0)) {
      stats.push({ label: "Contas", value: spentAccounts });
      stats.push({ label: "Cartões", value: spentCards });
    } else if (channel === "cartoes") {
      stats.push({ label: "Pendentes na fatura", value: pending });
    } else {
      stats.push({ label: "Pendentes", value: pending });
    }
  }

  if (channel === "tudo" && basis === "compra" && cashOut > 0) {
    stats.push({ label: "Caixa (ref.)", value: cashOut });
  }

  if (channel !== "cartoes" || basis === "caixa") {
    stats.push({
      label: channel === "cartoes" ? "Impacto" : "Saldo",
      value: balance,
      tone: balance >= 0 ? "positive" : "negative",
    });
  }

  // Evita strip enorme: no máx 4 cards principais
  const shown = stats.slice(0, 4);

  return (
    <div>
      <div className="grid-stats">
        {shown.map((s) => (
          <div
            key={s.label}
            className={`stat${s.tone === "positive" ? " positive" : ""}${s.tone === "negative" ? " negative" : ""}${s.label === "Saldo" || s.label === "Impacto" ? " stat-hero" : ""}`}
          >
            <label>{s.label}</label>
            <strong>{money(s.value)}</strong>
          </div>
        ))}
      </div>
      <p className="muted lens-hint">{basisHint(channel, basis)}</p>
    </div>
  );
}
