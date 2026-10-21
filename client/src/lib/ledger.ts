export type Channel = "contas" | "cartoes" | "tudo";
export type Basis = "compra" | "caixa" | "fatura";

export const CHANNELS: { id: Channel; label: string; hint: string }[] = [
  { id: "contas", label: "Contas", hint: "Débitos e lançamentos na conta corrente" },
  { id: "cartoes", label: "Cartões", hint: "Compras e ciclos dos cartões" },
  { id: "tudo", label: "Tudo", hint: "Contas + cartões na mesma lente" },
];

export function parseChannel(value: string | null | undefined): Channel {
  if (value === "contas" || value === "cartoes" || value === "tudo") return value;
  return "tudo";
}

export function parseBasis(
  value: string | null | undefined,
  channel: Channel,
): Basis {
  if (channel === "contas") {
    return value === "caixa" ? "caixa" : "compra";
  }
  if (channel === "cartoes") {
    if (value === "compra" || value === "caixa") return value;
    return "fatura";
  }
  if (value === "caixa" || value === "fatura") return value;
  return "compra";
}

export function basesForChannel(channel: Channel): { id: Basis; label: string }[] {
  if (channel === "contas") {
    return [
      { id: "compra", label: "Lançamentos" },
      { id: "caixa", label: "Caixa" },
    ];
  }
  if (channel === "cartoes") {
    return [
      { id: "fatura", label: "Fatura do mês" },
      { id: "compra", label: "Compras do mês" },
      { id: "caixa", label: "Pagamentos" },
    ];
  }
  return [
    { id: "compra", label: "Compras" },
    { id: "fatura", label: "Por fatura" },
    { id: "caixa", label: "Caixa" },
  ];
}

export function channelLabel(channel: Channel): string {
  return CHANNELS.find((c) => c.id === channel)?.label ?? channel;
}

export function basisHint(channel: Channel, basis: Basis): string {
  if (channel === "contas") {
    return basis === "caixa"
      ? "O que saiu da conta (pagamentos e faturas)"
      : "Lançamentos do mês na conta (pagos e pendentes)";
  }
  if (channel === "cartoes") {
    if (basis === "fatura") {
      return "O que vence neste ciclo (sai deste salário)";
    }
    if (basis === "caixa") {
      return "O que já debitou da conta";
    }
    return "Gastos com data de compra neste mês calendário";
  }
  if (basis === "fatura") {
    return "Contas do mês + faturas que vencem neste ciclo";
  }
  if (basis === "caixa") {
    return "Saídas de caixa: conta + pagamento de faturas";
  }
  return "Conta no mês + compras no cartão pela data da compra";
}

export function ledgerQuery(params: {
  month?: string;
  year?: number;
  channel: Channel;
  basis: Basis;
}): string {
  const q = new URLSearchParams();
  if (params.month) q.set("month", params.month);
  if (params.year != null) q.set("year", String(params.year));
  q.set("canal", params.channel);
  q.set("base", params.basis);
  return q.toString();
}

export type LedgerTotals = {
  incomes: number;
  expenses: number;
  expenses_paid: number;
  expenses_pending: number;
  spent?: number;
  spent_accounts?: number;
  spent_cards?: number;
  cash_out?: number;
  pending?: number;
  paid?: number;
  balance_month?: number;
  balance?: number;
};
