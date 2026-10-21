import { api } from "./api";
import { ledgerQuery } from "./ledger";

type CardRow = { id: number };

/** Enche a cópia local com o que as telas leem, para o celular abrir com os dados do computador. */
export async function warmLocalCopy() {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const year = now.getFullYear();
  const lenses = [
    ledgerQuery({ month, channel: "tudo", basis: "compra" }),
    ledgerQuery({ month, channel: "tudo", basis: "fatura" }),
    ledgerQuery({ month, channel: "tudo", basis: "caixa" }),
    ledgerQuery({ month, channel: "contas", basis: "compra" }),
    ledgerQuery({ month, channel: "cartoes", basis: "fatura" }),
  ];
  const jobs: Promise<unknown>[] = [
    api.get("/accounts"),
    api.get("/cards"),
    api.get("/reserves"),
    api.get("/categories"),
    api.get("/expense-rules"),
    api.get("/months"),
    api.get(`/incomes?month=${month}`),
    api.get(`/account-transfers?month=${month}`),
    api.get(`/reserves/movements?month=${month}`),
    api.get(`/card-invoices/payments?month=${month}`),
    api.get(`/dashboard/year?${ledgerQuery({ year, channel: "tudo", basis: "compra" })}`),
  ];
  for (const lens of lenses) {
    jobs.push(api.get(`/dashboard?${lens}`), api.get(`/expenses?${lens}`));
  }
  await Promise.allSettled(jobs);
  const cards = await api.get<CardRow[]>("/cards").catch(() => []);
  await Promise.allSettled([
    ...cards.map((card) => api.get(`/cards/${card.id}/invoices`)),
    ...cards.map((card) => api.get(`/cards/${card.id}/invoices/${month}`)),
    ...(await api.get<{ id: number }[]>("/accounts").catch(() => [])).map((account) =>
      api.get(`/accounts/${account.id}/balance`),
    ),
  ]);
}
